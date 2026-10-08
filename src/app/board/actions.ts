// 配置ボードの書き込み（段2-③）。
//
// 🔴 認可は3枚重ね（CLAUDE.md）。ここは**2枚目の関門**。
//   1. DB の RLS      … can_edit() = control / admin。最後の砦
//   2. requireRole()  … このファイル。**Server Action は URL である**。
//                       画面にボタンを出さないだけでは呼ばれるのを防げない
//   3. proxy.ts       … 導線であって認可ではない
//
// 🔴 「止めるのは重複だけ。あとは警告」（screen-design.md §2-5）。
//   NG も資格不足も人数超過も**保存できる**。
//   保存を拒むのは DB の EXCLUDE 制約に触れたときだけで、
//   その判断はここではなく DB が持つ。アプリに同じ判定を二重に書かない。
//
// 🔴 戻り値で成否を返す。例外を投げっぱなしにしない。
//   D&D は失敗したら「プレートが元へ戻る」必要があり、
//   画面側がそれを知るには**結果を受け取れる**形でなければならない。
"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { addDays, formatSpanPlace, OFF_KIND_LABEL, WORK_KIND_LABEL } from "@/lib/board-format";
import { findOverlaps, type Span } from "@/lib/overlap";
import { createClient } from "@/lib/supabase/server";
import type { JobCounts, JobType, OffKind, OffWorkKind, WorkKind } from "@/lib/types";

/**
 * 🔴 `details` は「なぜ落ちたか」を**名前で**並べたもの（2026-09-04 追加）。
 *   `message` だけだと「この隊員は…」としか言えず、40枠を一度に確定したときに
 *   **どの隊員のことか分からない**（柴山の指摘）。
 *   直せる場所が分からない失敗の通知は、無いのとあまり変わらない。
 */
export type ActionResult = { ok: true } | { ok: false; message: string; details?: string[] };

/**
 * PostgreSQL のエラーを画面に出す日本語に直す。
 *
 * 🔴 23P01 = exclusion_violation。ここでは `assignments_no_overlap` にしか使っていない。
 *   ＝「その隊員は同じ時間帯の確定済みの枠に既に入っている」。
 *   生のエラー文（制約名・SQL）をそのまま出しても管制には何も伝わらない。
 */
function toMessage(error: { code?: string; message: string }): string {
  if (error.code === "23P01") {
    return "この隊員は同じ時間帯の確定済みの枠に既に入っています。先に元の配置を外してください。";
  }
  if (error.code === "42501") {
    // RLS に弾かれた。ボタンが出ていないはずの操作が届いた場合
    return "この操作の権限がありません。";
  }
  if (error.code === "23514" && error.message.includes("shifts_job_counts_within_headcount")) {
    return "検定・列車・ドライバーの人数の合計が、必要人数を超えています（必要人数の内数です）。";
  }
  return `保存できませんでした（${error.message}）`;
}

/** 枠の職種の人数（A表の `K1R1`）。画面から来た値を DB の列に直す */
function jobCountColumns(c: JobCounts | undefined) {
  const n = (v: number | undefined) => (Number.isFinite(v) && (v as number) > 0 ? Math.floor(v as number) : 0);
  return { kentei_count: n(c?.kentei), train_count: n(c?.train), driver_count: n(c?.driver) };
}

// ─────────────────────────────────────────────────────────
// 重なりを名前で説明する
//
// 🔴 **判定はしない。判定は DB がした。** ここは起きた失敗を説明するだけ。
//   ここで「確定できるか」を先に判断し始めると、規則が DB とアプリの
//   2か所に増え、やがて食い違う（このファイル冒頭の方針）。
//   → 呼ぶのは **23P01 が返ってきた後だけ**。成功経路では1クエリも増えない。
//
// 🔴 なぜ PostgreSQL のエラー本文を解析しないのか
//   23P01 の details は `Key (guard_id, tstzrange(...))=(...)` という形で
//   **UUID と時刻しか持たない**。管制に読ませる文字ではないし、
//   文面は PostgreSQL の版に依存する。素直に引き直したほうが壊れない。
// ─────────────────────────────────────────────────────────

type OverlapRow = Span & {
  shift_id: string | null;
  is_confirmed: boolean;
  guardName: string;
  place: string;
};

/**
 * これから確定しようとしている枠のせいで、時間帯が重なる隊員を洗い出す。
 * @param shiftIds 確定しようとした枠
 * @returns 「氏名：A と B」の配列。空なら説明できなかった
 */
async function describeOverlaps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shiftIds: string[],
): Promise<string[]> {
  const { data: targets } = await supabase.from("shifts").select("work_date").in("id", shiftIds);
  const dates = (targets ?? []).map((s) => s.work_date as string).sort();
  if (dates.length === 0) return [];

  // 🔴 前後1日を含める。夜勤は work_date が**開始日**なので、
  //   翌朝までかかる枠は隣の日の枠と重なりうる（20:00–06:00）。
  const { data } = await supabase
    .from("assignments")
    .select(
      `guard_id, shift_id, planned_start_at, planned_end_at, is_confirmed,
       guard:guards ( name ),
       shift:shifts (
         work_kind,
         site:sites ( short_name, customer:customers ( name ) ),
         jurisdiction:jurisdictions ( name )
       )`,
    )
    .eq("status", "planned")
    .gte("work_date", addDays(dates[0], -1))
    .lte("work_date", addDays(dates[dates.length - 1], 1))
    .not("planned_start_at", "is", null)
    .not("planned_end_at", "is", null);

  type Raw = {
    guard_id: string;
    shift_id: string | null;
    planned_start_at: string;
    planned_end_at: string;
    is_confirmed: boolean;
    guard: { name: string } | null;
    shift: {
      work_kind: WorkKind;
      site: { short_name: string; customer: { name: string } | null } | null;
      jurisdiction: { name: string } | null;
    } | null;
  };

  const targetIds = new Set(shiftIds);
  const rows: OverlapRow[] = ((data ?? []) as unknown as Raw[])
    // 確定後に制約が見る行＝すでに確定済み ＋ 今回確定しようとしている枠の行
    .filter((r) => r.is_confirmed || (r.shift_id !== null && targetIds.has(r.shift_id)))
    .map((r) => ({
      key: r.guard_id,
      start: r.planned_start_at,
      end: r.planned_end_at,
      shift_id: r.shift_id,
      is_confirmed: r.is_confirmed,
      guardName: r.guard?.name ?? "（氏名不明）",
      place: formatSpanPlace({
        siteName: r.shift?.site?.short_name ?? null,
        customerName: r.shift?.site?.customer?.name ?? null,
        jurisdictionName: r.shift?.jurisdiction?.name ?? null,
        workKind: r.shift?.work_kind ?? null,
        start: r.planned_start_at,
        end: r.planned_end_at,
      }),
    }));

  const messages = new Set<string>();
  for (const [a, b] of findOverlaps(rows)) {
    // 🔴 両方すでに確定済みなら、今回の確定が原因ではない。
    //   （そもそも DB が許していないはずだが、原因でないものを挙げない）
    if (a.is_confirmed && b.is_confirmed) continue;
    messages.add(`${a.guardName}：${a.place} と ${b.place}`);
  }
  return [...messages];
}

/** 空文字は null にする。text 列に "" を入れると「空欄」と「未設定」が混ざる。 */
function orNullText(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** 配置を編集できるロールであることを確かめ、クライアントを返す */
async function editorClient() {
  await requireRole("control", "admin");
  return createClient();
}

// ─────────────────────────────────────────────────────────
// プール → 枠（新規配置）
// ─────────────────────────────────────────────────────────
export async function placeGuard(input: {
  guardId: string;
  shiftId: string;
  /** 何枚目に差し込むか */
  position: number;
}): Promise<ActionResult> {
  const supabase = await editorClient();

  // 🔴 work_date / planned_* は送らない。
  //   枠から一意に決まる派生値であり、DB のトリガーが埋める
  //   （20260903000000_assignment_planned_times.sql）。
  //   ここで計算して送ると、二か所に規則が生まれてやがてズレる。
  //   ただし work_date は NOT NULL なので、トリガーが上書きする前提で仮の値を入れる。
  const { data: shift, error: sError } = await supabase
    .from("shifts")
    .select("work_date")
    .eq("id", input.shiftId)
    .single();
  if (sError) return { ok: false, message: toMessage(sError) };

  const { error } = await supabase.from("assignments").insert({
    guard_id: input.guardId,
    shift_id: input.shiftId,
    work_date: shift.work_date,
    kind: "site",
    role: "member",
    position: input.position,
    status: "planned",
  });
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 枠 → 別の枠（差し替え）
//
// 🔴 当日変更で最も多い操作（screen-design.md §2-7）。1操作で終わること。
// 🔴 行を作り直さず UPDATE する。id が変わると
//   「同じ配置が動いた」のか「消して作った」のかが履歴で区別できなくなる。
// ─────────────────────────────────────────────────────────
export async function moveAssignment(input: {
  assignmentId: string;
  toShiftId: string;
  position: number;
}): Promise<ActionResult> {
  const supabase = await editorClient();

  const { error } = await supabase
    .from("assignments")
    .update({ shift_id: input.toShiftId, position: input.position })
    .eq("id", input.assignmentId)
    .eq("kind", "site");
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 枠 → プール（配置を外す）
//
// 🔴 行を消す。status='canceled' を使わない。
//   canceled は「その稼働は発生したが中止になった」＝請求に効きうる状態
//   （現中の議論・§10-2）。組み替えの途中で外しただけの行を
//   同じ列に混ぜると、第2弾で「中止」を数えたときに合わなくなる。
// ─────────────────────────────────────────────────────────
export async function unplaceAssignment(input: {
  assignmentId: string;
}): Promise<ActionResult> {
  const supabase = await editorClient();

  const { error } = await supabase
    .from("assignments")
    .delete()
    .eq("id", input.assignmentId)
    .eq("kind", "site");
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 隊長の付け外し
// ─────────────────────────────────────────────────────────
export async function setAssignmentRole(input: {
  assignmentId: string;
  role: "leader" | "member";
}): Promise<ActionResult> {
  const supabase = await editorClient();

  const { error } = await supabase
    .from("assignments")
    .update({ role: input.role })
    .eq("id", input.assignmentId);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 職種（検定・列車見張・ドライバー）の付け外し（2026-10-08）
//
// 🔴 資格を持っていなくても止めない。資格の登録漏れがありうるため（名札で知らせる）。
// 🔴 確定済みの枠なら仮組みへ戻る（隊長と同じ・20261008000000_job_type.sql）。
// ─────────────────────────────────────────────────────────
export async function setAssignmentJobType(input: {
  assignmentId: string;
  jobType: JobType | null;
}): Promise<ActionResult> {
  const supabase = await editorClient();

  const { error } = await supabase
    .from("assignments")
    .update({ job_type: input.jobType })
    .eq("id", input.assignmentId);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// その人だけ現着中止（2026-10-08）
//
// 🔴 一部の隊員だけ現着中止になることがある（5名手配で1名現着中止 など・管制）。
//   枠は分けず、名札に印を付ける（カードを増やさない＝見やすさ優先・柴山）。
//   18列CSV ではその人の行だけ「現中」の区分で出す（handoff.ts）。
// ─────────────────────────────────────────────────────────
export async function setAssignmentOnsiteCancelled(input: {
  assignmentId: string;
  cancelled: boolean;
}): Promise<ActionResult> {
  const supabase = await editorClient();

  const { error } = await supabase
    .from("assignments")
    .update({ onsite_cancelled: input.cancelled })
    .eq("id", input.assignmentId);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 仮組み ⇄ 確定
//
// 🔴 確定を取り消せるようにする（差し戻し・screen-design.md §2-6）。
//   一方通行にすると、押し間違いを直す手段が無くなる。
// 🔴 確定した瞬間に EXCLUDE 制約が効き始める（is_confirmed をトリガーが写す）。
//   仮組み中に重ねてあった配置は、**ここで初めて弾かれる**。
//   それが仕様（8/27 決定：仮組み中は重ねられる／確定時にだけ効かせる）。
// ─────────────────────────────────────────────────────────
export async function setShiftStatus(input: {
  shiftId: string;
  status: "draft" | "confirmed";
}): Promise<ActionResult> {
  const { user } = await requireRole("control", "admin");
  const supabase = await createClient();

  const { error } = await supabase
    .from("shifts")
    .update(
      input.status === "confirmed"
        ? { status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: user.id }
        : { status: "draft", confirmed_at: null, confirmed_by: null },
    )
    .eq("id", input.shiftId);
  if (error) {
    return {
      ok: false,
      message: toMessage(error),
      details: error.code === "23P01" ? await describeOverlaps(supabase, [input.shiftId]) : undefined,
    };
  }

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 一括確定（画面に出ている枠をまとめて）
//
// 🔴 1件ずつ update しない。40件で40往復になる。
// 🔴 重複で1件でも落ちたら**全部落ちる**。
//   「どれが確定してどれがしていないか」が分からない状態を作らないため、
//   落ちたときは何も変えずにメッセージだけ返す。
// ─────────────────────────────────────────────────────────
export async function confirmShifts(input: {
  shiftIds: string[];
}): Promise<ActionResult> {
  if (input.shiftIds.length === 0) return { ok: true };
  const { user } = await requireRole("control", "admin");
  const supabase = await createClient();

  const { error } = await supabase
    .from("shifts")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: user.id,
    })
    .in("id", input.shiftIds)
    .eq("status", "draft")
    // 🔴 中止の枠は確定しない。画面側でも対象から外しているが、
    //   Server Action は URL なので**画面を通らずに呼べる**。ここでも塞ぐ。
    .is("cancelled_at", null);
  if (error) {
    // 🔴 40枠を一度に確定したときの「この隊員は…」は、**どの隊員か分からない**。
    //   直せる場所が分からない失敗の通知は、無いのとあまり変わらない（柴山の指摘）。
    if (error.code !== "23P01") return { ok: false, message: toMessage(error) };
    const details = await describeOverlaps(supabase, input.shiftIds);
    return {
      ok: false,
      // 🔴 名前を出せたときだけ言い方を変える。
      //   洗い出せなかったのに「重なっている隊員がいます」とだけ言うと、
      //   元の文面より情報が減る。特定できなければ元の文面に戻す
      message:
        details.length > 0 ? "時間帯が重なっている隊員がいます。" : toMessage(error),
      details,
    };
  }

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 枠の中止 / 中止の取り消し（2026-09-07）
//
// 🔴 枠も配置も消さない。状態だけを変える。
//   管制の要望は「取り消す」ではなく「中止になったと分かる表示に変わる」。
//   誰を入れていたかが残っていないと、空いた隊員をどこへ回すか判断できない。
//
// 🔴 確定済みの枠でも中止にできる。現場が飛ぶのは確定の後のほうが多い。
//   status（仮組み/確定）は触らない ─ 中止と確定は別の軸だから。
// ─────────────────────────────────────────────────────────
export async function setShiftCancelled(input: {
  shiftId: string;
  cancelled: boolean;
}): Promise<ActionResult> {
  const { user } = await requireRole("control", "admin");
  const supabase = await createClient();

  const { error } = await supabase
    .from("shifts")
    .update(
      input.cancelled
        ? { cancelled_at: new Date().toISOString(), cancelled_by: user.id }
        : { cancelled_at: null, cancelled_by: null },
    )
    .eq("id", input.shiftId);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 現場を盤面に追加する（枠を1つ作る）─ 2026-09-07
//
// 🔴 ここは第1弾でいちばん効く導線。
//   AIK assign が使われなくなった大きな原因が
//   「忙しい中、案件をいちいち作るのが面倒」だった（2026-09-07・管制）。
//   **手数を増やさない**ことが仕様。既存現場を選んだら、
//   時刻・休憩は sites のひな形（plan_*）から埋めて、そのまま作れる。
//
// 🔴 新規現場は「名前と時間」だけで作れる。番号は一切聞かない。
//   現場コードは DB が振る（AS0001〜）。警備先番号は現場に持たせず、
//   引き渡し（段3）のときに〈現場の得意先 × 枠の区分〉で duty_codes から引く
//   （2026-10-02。それまでは仮番号 TMP- を振っていた）。
// ─────────────────────────────────────────────────────────
/** 枠の追加結果。**何件作って何件飛ばしたか**を画面で言うために持つ */
export type AddShiftResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; message: string };

export async function addShift(input: {
  /** 既存現場を選んだ場合 */
  siteId?: string;
  /** 新規現場を作る場合の名前 */
  newSiteName?: string;
  /** 新規現場の得意先。ShiftMax 由来のマスタから選ぶ（ここで新規作成はしない） */
  newSiteCustomerId?: string;
  jurisdictionId: string;
  /**
   * 🔴 作る日。**複数日をまとめて作れる**（2026-09-09）。
   *   これまで1日1件しか作れず、「毎日ある現場」を1か月ぶん立てるのに
   *   同じ入力を30回くり返すことになっていた（柴山の指摘）。
   *   A表が週表であることからも、枠は**期間で立つのが自然**。
   */
  workDates: string[];
  workKind: WorkKind;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
  breakMin: number;
  headcount: number;
  /** 必要人数のうち検定・列車・ドライバー（A表の `K1R1`・2026-10-08）。省略時は 0 */
  jobCounts?: JobCounts;
  // 🔴 2026-09-09 追加。現行の入力UI（`管制雛形` D〜U列）にあって、こちらに無かった項目。
  //   予定コメント・請求備考は手入力（§8-2）。投入CSV 18列のうち 14・18列目に対応する。
  //   🔴 班名（5列目）は 2026-10-02 に削除。実データで1行も使われていなかった（空で出す）。
  planComment?: string;
  billingNote?: string;
}): Promise<AddShiftResult> {
  await requireRole("control", "admin");
  const supabase = await createClient();

  // 重複を防ぐため日付は正規化して重複を落とす
  const dates = [...new Set(input.workDates)].filter((d) => d).sort();
  if (dates.length === 0) return { ok: false, message: "日付を選んでください。" };

  let siteId = input.siteId;

  if (!siteId) {
    const name = (input.newSiteName ?? "").trim();
    if (!name) return { ok: false, message: "現場名を入れてください。" };
    // 🔴 得意先は必須（2026-10-02）。現場は〈現場名 × 得意先〉で1件
    if (!input.newSiteCustomerId) return { ok: false, message: "得意先を選んでください。" };

    const { data: created, error: cError } = await supabase
      .from("sites")
      .insert({
        name,
        short_name: name.slice(0, 8),
        customer_id: input.newSiteCustomerId ?? null,
        jurisdiction_id: input.jurisdictionId,
        plan_start_h: input.startH,
        plan_start_m: input.startM,
        plan_end_h: input.endH,
        plan_end_m: input.endM,
        plan_break: input.breakMin,
      })
      .select("id")
      .single();
    if (cError) return { ok: false, message: toMessage(cError) };
    siteId = created.id;
  }

  // 🔴 同じ現場・同じ日・同じ区分の枠が既にあれば**作らない**。
  //   期間を延ばして作り直すたびに枠が二重に増えると、盤面が壊れる。
  //   DB に一意制約は無いので（board_core.sql）、ここで見る。
  const { data: existing, error: exErr } = await supabase
    .from("shifts")
    .select("work_date")
    .eq("site_id", siteId)
    .eq("work_kind", input.workKind)
    .in("work_date", dates);
  if (exErr) return { ok: false, message: toMessage(exErr) };
  const already = new Set((existing ?? []).map((r) => r.work_date as string));

  const rows = dates
    .filter((d) => !already.has(d))
    .map((d) => ({
      site_id: siteId,
      work_date: d,
      jurisdiction_id: input.jurisdictionId,
      work_kind: input.workKind,
      headcount: input.headcount,
      ...jobCountColumns(input.jobCounts),
      start_h: input.startH,
      start_m: input.startM,
      end_h: input.endH,
      end_m: input.endM,
      break_min: input.breakMin,
      plan_comment: orNullText(input.planComment),
      billing_note: orNullText(input.billingNote),
      status: "draft",
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from("shifts").insert(rows);
    if (error) return { ok: false, message: toMessage(error) };
  }

  refresh();
  // 🔴 何件作って何件飛ばしたかを返す。黙って飛ばすと「作ったのに出ない」に見える
  return { ok: true, created: rows.length, skipped: dates.length - rows.length };
}

// ─────────────────────────────────────────────────────────
// 枠を消す（2026-09-07）
//
// 🔴 「中止」とは別物。使い分けが違う。
//   ・中止 … 現場が飛んだ。**記録は残す**。誰を入れていたかも残す
//   ・削除 … そもそも間違って作った枠。**残す価値が無い**
//   中止しかないと、打ち間違いの枠が盤面に居座り続ける。
//
// 🔴 assignments は `on delete cascade` で**一緒に消える**。
//   だから画面側で「何名ぶん消えるのか」を見せてから押させる。
//   消えたことに後で気づく作りにしない。
//
// 🔴 現場（sites）は消さない。消すのは枠（shifts）だけ。
//   現場は他の日の枠からも参照されるうえ、ShiftMax 由来のマスタでもある。
//   マスタの削除は admin の操作（20260907120000_sites_insert_by_control.sql）。
// ─────────────────────────────────────────────────────────
export async function deleteShift(input: { shiftId: string }): Promise<ActionResult> {
  const supabase = await editorClient();

  const { error } = await supabase.from("shifts").delete().eq("id", input.shiftId);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 枠を直す（2026-09-09）
//
// 🔴 なぜ要るのか（柴山・2026-09-09）
//   「情報をそれぞれの枠から確認や編集ができないと使えたもんじゃない」。
//   これまで枠は**作る・中止する・消す**しかできず、時刻や人数を1つ直すために
//   枠を消して作り直すしかなかった。当日変更は通常業務（screen-design.md §2-7）なので、
//   そこが直せないのは致命的だった。
//
// 🔴 現場そのものは変えない。枠の付け替え（別現場へ移す）は「消して作る」でよい。
//   ここで現場を差し替えられるようにすると、配置済みの隊員が別現場へ黙って移る。
//
// ⚠️ 確定済みの枠を直しても止めない。当日変更は通常業務であり、
//   代わりに**枠が「仮組み」へ戻る**（確定し直しが要ることを状態そのもので表す）
//   🔴 2026-09-09 訂正：以前ここに「changed_after_confirm が立つ」と書いていたが、
//   その列は同じマイグレーションで**捨てられている**。元の migration だけ読んで書いた誤り。
//   （トリガーは 20260903120000_revert_shift_to_draft_on_change.sql）。
// ─────────────────────────────────────────────────────────
export async function updateShift(input: {
  shiftId: string;
  workKind: WorkKind;
  headcount: number;
  jobCounts: JobCounts;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
  breakMin: number;
  planComment: string;
  billingNote: string;
}): Promise<ActionResult> {
  const supabase = await editorClient();

  if (!Number.isFinite(input.headcount) || input.headcount < 1) {
    return { ok: false, message: "必要人数は1以上で入れてください。" };
  }

  const { error } = await supabase
    .from("shifts")
    .update({
      work_kind: input.workKind,
      headcount: input.headcount,
      ...jobCountColumns(input.jobCounts),
      start_h: input.startH,
      start_m: input.startM,
      end_h: input.endH,
      end_m: input.endM,
      break_min: input.breakMin,
      plan_comment: orNullText(input.planComment),
      billing_note: orNullText(input.billingNote),
    })
    .eq("id", input.shiftId);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 別の日の盤面を複写する（2026-10-05）
//
// 🔴 なぜ要るのか
//   本番には過去（7月）の枠しか無く、管制が「明日」を開くと盤面が空になる。
//   1日 約55枠を「現場を追加」で1件ずつ作るのは、べんり君より手数が多い。
//   べんり君では A表が約2か月前に出ており、**枠は先にあって、人を動かすのが日々の仕事**。
//   → 似た日を丸ごと写し、そこから直す形にする。
//
// 🔴 範囲は「1日 × 1管轄」。日勤・夜勤はまとめて写す。
//   中止の枠（cancelled_at・区分 dayCancel/nightCancel）は写さない ── 中止は繰り返さない。
//
// 🔴 二重に作らない。〈現場 × 区分〉ごとに「写す先に既にある数」を差し引く。
//   addShift は〈現場 × 区分 × 日〉に1件でもあれば作らないが、ここでは
//   同じ現場に同じ区分の枠が複数ある日（7月で実在する）をそのまま写したいので数で見る。
//
// 🔴 配置も写せる（柴山・2026-10-05）。ただし次の人は**置かずに理由を返す**：
//   ・休み … 終日の休み、または写す枠と同じ区分の休み
//   ・時間が重なる … 写す日（と前日の夜勤）の配置、今回写した配置と時間帯が重なる。
//     時刻を持たない予定（応援）はその日いっぱい埋まっているとみなす。
//     🔴 「同じ日に予定があれば置かない」ではない。日勤のあと夜Bに入る勤務が実在する
//   ・在籍していない
//   黙って落とすと「写したのに居ない」に見える。名前と理由を必ず返す。
//
// 🔴 写した枠はすべて仮組み。確定は管制が見てから押す。
//   draft の枠には重なりの制約（assignments_no_overlap）が効かないので、
//   上の「置かない」判定はここでしかできない。
// ─────────────────────────────────────────────────────────

/** 置かなかった人。画面にそのまま並べる */
export type CopySkip = { guardName: string; place: string; reason: string };

export type CopyDayResult =
  | {
      ok: true;
      /** 複写元にあった枠（中止を除く） */
      sourceShifts: number;
      created: number;
      /** 写す先に既にあったので作らなかった枠 */
      skippedShifts: number;
      placed: number;
      skips: CopySkip[];
    }
  | { ok: false; message: string };

const COPYABLE_KINDS: WorkKind[] = ["day", "nightA", "nightB"];

export async function copyDay(input: {
  jurisdictionId: string;
  fromDate: string;
  toDate: string;
  withAssignments: boolean;
}): Promise<CopyDayResult> {
  const supabase = await editorClient();
  const { jurisdictionId, fromDate, toDate } = input;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return { ok: false, message: "日付を選んでください。" };
  }
  if (fromDate === toDate) {
    return { ok: false, message: "複写元と同じ日には写せません。" };
  }

  // ── 複写元の枠 ──
  const { data: srcData, error: srcErr } = await supabase
    .from("shifts")
    .select(
      `id, site_id, work_kind, headcount, kentei_count, train_count, driver_count,
       start_h, start_m, end_h, end_m, break_min,
       plan_comment, billing_note, site:sites ( short_name )`,
    )
    .eq("work_date", fromDate)
    .eq("jurisdiction_id", jurisdictionId)
    .is("cancelled_at", null)
    .in("work_kind", COPYABLE_KINDS)
    .order("start_h")
    .order("start_m")
    .order("id");
  if (srcErr) return { ok: false, message: toMessage(srcErr) };

  type SrcShift = {
    id: string;
    site_id: string;
    work_kind: WorkKind;
    headcount: number;
    kentei_count: number;
    train_count: number;
    driver_count: number;
    start_h: number;
    start_m: number;
    end_h: number;
    end_m: number;
    break_min: number;
    plan_comment: string | null;
    billing_note: string | null;
    site: { short_name: string } | null;
  };
  const source = (srcData ?? []) as unknown as SrcShift[];
  if (source.length === 0) {
    return { ok: false, message: "複写元の日に枠がありません（中止の枠は写しません）。" };
  }

  // ── 写す先に既にある枠の数（〈現場 × 区分〉ごと） ──
  const { data: dstData, error: dstErr } = await supabase
    .from("shifts")
    .select("site_id, work_kind")
    .eq("work_date", toDate)
    .eq("jurisdiction_id", jurisdictionId);
  if (dstErr) return { ok: false, message: toMessage(dstErr) };

  const keyOf = (siteId: string, kind: string) => `${siteId}|${kind}`;
  const remaining = new Map<string, number>();
  for (const r of dstData ?? []) {
    const k = keyOf(r.site_id as string, r.work_kind as string);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }

  // 🔴 id はこちらで振る。insert の戻り順に頼らずに「元の枠 → 新しい枠」を対応づけるため
  const plan: { src: SrcShift; newId: string }[] = [];
  for (const s of source) {
    const k = keyOf(s.site_id, s.work_kind);
    const left = remaining.get(k) ?? 0;
    if (left > 0) {
      remaining.set(k, left - 1);
      continue;
    }
    plan.push({ src: s, newId: crypto.randomUUID() });
  }

  const result = {
    ok: true as const,
    sourceShifts: source.length,
    created: plan.length,
    skippedShifts: source.length - plan.length,
    placed: 0,
    skips: [] as CopySkip[],
  };
  if (plan.length === 0) return result;

  const { error: insErr } = await supabase.from("shifts").insert(
    plan.map(({ src, newId }) => ({
      id: newId,
      site_id: src.site_id,
      work_date: toDate,
      jurisdiction_id: jurisdictionId,
      work_kind: src.work_kind,
      headcount: src.headcount,
      kentei_count: src.kentei_count,
      train_count: src.train_count,
      driver_count: src.driver_count,
      start_h: src.start_h,
      start_m: src.start_m,
      end_h: src.end_h,
      end_m: src.end_m,
      break_min: src.break_min,
      plan_comment: src.plan_comment,
      billing_note: src.billing_note,
      status: "draft",
    })),
  );
  if (insErr) return { ok: false, message: toMessage(insErr) };

  if (!input.withAssignments) {
    refresh();
    return result;
  }

  // 🔴 配置で失敗したら、作った枠ごと取り消す（配置は cascade で一緒に消える）。
  //   「枠だけ写って人が居ない」で残すと、写し直しても二重防止で枠が作られず直せない
  const undo = async (message: string): Promise<CopyDayResult> => {
    await supabase
      .from("shifts")
      .delete()
      .in(
        "id",
        plan.map((p) => p.newId),
      );
    return { ok: false, message };
  };

  // ── 複写元の配置 ──
  const planBySrc = new Map(plan.map((p) => [p.src.id, p]));
  const { data: srcAsg, error: saErr } = await supabase
    .from("assignments")
    .select("shift_id, guard_id, role, job_type, position")
    .in("shift_id", [...planBySrc.keys()])
    .eq("kind", "site")
    .eq("status", "planned")
    .order("position");
  if (saErr) return undo(toMessage(saErr));

  const asgRows = (srcAsg ?? []) as {
    shift_id: string;
    guard_id: string;
    role: string;
    job_type: JobType | null;
    position: number;
  }[];
  if (asgRows.length === 0) {
    refresh();
    return result;
  }

  // ── 写す先の日の予定（全管轄。別の管轄に入っている人も見る） ──
  // 🔴 前日も取る。前日の夜勤は work_date が前日のまま、写す日の朝まで続く
  const { data: dayAsg, error: daErr } = await supabase
    .from("assignments")
    .select(
      `guard_id, work_date, kind, off_kind, off_work_kind, planned_start_at, planned_end_at,
       shift:shifts ( work_kind, site:sites ( short_name ) )`,
    )
    .gte("work_date", addDays(toDate, -1))
    .lte("work_date", toDate)
    .eq("status", "planned");
  if (daErr) return undo(toMessage(daErr));

  const guardIds = [...new Set(asgRows.map((a) => a.guard_id))];
  const { data: guardData, error: gErr } = await supabase
    .from("guards")
    .select("id, name, status")
    .in("id", guardIds);
  if (gErr) return undo(toMessage(gErr));
  const guardById = new Map(
    ((guardData ?? []) as { id: string; name: string; status: string }[]).map((g) => [g.id, g]),
  );

  type DayRow = {
    guard_id: string;
    work_date: string;
    kind: string;
    off_kind: OffKind | null;
    off_work_kind: OffWorkKind | null;
    planned_start_at: string | null;
    planned_end_at: string | null;
    shift: { work_kind: WorkKind; site: { short_name: string } | null } | null;
  };

  // 🔴 「置けるか」は**時間帯の重なり**で見る（2026-10-05 訂正）。
  //   最初は「同じ日に予定があれば置かない」にしていたが、7/31 の実データに
  //   **日勤のあと夜Bにも入る**隊員がいて、実在した勤務が写せなかった。
  //   時刻は DB のトリガー（20260903000000_assignment_planned_times.sql）と同じ式で組む：
  //   終了が開始以前なら日跨ぎ。日付は JST の0時から数える。
  type Busy = { start: number; end: number; label: string };
  const dayStart = Date.parse(`${toDate}T00:00:00+09:00`);
  const spanOf = (s: { start_h: number; start_m: number; end_h: number; end_m: number }) => {
    const startMin = s.start_h * 60 + s.start_m;
    let endMin = s.end_h * 60 + s.end_m;
    if (endMin <= startMin) endMin += 24 * 60;
    return { start: dayStart + startMin * 60_000, end: dayStart + endMin * 60_000 };
  };

  // 終日の休み／区分つきの休み／時間帯の予定／終日の予定（時刻を持たない応援）
  const offAllDay = new Map<string, string>();
  const offByKind = new Map<string, Map<OffWorkKind, string>>();
  const busySpans = new Map<string, Busy[]>();
  const busyAllDay = new Map<string, string>();
  const addBusy = (guardId: string, b: Busy) =>
    busySpans.set(guardId, [...(busySpans.get(guardId) ?? []), b]);

  for (const a of (dayAsg ?? []) as unknown as DayRow[]) {
    if (a.kind === "off") {
      if (a.work_date !== toDate) continue; // 前日の休みは関係ない
      const label = a.off_kind ? OFF_KIND_LABEL[a.off_kind] : "休み";
      if (!a.off_work_kind) {
        offAllDay.set(a.guard_id, label);
      } else {
        const m = offByKind.get(a.guard_id) ?? new Map<OffWorkKind, string>();
        m.set(a.off_work_kind, label);
        offByKind.set(a.guard_id, m);
      }
      continue;
    }
    if (a.planned_start_at && a.planned_end_at) {
      const site = a.shift?.site?.short_name ?? "別の現場";
      const kind = a.shift ? WORK_KIND_LABEL[a.shift.work_kind] : "";
      addBusy(a.guard_id, {
        start: Date.parse(a.planned_start_at),
        end: Date.parse(a.planned_end_at),
        label: `${a.work_date === toDate ? "" : "前日の"}${site}${kind ? "・" + kind : ""}に配置済み`,
      });
    } else if (a.work_date === toDate) {
      // 🔴 時刻を持たない予定（応援など）は、その日いっぱい埋まっているとみなす
      busyAllDay.set(a.guard_id, a.kind === "lent_out" ? "応援に出ている" : "別の予定あり");
    }
  }

  const rows: {
    guard_id: string;
    shift_id: string;
    work_date: string;
    kind: "site";
    role: string;
    job_type: JobType | null;
    position: number;
    status: "planned";
  }[] = [];
  for (const a of asgRows) {
    const p = planBySrc.get(a.shift_id);
    if (!p) continue;
    const guard = guardById.get(a.guard_id);
    const place = `${p.src.site?.short_name ?? "（現場名なし）"}・${WORK_KIND_LABEL[p.src.work_kind]}`;
    const skip = (reason: string) =>
      result.skips.push({ guardName: guard?.name ?? "（氏名不明）", place, reason });

    if (!guard || guard.status !== "active") {
      skip("在籍していない");
      continue;
    }
    const allDay = offAllDay.get(a.guard_id);
    if (allDay) {
      skip(`休み（${allDay}）`);
      continue;
    }
    // COPYABLE_KINDS で絞っているので、枠の区分は休みの区分と同じ値の集合
    const partial = offByKind.get(a.guard_id)?.get(p.src.work_kind as OffWorkKind);
    if (partial) {
      skip(`休み（${partial}・${WORK_KIND_LABEL[p.src.work_kind]}）`);
      continue;
    }
    const allDayBusy = busyAllDay.get(a.guard_id);
    if (allDayBusy) {
      skip(`同じ日に予定あり（${allDayBusy}）`);
      continue;
    }
    const span = spanOf(p.src);
    const clash = (busySpans.get(a.guard_id) ?? []).find(
      (b) => span.start < b.end && b.start < span.end,
    );
    if (clash) {
      skip(`時間が重なる（${clash.label}）`);
      continue;
    }
    // 🔴 work_date / planned_* はトリガーが枠から埋める（placeGuard と同じ）
    rows.push({
      guard_id: a.guard_id,
      shift_id: p.newId,
      work_date: toDate,
      kind: "site",
      role: a.role,
      // 🔴 職種も写す。同じ人が同じ現場に入るなら、役も同じであることが多い
      job_type: a.job_type,
      position: a.position,
      status: "planned",
    });
    // 今回置いた人も予定に足す（同じ時間帯に2か所へ写さない）
    addBusy(a.guard_id, { ...span, label: `${place}に複写済み` });
  }

  if (rows.length > 0) {
    const { error: aErr } = await supabase.from("assignments").insert(rows);
    if (aErr) return undo(toMessage(aErr));
  }
  result.placed = rows.length;

  refresh();
  return result;
}

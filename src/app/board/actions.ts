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
import { addDays, formatSpanPlace } from "@/lib/board-format";
import { findOverlaps, type Span } from "@/lib/overlap";
import { createClient } from "@/lib/supabase/server";
import type { WorkKind } from "@/lib/types";

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
  return `保存できませんでした（${error.message}）`;
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

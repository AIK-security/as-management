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
import { addDays } from "@/lib/board-format";
import { createClient } from "@/lib/supabase/server";

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

type OverlapRow = {
  shift_id: string | null;
  planned_start_at: string;
  planned_end_at: string;
  is_confirmed: boolean;
  guard: { name: string; short_name: string } | null;
  shift: { site: { short_name: string } | null } | null;
};

/** timestamptz を JST の HH:MM にする。表示のためだけに使う */
function jstHm(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function label(r: OverlapRow): string {
  // 貸出・非現場は枠を持たない。名前が出せないより「現場外」と言うほうがまし
  const site = r.shift?.site?.short_name ?? "現場外の稼働";
  return `${site}（${jstHm(r.planned_start_at)}–${jstHm(r.planned_end_at)}）`;
}

/**
 * これから確定しようとしている枠のせいで、時間帯が重なる隊員を洗い出す。
 * @param shiftIds 確定しようとした枠
 * @returns 「氏名：A と B が重なっています」の配列。空なら説明できなかった
 */
async function describeOverlaps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shiftIds: string[],
): Promise<string[]> {
  const { data: targets } = await supabase
    .from("shifts")
    .select("work_date")
    .in("id", shiftIds);
  const dates = (targets ?? []).map((s) => s.work_date as string).sort();
  if (dates.length === 0) return [];

  // 🔴 前後1日を含める。夜勤は work_date が**開始日**なので、
  //   翌朝までかかる枠は隣の日の枠と重なりうる（20:00–06:00）。
  const { data } = await supabase
    .from("assignments")
    .select(
      "shift_id, planned_start_at, planned_end_at, is_confirmed, " +
        "guard:guards ( name, short_name ), shift:shifts ( site:sites ( short_name ) )",
    )
    .eq("status", "planned")
    .gte("work_date", addDays(dates[0], -1))
    .lte("work_date", addDays(dates[dates.length - 1], 1))
    .not("planned_start_at", "is", null)
    .not("planned_end_at", "is", null);

  const targetIds = new Set(shiftIds);
  const rows = ((data ?? []) as unknown as OverlapRow[]).filter(
    // 確定後に制約が見る行＝すでに確定済み ＋ 今回確定しようとしている枠の行
    (r) => r.is_confirmed || (r.shift_id !== null && targetIds.has(r.shift_id)),
  );

  const byGuard = new Map<string, OverlapRow[]>();
  for (const r of rows) {
    const key = r.guard?.name ?? "（氏名不明）";
    byGuard.set(key, [...(byGuard.get(key) ?? []), r]);
  }

  const messages = new Set<string>();
  for (const [name, list] of byGuard) {
    const sorted = [...list].sort((a, b) => a.planned_start_at.localeCompare(b.planned_start_at));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (Date.parse(b.planned_start_at) >= Date.parse(a.planned_end_at)) break; // 以降は重ならない
        // 🔴 既に両方とも確定済みなら、今回の確定が原因ではない。
        //   （そもそも DB が許していないはずだが、原因でないものを挙げない）
        const causedByThis = !a.is_confirmed || !b.is_confirmed;
        if (!causedByThis) continue;
        messages.add(`${name}：${label(a)} と ${label(b)}`);
      }
    }
  }
  return [...messages];
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
    .eq("status", "draft");
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

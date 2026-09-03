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
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; message: string };

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
  if (error) return { ok: false, message: toMessage(error) };

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
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

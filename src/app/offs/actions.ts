// S-08 休み管理の書き込み（2026-09-16）。
//
// 🔴 認可は3枚重ね（CLAUDE.md）。ここは2枚目の関門。
//   Server Action は URL であり、画面にボタンを出さないだけでは呼ばれるのを防げない。
//
// 🔴 「塗る」入力に合わせて**置き換え**で書く。
//   セルを1回押すたびに差分を考えるのではなく、
//   その日のその隊員の休みを**いったん消してから入れ直す**。
//   1名体制では、状態の遷移が増えるほど読めなくなる（設計原則3）。
//
// 🔴 配置が入っている日に休みを入れても**止めない**。
//   「止めるのは時間帯の重複だけ。あとは警告」（screen-design.md §2-5）と同じ扱いで、
//   当日変更は通常業務である以上、先に休みを入れて配置を外す手順もありうる。
//   画面側（OffGrid）が印で見せる。
"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { OffKind, OffWorkKind } from "@/lib/types";

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * その隊員のその日の休みを置き換える。
 *
 * - `offKind` が null … その日の休みを**すべて消す**
 * - `offWorkKind` が null … 終日休み。区分ごとの休みも消してから1行だけ入れる
 * - `offWorkKind` を指定 … 一部勤務可。**終日休みと同じ区分**は消すが、
 *   他の区分の休みは残す（「日勤も夜Aも休み」は2行で表す）
 */
export async function setOff(input: {
  guardId: string;
  workDate: string;
  offKind: OffKind | null;
  offWorkKind: OffWorkKind | null;
}): Promise<ActionResult> {
  await requireRole("control", "admin");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) {
    return { ok: false, message: "日付の形式が正しくありません。" };
  }

  const supabase = await createClient();

  // 🔴 消す範囲は kind='off' に限る。配置（'site'）や貸出（'lent_out'）まで消さない。
  function delOff() {
    return supabase
      .from("assignments")
      .delete()
      .eq("guard_id", input.guardId)
      .eq("work_date", input.workDate)
      .eq("kind", "off");
  }

  if (input.offKind === null) {
    const { error } = await delOff();
    if (error) return { ok: false, message: `休みを消せませんでした：${error.message}` };
    refresh();
    return { ok: true };
  }

  if (input.offWorkKind === null) {
    // 終日休み。その日の休みは全部消してから1行にする
    const { error } = await delOff();
    if (error) return { ok: false, message: `休みを置き換えられませんでした：${error.message}` };
  } else {
    // 一部勤務可。終日休みと、同じ区分の行だけ消す
    const { error } = await delOff().or(
      `off_work_kind.is.null,off_work_kind.eq.${input.offWorkKind}`,
    );
    if (error) return { ok: false, message: `休みを置き換えられませんでした：${error.message}` };
  }

  const { error } = await supabase.from("assignments").insert({
    guard_id: input.guardId,
    work_date: input.workDate,
    kind: "off",
    off_kind: input.offKind,
    off_work_kind: input.offWorkKind,
  });
  if (error) return { ok: false, message: `休みを入れられませんでした：${error.message}` };

  refresh();
  return { ok: true };
}

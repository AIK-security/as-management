// NG リストの書き込み（2026-09-08）。
//
// 🔴 認可は3枚重ね。ここは2枚目の関門。
//   ng_entries の RLS は can_edit()＝control / admin
//   （20260902000000_board_core.sql「新規マスタの編集は control」）。
//   **Server Action は URL である。** 画面にボタンを出さないだけでは防げない。
//
// 🔴 NG は「弾く」ためのものではない。
//   配置の完全自動化は目指さない（8/27 決定）。ここで貯めた内容は
//   配置ボードの ⚠要確認 に**警告として**出るだけで、配置は止めない。
//   severity='block' も同じ（止めるのは重複だけ・screen-design.md §2-5）。
"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { NgKind, NgReasonKind, NgSeverity } from "@/lib/masters";

export type ActionResult = { ok: true } | { ok: false; message: string };

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "この操作の権限がありません。";
  // 23514 = check 制約違反。ng_entries_kind_shape に触れるのはこの画面のバグ
  if (error.code === "23514") {
    return "組み合わせが正しくありません（現場NGなら現場、人×人なら相手の隊員が要ります）。";
  }
  return `保存できませんでした（${error.message}）`;
}

export async function addNgEntry(input: {
  kind: NgKind;
  guardId: string;
  /** kind='site_guard' のとき必須 */
  siteId?: string;
  /** kind='guard_guard' のとき必須 */
  counterpartGuardId?: string;
  reasonKind: NgReasonKind;
  reason: string;
  severity: NgSeverity;
}): Promise<ActionResult> {
  await requireRole("control", "admin");

  const reason = input.reason.trim();
  // 🔴 理由を必須にする。DB も not null だが、ここで止めて日本語で言う。
  //   理由の無い NG は、入れた本人以外には**消してよいのか判断できない**。
  //   「誰も仕様を持っていない」状態から貯め始める以上、
  //   なぜ NG なのかが残らないと、あとで棚卸しができない。
  if (!reason) return { ok: false, message: "理由を入れてください。" };
  if (!input.guardId) return { ok: false, message: "隊員を選んでください。" };

  if (input.kind === "site_guard" && !input.siteId) {
    return { ok: false, message: "現場を選んでください。" };
  }
  if (input.kind === "guard_guard") {
    if (!input.counterpartGuardId) return { ok: false, message: "相手の隊員を選んでください。" };
    if (input.counterpartGuardId === input.guardId) {
      return { ok: false, message: "同じ隊員どうしは登録できません。" };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ng_entries").insert({
    kind: input.kind,
    guard_id: input.guardId,
    // 🔴 使わない側は必ず null にする。ng_entries_kind_shape の check が
    //   「site_guard なら counterpart は null」まで要求しているため。
    site_id: input.kind === "site_guard" ? input.siteId : null,
    counterpart_guard_id: input.kind === "guard_guard" ? input.counterpartGuardId : null,
    reason_kind: input.reasonKind,
    reason,
    severity: input.severity,
  });
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

/**
 * NG を消す。
 *
 * 🔴 消してよい。NG は配置の履歴ではなく**今の判断材料**で、
 *   間違って入れたものが残り続けるほうが害が大きい
 *   （誤った NG は「その人をそこへ出せない」と読まれ、人手が足りなくなる）。
 */
export async function deleteNgEntry(input: { id: string }): Promise<ActionResult> {
  await requireRole("control", "admin");

  const supabase = await createClient();
  const { error } = await supabase.from("ng_entries").delete().eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

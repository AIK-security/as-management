// 現場マスタの書き込み（2026-09-08）。
//
// 🔴 認可は3枚重ね。ここは2枚目の関門。**Server Action は URL である。**
//   RLS 側は 20260908000000_masters_editable_by_control.sql で can_edit() に開けた
//   （「いま作っている段階のものは管制が全操作できる」＝ 2026-09-08 の判断）。
//
// 🔴 なぜ編集が要るのか
//   9/7 に「現場を追加」で仮番号（TMP-）の現場を作れるようにしたが、
//   **本物の警備先番号に直す場所が無かった**。仮番号のままでは段3で引き渡せない。
"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; message: string };

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "この操作の権限がありません。";
  // 23505 = unique_violation。sites では site_code が unique
  if (error.code === "23505") {
    return "同じ現場コードが既にあります。別の値にしてください。";
  }
  // 23503 = foreign_key_violation。枠から参照されている現場は消せない
  if (error.code === "23503") {
    return "この現場を使っている配置枠が残っているため削除できません。枠を消すか、状態を「停止」にしてください。";
  }
  return `保存できませんでした（${error.message}）`;
}

export type SiteInput = {
  id: string;
  siteCode: string;
  guardTargetNo: string;
  name: string;
  shortName: string;
  nameKana: string;
  address: string;
  bandName: string;
  billingNo: string;
  planStartH: number | null;
  planStartM: number | null;
  planEndH: number | null;
  planEndM: number | null;
  planBreak: number | null;
  hasPlan: boolean;
  customerId: string;
  jurisdictionId: string;
  departmentId: string;
  status: string;
};

/** 空文字は null にする。text 列に "" を入れると「空欄」と「未設定」が混ざる。 */
function orNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

export async function updateSite(input: SiteInput): Promise<ActionResult> {
  await requireRole("control", "admin");

  // 🔴 NOT NULL の列はアプリ側でも止める。DB のエラー文をそのまま出しても
  //   管制には何のことか分からない。
  if (!input.name.trim()) return { ok: false, message: "現場名を入れてください。" };
  if (!input.shortName.trim()) return { ok: false, message: "略称を入れてください。" };
  if (!input.siteCode.trim()) return { ok: false, message: "現場コードを入れてください。" };
  if (!input.guardTargetNo.trim()) {
    return { ok: false, message: "警備先番号を入れてください。" };
  }
  if (!input.jurisdictionId) return { ok: false, message: "管轄を選んでください。" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sites")
    .update({
      site_code: input.siteCode.trim(),
      guard_target_no: input.guardTargetNo.trim(),
      name: input.name.trim(),
      short_name: input.shortName.trim(),
      name_kana: orNull(input.nameKana),
      address: orNull(input.address),
      band_name: orNull(input.bandName),
      billing_no: orNull(input.billingNo),
      plan_start_h: input.planStartH,
      plan_start_m: input.planStartM,
      plan_end_h: input.planEndH,
      plan_end_m: input.planEndM,
      plan_break: input.planBreak,
      has_plan: input.hasPlan,
      // 得意先・部署は「未設定」を許す（新規現場は得意先が後から決まる）
      customer_id: input.customerId || null,
      jurisdiction_id: input.jurisdictionId,
      department_id: input.departmentId || null,
      status: input.status,
    })
    .eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

/**
 * 現場を消す。
 *
 * 🔴 枠（shifts）から参照されていると DB が拒む（cascade を付けていない）。
 *   これは意図した安全装置。過去の配置ごと消えるほうが害が大きい。
 *   → 画面側では先に件数を出し、押す前に分かるようにしてある。
 *
 * 🔴 一緒に消えるもの：現場が求める資格・その現場のNG（どちらも cascade）。
 */
export async function deleteSite(input: { id: string }): Promise<ActionResult> {
  await requireRole("control", "admin");

  const supabase = await createClient();
  const { error } = await supabase.from("sites").delete().eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  // 消した現場の詳細に留まっても見るものが無いので一覧へ戻す
  redirect("/masters/sites");
}

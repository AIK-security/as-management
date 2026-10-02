// 現場マスタの書き込み（2026-09-08）。
//
// 🔴 認可は3枚重ね。ここは2枚目の関門。**Server Action は URL である。**
//   RLS 側は 20260908000000_masters_editable_by_control.sql で can_edit() に開けた
//   （「いま作っている段階のものは管制が全操作できる」＝ 2026-09-08 の判断）。
//
// 🔴 現場コードは DB が振る（AS0001〜）。ここでは作成・更新とも送らない。
//   警備先番号は現場に持たせない（duty_codes で引く ─ 2026-10-02）。
"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * 作成系の戻り値。**作った行の id を返す。**
 *
 * 🔴 以前はここで `redirect()` していたが、Next 16 は Server Action の
 *   内部リダイレクトを「クライアント側の Promise の reject」で返すだけで、
 *   素の `onClick` から `await` している呼び出しには**どこにも届かない**
 *   （＝作成はできるのに画面が動かず、ボタンが固まる）。
 *   遷移は画面側が `useRouter()` で行う。詳細は `src/lib/action-call.ts`。
 */
export type CreatedResult = { ok: true; id: string } | { ok: false; message: string };

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "この操作の権限がありません。";
  // 23503 = foreign_key_violation。枠から参照されている現場は消せない
  if (error.code === "23503") {
    return "この現場を使っている配置枠が残っているため削除できません。枠を消すか、状態を「停止」にしてください。";
  }
  return `保存できませんでした（${error.message}）`;
}

export type SiteInput = {
  id: string;
  name: string;
  shortName: string;
  nameKana: string;
  address: string;
  billingNo: string;
  customerCode: string;
  customerNo: string;
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
  if (!input.jurisdictionId) return { ok: false, message: "管轄を選んでください。" };
  // 🔴 得意先は必須（2026-10-02）。現場は〈現場名 × 得意先〉で1件
  if (!input.customerId) return { ok: false, message: "得意先を選んでください。" };
  // 🔴 時と分は組。片方だけ入った状態を通さない。
  //   Server Action は URL なので、画面側の検査だけに頼らない。
  if (
    (input.planStartH === null) !== (input.planStartM === null) ||
    (input.planEndH === null) !== (input.planEndM === null)
  ) {
    return { ok: false, message: "開始・終了の時刻は、時と分の両方を入れてください。" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("sites")
    .update({
      name: input.name.trim(),
      short_name: input.shortName.trim(),
      name_kana: orNull(input.nameKana),
      address: orNull(input.address),
      billing_no: orNull(input.billingNo),
      customer_code: orNull(input.customerCode),
      customer_no: orNull(input.customerNo),
      plan_start_h: input.planStartH,
      plan_start_m: input.planStartM,
      plan_end_h: input.planEndH,
      plan_end_m: input.planEndM,
      plan_break: input.planBreak,
      has_plan: input.hasPlan,
      // 部署は「未設定」を許す
      customer_id: input.customerId,
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
  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 現場が求める資格（2026-09-09 追加）
//
// 🔴 テーブルは最初からあったのに**貯める入口が無かった**。
//   配置ボードの資格警告はこの表を見ているので、入口が無い＝警告が永久に出ない。
//   NG リストで 9/8 に直したのと同じ穴が、資格でも空いていた。
// ─────────────────────────────────────────────────────────

export async function saveSiteRequiredQualification(input: {
  siteId: string;
  qualificationId: string;
  requiredCount: number;
}): Promise<ActionResult> {
  await requireRole("control", "admin");
  if (!input.qualificationId) return { ok: false, message: "資格を選んでください。" };
  if (!Number.isFinite(input.requiredCount) || input.requiredCount < 1) {
    return { ok: false, message: "必要人数は1以上で入れてください。" };
  }

  const supabase = await createClient();
  // (site_id, qualification_id) が unique なので upsert。
  // 「付ける」と「人数を直す」は管制から見れば同じ操作。
  const { error } = await supabase.from("site_required_qualifications").upsert(
    {
      site_id: input.siteId,
      qualification_id: input.qualificationId,
      required_count: input.requiredCount,
    },
    { onConflict: "site_id,qualification_id" },
  );
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

export async function removeSiteRequiredQualification(input: {
  id: string;
}): Promise<ActionResult> {
  await requireRole("control", "admin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_required_qualifications")
    .delete()
    .eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 現場を新しく作る（2026-09-09）
//
// 🔴 これまで現場を作れるのは配置ボードの「現場を追加」だけだった。
//   マスタ側に入口が無いのは「一般的な情報の入力と保存ができる」の穴。
//
// 🔴 入れるのは最小限だけにする。速さが要るのは**作るとき**であって、
//   残りは作成後の詳細画面で埋める（詳細を項目全部出しにしてあるのはこのため）。
// ─────────────────────────────────────────────────────────
export async function createSite(input: {
  name: string;
  shortName: string;
  jurisdictionId: string;
  customerId: string;
}): Promise<CreatedResult> {
  await requireRole("control", "admin");

  const name = input.name.trim();
  if (!name) return { ok: false, message: "現場名を入れてください。" };
  if (!input.jurisdictionId) return { ok: false, message: "管轄を選んでください。" };
  if (!input.customerId) return { ok: false, message: "得意先を選んでください。" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .insert({
      name,
      short_name: input.shortName.trim() || name.slice(0, 8),
      jurisdiction_id: input.jurisdictionId,
      customer_id: input.customerId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: toMessage(error) };

  // 作ったら詳細へ。残りの項目はそこで埋める
  refresh();
  return { ok: true, id: data.id as string };
}

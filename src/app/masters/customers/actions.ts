// 得意先マスタの書き込み（2026-09-09）。
//
// 🔴 認可は3枚重ね。ここは2枚目の関門。**Server Action は URL である。**
//   RLS 側は customers が can_edit()（20260908000000）。
//
// 🔴 担当コード（staff_code）は NOT NULL かつ unique。
//   ShiftMax の実質キーであり、請求まで通って初めて意味を持つ列なので、
//   空欄も重複も**アプリ側で止めて日本語で言う**。
"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; message: string };

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "この操作の権限がありません。";
  if (error.code === "23505") {
    return "同じ担当コードが既にあります。別の値にしてください。";
  }
  if (error.code === "23503") {
    return "この得意先の現場が残っているため削除できません。先に現場の得意先を付け替えてください。";
  }
  return `保存できませんでした（${error.message}）`;
}

/** 空文字は null にする。text 列に "" を入れると「空欄」と「未設定」が混ざる。 */
function orNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

export type CustomerInput = {
  id: string;
  staffCode: string;
  name: string;
  nameKana: string;
  contactName: string;
  billingNo: string;
  billingName: string;
  jurisdictionId: string;
  departmentId: string;
};

export async function updateCustomer(input: CustomerInput): Promise<ActionResult> {
  await requireRole("control", "admin");

  if (!input.name.trim()) return { ok: false, message: "顧客名を入れてください。" };
  if (!input.staffCode.trim()) {
    return { ok: false, message: "担当コードを入れてください（ShiftMax の実質キーです）。" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({
      staff_code: input.staffCode.trim(),
      name: input.name.trim(),
      name_kana: orNull(input.nameKana),
      contact_name: orNull(input.contactName),
      billing_no: orNull(input.billingNo),
      billing_name: orNull(input.billingName),
      // 管轄・部署は未設定を許す（customers は jurisdiction_id も nullable）
      jurisdiction_id: input.jurisdictionId || null,
      department_id: input.departmentId || null,
    })
    .eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

/**
 * 得意先を消す。
 *
 * 🔴 現場（sites.customer_id）から参照されていると DB が拒む（cascade 無し）。
 *   得意先を消して現場が道連れになるほうが、はるかに害が大きい。
 *   → 画面側では先に現場の件数を出し、押す前に分かるようにしてある。
 */
export async function deleteCustomer(input: { id: string }): Promise<ActionResult> {
  await requireRole("control", "admin");

  const supabase = await createClient();
  const { error } = await supabase.from("customers").delete().eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  redirect("/masters/customers");
}

// ─────────────────────────────────────────────────────────
// 得意先を新しく作る（2026-09-09）
//
// ⚠️ 2026-09-07 に「配置ボードでは得意先を新規作成しない」と決めている。
//   理由は ShiftMax 由来のマスタで、請求（第2弾）の突き合わせに使うため
//   勝手に増やすと合わなくなること。**その判断はここでも生きている。**
//   ただし配置の途中で勝手に増えるのと、**マスタ画面で意図して足す**のは別。
//   → 入口はマスタ側にだけ置く。配置ボードからは今までどおり作れない。
//
// 🔴 担当コードは ShiftMax の実質キー。ここで採番規則は決めない
//   （実データ取込の段で、既存603件と衝突しない採番を決める）。
// ─────────────────────────────────────────────────────────
export async function createCustomer(input: {
  name: string;
  staffCode: string;
  nameKana: string;
  contactName: string;
}): Promise<ActionResult> {
  await requireRole("control", "admin");

  const name = input.name.trim();
  if (!name) return { ok: false, message: "顧客名を入れてください。" };
  if (!input.staffCode.trim()) {
    return { ok: false, message: "担当コードを入れてください（ShiftMax の実質キーです）。" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      name,
      staff_code: input.staffCode.trim(),
      name_kana: orNull(input.nameKana),
      contact_name: orNull(input.contactName),
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: toMessage(error) };

  redirect(`/masters/customers/${data.id}`);
}

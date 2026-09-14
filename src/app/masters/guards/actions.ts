// 隊員マスタの書き込み（2026-09-09）。
//
// 🔴 認可は3枚重ね。ここは2枚目の関門。**Server Action は URL である。**
//   RLS 側は guards が can_edit()（20260908000000）、
//   guard_contacts / guard_qualifications は最初から can_edit()（20260902000000）。
//   → **新しいマイグレーションは要らない**（確認済み・2026-09-09）。
//
// 🔴 なぜ編集が要るのか
//   一覧だけでは「見えるが直せない」。9/7 の現場と同じ穴を隊員でも作らないため。
//   資格と連絡先が**別テーブル**なのは有効期限と到達可否のためで（data-model.md §5-2）、
//   詳細画面でそこを触れないなら、テーブルに分けた意味が無い。
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
  // 23505 = unique_violation。guards では staff_code、guard_qualifications では (隊員, 資格)
  if (error.code === "23505") {
    return "同じ値が既に登録されています（個人コード、または同じ資格の重複）。";
  }
  // 23503 = foreign_key_violation。稼働が残っている隊員は消せない
  if (error.code === "23503") {
    return "この隊員の稼働（配置）が残っているため削除できません。状態を「停止」にしてください。";
  }
  return `保存できませんでした（${error.message}）`;
}

/** 空文字は null にする。text 列に "" を入れると「空欄」と「未設定」が混ざる。 */
function orNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

// ─────────────────────────────────────────────────────────
// 隊員そのもの
// ─────────────────────────────────────────────────────────

export type GuardInput = {
  id: string;
  staffCode: string;
  guardNo: string;
  name: string;
  shortName: string;
  nameKana: string;
  email: string;
  companyId: string;
  jurisdictionId: string;
  departmentId: string;
  employmentType: string;
  status: string;
  note: string;
};

export async function updateGuard(input: GuardInput): Promise<ActionResult> {
  await requireRole("control", "admin");

  // 🔴 NOT NULL の列はアプリ側でも止める。DB のエラー文は管制には通じない。
  if (!input.name.trim()) return { ok: false, message: "氏名を入れてください。" };
  if (!input.shortName.trim()) {
    return { ok: false, message: "略称を入れてください（プレートに出ます）。" };
  }
  if (!input.companyId) return { ok: false, message: "会社を選んでください。" };
  if (!input.jurisdictionId) return { ok: false, message: "管轄を選んでください。" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("guards")
    .update({
      // 🔴 個人コードは**協力会社の隊員が持たない**（board_core.sql:110 のコメント）。
      //   空欄を "" ではなく null にしないと、unique 制約で2人目以降が弾かれる。
      staff_code: orNull(input.staffCode),
      guard_no: orNull(input.guardNo),
      name: input.name.trim(),
      short_name: input.shortName.trim(),
      name_kana: orNull(input.nameKana),
      email: orNull(input.email),
      company_id: input.companyId,
      jurisdiction_id: input.jurisdictionId,
      department_id: input.departmentId || null,
      employment_type: input.employmentType,
      status: input.status,
      note: orNull(input.note),
    })
    .eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

/**
 * 隊員を消す。
 *
 * 🔴 稼働（assignments）から参照されていると DB が拒む（cascade を付けていない）。
 *   意図した安全装置。→ 画面側で先に件数を出し、押す前に分かるようにしてある。
 * 🔴 一緒に消えるもの：連絡先・資格・NG（どれも cascade）。
 */
export async function deleteGuard(input: { id: string }): Promise<ActionResult> {
  await requireRole("control", "admin");

  const supabase = await createClient();
  const { error } = await supabase.from("guards").delete().eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 資格の付け外し
// ─────────────────────────────────────────────────────────

export type GuardQualificationInput = {
  guardId: string;
  qualificationId: string;
  number: string;
  issuedOn: string;
  expiresOn: string;
};

/**
 * 資格を付ける／中身を直す。
 *
 * 🔴 (guard_id, qualification_id) が unique なので upsert にする。
 *   「付ける」と「直す」を別の操作にすると、既にある資格を選んだときだけ
 *   エラーになる画面ができあがる（管制から見れば同じ操作）。
 */
export async function saveGuardQualification(
  input: GuardQualificationInput,
): Promise<ActionResult> {
  await requireRole("control", "admin");
  if (!input.qualificationId) return { ok: false, message: "資格を選んでください。" };

  const supabase = await createClient();
  const { error } = await supabase.from("guard_qualifications").upsert(
    {
      guard_id: input.guardId,
      qualification_id: input.qualificationId,
      number: orNull(input.number),
      issued_on: orNull(input.issuedOn),
      // 🔴 期限は null を許す（「切れない資格」を表す）。空欄を今日で埋めない。
      expires_on: orNull(input.expiresOn),
    },
    { onConflict: "guard_id,qualification_id" },
  );
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

export async function removeGuardQualification(input: { id: string }): Promise<ActionResult> {
  await requireRole("control", "admin");

  const supabase = await createClient();
  const { error } = await supabase.from("guard_qualifications").delete().eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 連絡先
// ─────────────────────────────────────────────────────────

export type GuardContactInput = {
  id: string | null; // null = 新規
  guardId: string;
  kind: string;
  value: string;
  reachable: boolean;
  isPrimary: boolean;
};

export async function saveGuardContact(input: GuardContactInput): Promise<ActionResult> {
  await requireRole("control", "admin");
  if (!input.value.trim()) return { ok: false, message: "連絡先を入れてください。" };

  const supabase = await createClient();
  const row = {
    guard_id: input.guardId,
    kind: input.kind,
    value: input.value.trim(),
    reachable: input.reachable,
    is_primary: input.isPrimary,
  };

  // 🔴 新規のときも id を受け取る。「主」を1件に保つのに**行を特定する必要がある**ため
  //   （値で照合すると、同じ番号を2件登録したときに新しいほうまで降ろしてしまう）。
  const { data, error } = input.id
    ? await supabase.from("guard_contacts").update(row).eq("id", input.id).select("id").single()
    : await supabase.from("guard_contacts").insert(row).select("id").single();
  if (error) return { ok: false, message: toMessage(error) };

  // 🔴 主連絡先は1件に保つ。DB に制約は無いので、ここで他を降ろす。
  //   複数が「主」だと、一斉連絡（S-03）の宛先がどれを採るか決まらない。
  if (input.isPrimary) {
    const { error: e2 } = await supabase
      .from("guard_contacts")
      .update({ is_primary: false })
      .eq("guard_id", input.guardId)
      .eq("is_primary", true)
      .neq("id", data.id);
    if (e2) return { ok: false, message: toMessage(e2) };
  }

  refresh();
  return { ok: true };
}

export async function deleteGuardContact(input: { id: string }): Promise<ActionResult> {
  await requireRole("control", "admin");

  const supabase = await createClient();
  const { error } = await supabase.from("guard_contacts").delete().eq("id", input.id);
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 隊員を新しく作る（2026-09-09）
//
// 🔴 これが無いのは第1弾の要件に直接ひびいていた。
//   **協力会社の隊員は ShiftMax に個人単位で存在しない**（CLAUDE.md・8/31 実データで確認）。
//   ＝ 新システムがゼロから持つしかないのに、**登録する画面が無かった**。
//
// 🔴 個人コードは空でよい（協力会社は採番されていない）。
//   空文字ではなく null で入れる ─ unique 制約があるため "" だと2人目が弾かれる。
// ─────────────────────────────────────────────────────────
export async function createGuard(input: {
  name: string;
  shortName: string;
  nameKana: string;
  staffCode: string;
  companyId: string;
  jurisdictionId: string;
  employmentType: string;
}): Promise<CreatedResult> {
  await requireRole("control", "admin");

  const name = input.name.trim();
  if (!name) return { ok: false, message: "氏名を入れてください。" };
  if (!input.companyId) return { ok: false, message: "会社を選んでください。" };
  if (!input.jurisdictionId) return { ok: false, message: "管轄を選んでください。" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guards")
    .insert({
      name,
      // 略称はプレートに出る。空なら氏名の先頭4字（日本語の氏名はここで足りる）
      short_name: input.shortName.trim() || name.slice(0, 4),
      name_kana: orNull(input.nameKana),
      staff_code: orNull(input.staffCode),
      company_id: input.companyId,
      jurisdiction_id: input.jurisdictionId,
      employment_type: input.employmentType,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: toMessage(error) };

  refresh();
  return { ok: true, id: data.id as string };
}

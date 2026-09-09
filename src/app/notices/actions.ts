// 一斉連絡（S-03）の書き込み（2026-09-09）。
//
// 🔴 認可は3枚重ね。ここは2枚目の関門。**Server Action は URL である。**
//   RLS 側は notices / notice_targets / message_templates とも can_edit()（20260909120000）。
//
// 🔴 「送信済にする」は**自己申告**。実際の送信は外（LINE・電話・会社への連絡）で行うため、
//   システムが知れるのは「送ったと宣言した」ことだけ。
//   それでも**二重連絡は防げる**し、取りこぼしを後から追える。
"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; message: string };

export type RecordNoticeInput = {
  workDate: string;
  jurisdictionId: string;
  shiftGroup: "day" | "night";
  kind: string;
  body: string;
  templateId: string | null;
  targets: { guardId: string; channel: "line" | "phone" | "company"; companyId: string | null }[];
};

export async function recordNotice(input: RecordNoticeInput): Promise<ActionResult> {
  const { profile } = await requireRole("control", "admin");

  if (input.targets.length === 0) {
    return { ok: false, message: "宛先が1人もいません。" };
  }
  if (!input.body.trim()) {
    return { ok: false, message: "文面が空です。" };
  }

  const supabase = await createClient();

  const counts = input.targets.reduce(
    (acc, t) => ({ ...acc, [t.channel]: acc[t.channel] + 1 }),
    { line: 0, phone: 0, company: 0 },
  );

  const { data: notice, error } = await supabase
    .from("notices")
    .insert({
      work_date: input.workDate,
      jurisdiction_id: input.jurisdictionId,
      shift_group: input.shiftGroup,
      kind: input.kind,
      // 🔴 テンプレは後から変わる。**そのとき送った本文を写して持つ**
      body: input.body,
      template_id: input.templateId,
      target_count: input.targets.length,
      reachable_count: counts.line,
      phone_count: counts.phone,
      company_count: counts.company,
      sent_at: new Date().toISOString(),
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `記録できませんでした（${error.message}）` };

  const { error: tErr } = await supabase.from("notice_targets").insert(
    input.targets.map((t) => ({
      notice_id: notice.id,
      guard_id: t.guardId,
      channel: t.channel,
      company_id: t.companyId,
    })),
  );
  if (tErr) {
    // 🔴 明細が入らなかったら親も残さない。「送ったが誰にか分からない」記録は害になる
    await supabase.from("notices").delete().eq("id", notice.id);
    return { ok: false, message: `宛先を記録できませんでした（${tErr.message}）` };
  }

  refresh();
  return { ok: true };
}

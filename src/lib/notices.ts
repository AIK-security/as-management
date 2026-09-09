// 一斉連絡（S-03）のデータ層（2026-09-09）。
//
// 🔴 この画面の価値は「送ること」ではない。
//   LINE が繋がらない隊員が約4割（2026-08-27 管制ヒアリング）。
//   **その約4割を取りこぼさないこと**が目的なので、
//   宛先を **LINE可 / 電話 / 協力会社経由** の3つに分けて返すのがこの層の仕事。
//
// 🔴 協力会社の隊員は**所属会社経由**（2026-09-09 決定）。本人へ直接送らない。
//
// ⚠️ 暫定方針であり確定ではない（screen-design.md §4-1）。9/16 の管制ヒアリングで詰める。
import { createClient } from "@/lib/supabase/server";
import type { BoardShiftGroup } from "@/lib/board";
// 🔴 型と差し込みは notice-format 側に置く（クライアントからも読むため）。
//   ここで再輸出しておくと、サーバ側は "@/lib/notices" だけを見ればよい。
import type { MessageTemplate, NoticeChannel, NoticeTarget } from "@/lib/notice-format";

export type { MessageTemplate, NoticeChannel, NoticeTarget } from "@/lib/notice-format";
export { fillTemplate } from "@/lib/notice-format";

const GROUP_WORK_KINDS: Record<BoardShiftGroup, string[]> = {
  day: ["day", "dayCancel"],
  night: ["nightA", "nightB", "nightCancel"],
};

function hhmm(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * その日・その管轄・日勤/夜勤に配置されている隊員を、連絡の宛先として返す。
 *
 * 🔴 貸出（lent_out）と休み（off）は宛先に含めない。
 *   貸出は相手先の現場で、休みはそもそも行かない。連絡すると混乱を生む。
 */
export async function getNoticeTargets(
  workDate: string,
  jurisdictionId: string,
  group: BoardShiftGroup,
): Promise<NoticeTarget[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("assignments")
    .select(
      `id, guard_id, kind, status,
       guard:guards (
         id, name, short_name, company_id,
         company:companies ( id, name, kind, contact_email ),
         guard_contacts ( kind, value, reachable, is_primary )
       ),
       shift:shifts!inner (
         id, work_date, jurisdiction_id, work_kind, band_name, plan_comment,
         start_h, start_m, end_h, end_m, cancelled_at, changed_after_confirm,
         site:sites ( name )
       )`,
    )
    .eq("kind", "site")
    .eq("work_date", workDate)
    .eq("shift.work_date", workDate)
    .eq("shift.jurisdiction_id", jurisdictionId)
    .in("shift.work_kind", GROUP_WORK_KINDS[group]);
  if (error) throw new Error(`連絡の宛先の取得に失敗しました: ${error.message}`);

  type Raw = {
    guard_id: string;
    status: string;
    guard: {
      id: string;
      name: string;
      short_name: string;
      company: { id: string; name: string; kind: string; contact_email: string | null } | null;
      guard_contacts: { kind: string; value: string; reachable: boolean; is_primary: boolean }[];
    } | null;
    shift: {
      id: string;
      band_name: string | null;
      plan_comment: string | null;
      start_h: number;
      start_m: number;
      end_h: number;
      end_m: number;
      cancelled_at: string | null;
      changed_after_confirm: boolean;
      site: { name: string } | null;
    } | null;
  };

  const rows = (data ?? []) as unknown as Raw[];
  const out: NoticeTarget[] = [];

  for (const r of rows) {
    if (!r.guard || !r.shift) continue;
    if (r.status === "canceled") continue;

    const contacts = r.guard.guard_contacts ?? [];
    // 🔴 「LINE が繋がる」＝ kind='line' かつ reachable。ここが 4割問題の判定そのもの
    const line = contacts.find((c) => c.kind === "line" && c.reachable);
    const phone =
      contacts.find((c) => c.kind === "phone" && c.is_primary) ??
      contacts.find((c) => c.kind === "phone");
    const isPartner = r.guard.company?.kind === "partner";

    const channel: NoticeChannel = isPartner ? "company" : line ? "line" : "phone";

    out.push({
      guardId: r.guard.id,
      name: r.guard.name,
      shortName: r.guard.short_name,
      channel,
      lineValue: line?.value ?? null,
      phoneValue: phone?.value ?? null,
      companyId: r.guard.company?.id ?? null,
      companyName: r.guard.company?.name ?? null,
      companyEmail: r.guard.company?.contact_email ?? null,
      siteName: r.shift.site?.name ?? "（現場名なし）",
      bandName: r.shift.band_name,
      startText: hhmm(r.shift.start_h, r.shift.start_m),
      endText: hhmm(r.shift.end_h, r.shift.end_m),
      planComment: r.shift.plan_comment,
      shiftId: r.shift.id,
      changedAfterConfirm: r.shift.changed_after_confirm,
      cancelled: r.shift.cancelled_at !== null,
    });
  }

  // 会社 → 現場 → 氏名 の順。協力会社ぶんがまとまって見えるようにする
  return out.sort(
    (a, b) =>
      (a.companyName ?? "").localeCompare(b.companyName ?? "") ||
      a.siteName.localeCompare(b.siteName) ||
      a.name.localeCompare(b.name),
  );
}

export async function listMessageTemplates(): Promise<MessageTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, name, kind, body")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(`文面テンプレートの取得に失敗しました: ${error.message}`);
  return (data ?? []) as MessageTemplate[];
}

export type NoticeHistoryRow = {
  id: string;
  work_date: string;
  shift_group: string;
  kind: string;
  target_count: number;
  reachable_count: number;
  phone_count: number;
  company_count: number;
  sent_at: string | null;
  created_at: string;
};

/**
 * 連絡の履歴。
 *
 * 🔴 「大量に残るのはどうなのか」（柴山）への答えは、
 *   **一覧に出すのは常に親（1回＝1行）だけ**にすること。宛先の明細は開いたときにだけ読む。
 */
export async function listNotices(limit = 20): Promise<NoticeHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notices")
    .select(
      `id, work_date, shift_group, kind, target_count, reachable_count,
       phone_count, company_count, sent_at, created_at`,
    )
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`連絡履歴の取得に失敗しました: ${error.message}`);
  return (data ?? []) as NoticeHistoryRow[];
}

/** 管轄の一覧。連絡画面のヘッダで切り替えるのに要る */
export async function listJurisdictionsForNotice() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jurisdictions")
    .select("id, code, name")
    .order("code");
  if (error) throw new Error(`管轄の取得に失敗しました: ${error.message}`);
  return (data ?? []) as { id: string; code: string; name: string }[];
}

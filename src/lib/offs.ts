// S-08 休み管理（2026-09-16）の取得。
//
// 🔴 新しいテーブルは作っていない。休みは `assignments.kind = 'off'` として
//   最初から器がある（board_core.sql §4-2）。ここはその月ぶんを読むだけ。
//
// 🔴 なぜ月なのか：有給や公休は**先に決まる**。配置ボードは1日、A表は1週しか映さず、
//   「来月の何日に休みが集まっているか」を見る場所がどこにも無かった。
//
// 🔴 このファイルは server-only。表示の整形はクライアントからも要るので
//   `board-format.ts`（OFF_KIND_LABEL）を使う ── board.ts と同じ壁の引き方。

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/board-format";
import type { Guard, OffKind, OffWorkKind } from "@/lib/types";

export type OffEntry = {
  assignmentId: string;
  offKind: OffKind;
  /** null = 終日。day/nightA/nightB = その区分だけ休む（＝一部勤務可） */
  offWorkKind: OffWorkKind | null;
};

export type OffMonthRow = {
  guardId: string;
  name: string;
  shortName: string;
  isPartner: boolean;
  /** 'YYYY-MM-DD' → その日の休み（一部勤務可は最大3件） */
  byDate: Record<string, OffEntry[]>;
  /** 🔴 その日に**配置が入っている**日。休みと配置が同じ日に立つのは事故なので、画面で見せる */
  workingDates: string[];
};

export type OffMonth = {
  /** 'YYYY-MM' */
  month: string;
  /** その月の日付（'YYYY-MM-DD'） */
  dates: string[];
  rows: OffMonthRow[];
};

/** 'YYYY-MM' を月初の 'YYYY-MM-DD' にする。妥当でなければ今月 */
export function monthStart(month: string | undefined, today: string): string {
  if (month && /^\d{4}-\d{2}$/.test(month)) return `${month}-01`;
  return `${today.slice(0, 7)}-01`;
}

/** 月を n か月ずらす（'YYYY-MM' → 'YYYY-MM'） */
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const y2 = y + Math.floor(m / 12);
  const m2 = ((m % 12) + 12) % 12;
  return `${y2}-${String(m2 + 1).padStart(2, "0")}`;
}

/** その月の日数。🔴 UTC で作る ── ローカル時刻に任せると環境で1日ずれる */
export function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export async function getOffMonth(month: string): Promise<OffMonth> {
  const supabase = await createClient();
  const first = `${month}-01`;
  const count = daysInMonth(month);
  const dates = Array.from({ length: count }, (_, i) => addDays(first, i));
  const last = dates[dates.length - 1];

  const [guardRes, assignRes, companyRes] = await Promise.all([
    supabase
      .from("guards")
      .select("id, staff_code, name, short_name, company_id, jurisdiction_id")
      .eq("status", "active")
      .order("name"),
    // 🔴 kind で絞らない。**配置が入っている日**も同時に知りたいため
    //   （休みと配置が同じ日に立っているのは事故で、気づけるのはこの画面だけ）
    supabase
      .from("assignments")
      .select("id, guard_id, work_date, kind, off_kind, off_work_kind")
      .gte("work_date", first)
      .lte("work_date", last)
      .eq("status", "planned"),
    supabase.from("companies").select("id, kind"),
  ]);

  if (guardRes.error) throw new Error(`隊員の取得に失敗しました: ${guardRes.error.message}`);
  if (assignRes.error) throw new Error(`休みの取得に失敗しました: ${assignRes.error.message}`);
  if (companyRes.error) throw new Error(`会社の取得に失敗しました: ${companyRes.error.message}`);

  const guards = (guardRes.data ?? []) as Guard[];
  const partnerIds = new Set(
    ((companyRes.data ?? []) as { id: string; kind: string }[])
      .filter((c) => c.kind === "partner")
      .map((c) => c.id),
  );

  const rows = new Map<string, OffMonthRow>();
  for (const g of guards) {
    rows.set(g.id, {
      guardId: g.id,
      name: g.name,
      shortName: g.short_name,
      isPartner: partnerIds.has(g.company_id),
      byDate: {},
      workingDates: [],
    });
  }

  type Row = {
    id: string;
    guard_id: string;
    work_date: string;
    kind: string;
    off_kind: OffKind | null;
    off_work_kind: OffWorkKind | null;
  };
  for (const a of (assignRes.data ?? []) as Row[]) {
    const row = rows.get(a.guard_id);
    if (!row) continue; // 退職者などマスタに出ない隊員
    if (a.kind === "off") {
      if (!a.off_kind) continue;
      const list = row.byDate[a.work_date] ?? [];
      list.push({ assignmentId: a.id, offKind: a.off_kind, offWorkKind: a.off_work_kind });
      row.byDate[a.work_date] = list;
    } else {
      row.workingDates.push(a.work_date);
    }
  }

  return { month, dates, rows: [...rows.values()] };
}

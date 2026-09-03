// 配置ボードの表示用ヘルパ（ラベル・時刻・日付）。
//
// 🔴 なぜ board.ts から切り出したのか（2026-09-03）
//   `board.ts` は先頭で `import "server-only"` している。取得処理が
//   誤ってクライアントに混ざると Supabase の呼び出しごと持って行かれるため、
//   これは意図した壁である。
//   一方で D&D はクライアントコンポーネントで動く。プレートやカードは
//   `formatTime` や `WORK_KIND_LABEL` を使うので、**壁の内側に置いたままだと
//   クライアントから import できずビルドが落ちる**。
//
//   → **サーバでしか動けないもの（取得）** と
//     **どちらでも動くもの（表示の整形）** をファイルで分ける。
//   `board.ts` はここを再エクスポートするので、既存の import は変わらない。
//
// 🔴 ここには「取ってくる処理」を書かない。書いた時点で壁が意味を失う。

import type { OffKind, WorkKind } from "@/lib/types";

export const OFF_KIND_LABEL: Record<OffKind, string> = {
  paid_leave: "有給",
  training: "研修・講習",
  medical: "健診",
  absent_self: "自欠",
  absent_company: "会欠",
  night_duty: "宿直",
  substitute_holiday: "振替休日",
  control: "管制",
  office: "内勤",
  standby: "緊急対応要員",
};

export const WORK_KIND_LABEL: Record<WorkKind, string> = {
  day: "日勤",
  nightA: "夜A",
  nightB: "夜B",
  dayCancel: "日勤現中",
  nightCancel: "夜勤現中",
};

// ─────────────────────────────────────────────────────────
// 日付・時刻（JST 固定）
//
// 🔴 サーバの地域設定に依存させない。Vercel は UTC で動くため、
//   ローカル（JST）では合うのに本番で1日ずれる、が起きる。
// ─────────────────────────────────────────────────────────

export function todayInJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.abs(Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000;
}

/** 09:00 のような表示にする */
export function formatTime(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** ShiftMax の ArgNenTukiHi 書式：YYYY/MM/D（🔴 日はゼロ埋めしない） */
export function toShiftMaxDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}/${m}/${Number(d)}`;
}

export function formatBoardDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const week = "日月火水木金土"[date.getUTCDay()];
  return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")} (${week})`;
}

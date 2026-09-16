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

export type BoardShiftGroup = "day" | "night";

/**
 * 日勤／夜勤の切り替えが拾う勤務区分。「現中」も元の時間帯側に含める。
 *
 * 🔴 board.ts からここへ移した（2026-09-15・週表 S-07 の追加時）。
 *   週表も同じ切り替えを持つため、向こうに複製すると
 *   「日勤に現中を含めるか」の判断が2か所に散る。
 */
export const GROUP_WORK_KINDS: Record<BoardShiftGroup, WorkKind[]> = {
  day: ["day", "dayCancel"],
  night: ["nightA", "nightB", "nightCancel"],
};

export const OFF_KIND_LABEL: Record<OffKind, string> = {
  paid_leave: "有給",
  day_off: "休み",
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

/**
 * その日を含む週の初日。🟠 **月曜始まり**（screen-design.md §7-2-10 の暫定）。
 * A表の実物からは週の起点が読み取れなかったため、管制に確認するまでこれで置く。
 */
export function startOfWeek(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  // getUTCDay: 0=日 … 6=土。月曜を 0 にずらす
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(iso, -back);
}

/** 週表の列見出し。「火 9/16」 */
export function formatWeekDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const week = "日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${week} ${m}/${d}`;
}

/** 09:00 のような表示にする */
export function formatTime(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** timestamptz（ISO 8601）を JST の HH:MM にする。表示のためだけに使う */
export function jstHm(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/**
 * 重なりの説明に出す「どこの・いつの稼働か」1件ぶん。
 *
 * 🔴 得意先名を必ず入れる（2026-09-04・柴山の指摘）。
 *   現場名と時刻だけでは**盤面のどこにあるカードか分からない**。
 *   配置ボードは得意先タブで切り替える画面なので、
 *   探すときにまず要るのは得意先名。
 * 🔴 管轄と日勤/夜勤も入れる。重なりの相手は**別の盤面にいることが多い**
 *   （1画面 = 1日 × 1管轄 × 日勤/夜勤）。どの盤面を開けばよいかが
 *   書いていないと、結局全部見て回ることになる。
 */
export type SpanPlace = {
  siteName: string | null;
  customerName: string | null;
  jurisdictionName: string | null;
  workKind: WorkKind | null;
  start: string;
  end: string;
};

export function formatSpanPlace(p: SpanPlace): string {
  // 貸出・非現場は枠を持たない。名前を出せないより「現場外」と言うほうがまし
  const site = p.siteName ?? "現場外の稼働";
  const where = [p.customerName, [p.jurisdictionName, p.workKind && WORK_KIND_LABEL[p.workKind]]
    .filter(Boolean)
    .join(" ")]
    .filter(Boolean)
    .join("／");
  const when = `${jstHm(p.start)}–${jstHm(p.end)}`;
  return where ? `${site}（${where}）${when}` : `${site} ${when}`;
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

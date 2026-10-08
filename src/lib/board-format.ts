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

import type { ASheet, JobType, OffKind, Shift, WorkKind } from "@/lib/types";

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

/** A表の紙（2026-10-08）。日勤は東京本部と神奈川支部で別の紙 */
export const A_SHEET_LABEL: Record<ASheet, string> = { tokyo: "東京本部", kanagawa: "神奈川支部" };

// ─────────────────────────────────────────────────────────
// 職種（2026-10-08）
//
// 🔴 記号は A表と同じ K・R・D。管制が毎日書いている文字をそのまま使う。
//   漢字（検・列）にすると、プールの「列5」（列車見張の資格を5社持つ）と読み違える。
// ─────────────────────────────────────────────────────────
export const JOB_TYPES: JobType[] = ["kentei", "train", "driver"];

export const JOB_TYPE_MARK: Record<JobType, string> = { kentei: "K", train: "R", driver: "D" };

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  kentei: "検定",
  train: "列車見張",
  driver: "ドライバー",
};

const JOB_COUNT_KEY = {
  kentei: "kentei_count",
  train: "train_count",
  driver: "driver_count",
} as const satisfies Record<JobType, keyof Shift>;

/** 枠の必要数を A表の書き方で返す（例 `K1R1`）。0 のものは書かない。全部 0 なら空文字 */
export function jobCountsMark(shift: Pick<Shift, "kentei_count" | "train_count" | "driver_count">): string {
  return JOB_TYPES.map((j) => (shift[JOB_COUNT_KEY[j]] > 0 ? `${JOB_TYPE_MARK[j]}${shift[JOB_COUNT_KEY[j]]}` : "")).join("");
}

/** 枠の必要数に対し、その職種を付けた人が足りないもの */
export function jobShortages(
  shift: Pick<Shift, "kentei_count" | "train_count" | "driver_count">,
  plates: { jobType: JobType | null }[],
): { jobType: JobType; label: string; need: number; have: number }[] {
  return JOB_TYPES.flatMap((j) => {
    const need = shift[JOB_COUNT_KEY[j]];
    const have = plates.filter((p) => p.jobType === j).length;
    return have < need ? [{ jobType: j, label: JOB_TYPE_LABEL[j], need, have }] : [];
  });
}

/** 名札の操作で順に切り替える（交通誘導 → K → R → D → 交通誘導） */
export function nextJobType(current: JobType | null): JobType | null {
  if (current === null) return JOB_TYPES[0];
  const i = JOB_TYPES.indexOf(current);
  return i === JOB_TYPES.length - 1 ? null : JOB_TYPES[i + 1];
}

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

/**
 * 隊員をフリガナ順に並べる比較関数（2026-10-05）。
 *
 * 🔴 休み画面（offs.ts・2026-10-01）と同じ規則：半角カナが混じっても同じ順になるよう NFKC で揃え、
 *   フリガナの無い隊員は末尾に回す。プールが個人コード順で、280名から探すのに時間がかかった（柴山）。
 */
export function compareByKana(
  a: { name: string; name_kana?: string | null },
  b: { name: string; name_kana?: string | null },
): number {
  const ka = a.name_kana?.normalize("NFKC") ?? "";
  const kb = b.name_kana?.normalize("NFKC") ?? "";
  if (!ka !== !kb) return ka ? -1 : 1;
  return ka.localeCompare(kb, "ja") || a.name.localeCompare(b.name, "ja");
}

/**
 * 名札に出す名前（2026-10-05）。
 *
 * 🔴 略称の空白（全角を含む）を詰める。べんり君の略称は「●安藤　翔一」のように
 *   姓と名の間に全角スペースが入っている人が多く、84px の名札で名が「…」に切れていた。
 *   データ（短縮名）は変えず、表示だけ詰める。
 */
export function plateName(g: { name: string; short_name: string | null }): string {
  const s = (g.short_name || g.name).replace(/[\s　]+/g, "");
  // 🔴 9文字以上は8文字で切る（2026-10-05・柴山）。名札を縦に伸ばさないため。
  //   「…」は付けない（1文字ぶん削れる）。氏名は名札に乗せると title で全部出る。
  //   Array.from で数える ── 文字列の length だと、まれな漢字（サロゲートペア）を2文字と数える
  const chars = Array.from(s);
  return chars.length > 8 ? chars.slice(0, 8).join("") : s;
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

/**
 * 曜日（0=日 … 6=土）。
 *
 * 🔴 UTC で出す。`new Date("2026-09-16")` は UTC だが `new Date(2026, 8, 16)` は
 *   ローカル時刻で、混ぜると環境によって1日ずれる（board.ts の JST 方針と同じ理由）。
 */
export function dayOfWeek(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * 曜日の地色（2026-09-16・柴山の要望「曜日ごとに色を切り替えて見やすく」）。
 *
 * 🔴 狙いは**隣の列との境目**だけ。7列が同じ白のままだと、横に目を走らせたときに
 *   いま何曜日を見ているのか分からなくなる。
 *
 *   月・水・金・日 … 地色あり
 *   火・木・土     … 白
 *
 * 🔴 **列見出しは曜日で色を変えない**（2026-09-16・柴山）。
 *   見出しまで縞にすると、日付を読む行そのものがちらついて読みにくい。
 *   縞を敷くのは**中身の側だけ**でよい。
 *
 * 🔴 **土日に専用色（赤・青）を付ける案は却下**（2026-09-16・柴山）。
 *   暦としては自然でも、この画面で要るのは「隣の列と見分けられること」であって
 *   曜日の性格ではない。色が3種類あると縞が途切れ、かえって読みにくかった。
 *   **1日おきの2色だけ**にする。
 *
 * 🔴 判定は**曜日**で行う。列の番号（何列目か）で交互にすると、
 *   月の途中から始まる休み画面で**同じ曜日が週によって違う色**になる。
 *
 * 🔴 無彩色だけを使う。amber=未完了 / rose=足りない / emerald=資格あり という
 *   1色1意味の割り当てに触れないため ── 列の地色に意味を持たせない。
 */
export function dayTone(iso: string): string {
  // 月=0 … 日=6 に並べ替えたうえで、1日おきに地色を敷く
  const i = (dayOfWeek(iso) + 6) % 7;
  if (i % 2 === 0) {
    // 🔴 灰ではなく**極薄の青**にした（2026-09-16・柴山の選択）。
    //   灰は濃さを5回振ったが決まらなかった。`slate-100` は白と区別がつかず、
    //   `slate-200` は濃い ── その間に使える段階が無い。
    //   色味が違えば薄くても見分けられるので、濃さで悩む必要がなくなる。
    //
    // 🔴 これは**暦にも状態にも意味を持たない**。ただの縞であって、
    //   「青い列だから何か」は無い。1色1意味（amber=未完了 / rose=足りない /
    //   emerald=資格あり）には触れないよう、面積の大きい地色にだけ使う。
    //
    // 🔴 罫線は触らない。縦だけ濃くして列を立てる案は見送った（柴山の指摘）──
    //   縦と横で色が違うと、表そのものが歪んで見える。
    return "bg-sky-50";
  }
  return "";
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

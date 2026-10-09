// S-20 出力 ① 配置明細（2026-10-09）。
//
// 設計：docs/s20-output-design.md §5。**1行＝1配置（隊員 × 枠）**。②日報チェック表形・③隊員別は
// これを集計して作る（集計結果は保存しない ─ 同 §6-1 原則4）。
//
// 🔴 仮設計の範囲で、**事務の答えに左右されない列だけ**を出す。
//   残業・諸経費・中止区分・請求する/しない・平日/土曜/休日は**器が無いか事務の答え待ち**なので出さない
//   （同 §2・§8）。器ができたら列を足す。列を後ろに足すぶんには、今の使い方を壊さない。
//
// 🔴 期間は任意（締め日が得意先ごとに違い、給与は20日締め ─ 同 §5）。ただし上限を切る（MAX_DAYS）。
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { JOB_TYPE_LABEL, WORK_KIND_LABEL, addDays, formatTime } from "@/lib/board-format";
import { toCsvWithBom } from "@/lib/csv";
import type { JobType, WorkKind } from "@/lib/types";

/** 1回に出せる日数。1か月の配置が約3,000行なので、2か月＋α で 6,000行程度に収まる */
export const MAX_DAYS = 62;

export const EXPORT_HEADER = [
  "勤務日",
  "曜日",
  "日夜",
  "区分",
  "管轄",
  "得意先コード",
  "得意先",
  "請求番号",
  "現場コード",
  "作業所",
  "枠の状態",
  "開始",
  "終了",
  "休憩（分）",
  "職種",
  "隊長",
  "現着中止",
  "個人コード",
  "氏名",
  "所属",
  "予定コメント",
  "請求備考",
] as const;

type Raw = {
  work_date: string;
  role: "leader" | "member";
  job_type: JobType | null;
  onsite_cancelled: boolean;
  position: number;
  guard: {
    staff_code: string | null;
    name: string;
    company: { kind: string; name: string } | null;
  } | null;
  shift: {
    work_kind: WorkKind;
    status: "draft" | "confirmed";
    cancelled_at: string | null;
    start_h: number;
    start_m: number;
    end_h: number;
    end_m: number;
    break_min: number | null;
    plan_comment: string | null;
    billing_note: string | null;
    jurisdiction: { name: string } | null;
    site: {
      site_code: string;
      name: string;
      customer: { staff_code: string; name: string; billing_no: string | null } | null;
    } | null;
  } | null;
};

export type ExportSummary = {
  rows: string[][];
  /** 枠の状態ごとの件数（画面で「仮組みが残っている」を知らせるため） */
  confirmed: number;
  draft: number;
  cancelled: number;
  /** 現着中止の人数 */
  onsiteCancelled: number;
};

const isNight = (k: WorkKind) => k !== "day" && k !== "dayCancel";

function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return "日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 期間の日数（両端を含む）。from > to なら 0 */
export function daysBetween(from: string, to: string): number {
  if (from > to) return 0;
  let n = 1;
  for (let d = from; d < to; d = addDays(d, 1)) n++;
  return n;
}

export async function getAssignmentDetail(from: string, to: string): Promise<ExportSummary> {
  const supabase = await createClient();

  // 🔴 1か月で1,000行を超える。fetchAll で最後まで読み、order は id で決め手を付ける
  const res = await fetchAll<Raw>((f, t) =>
    supabase
      .from("assignments")
      .select(
        `work_date, role, job_type, onsite_cancelled, position,
         guard:guards ( staff_code, name, company:companies ( kind, name ) ),
         shift:shifts (
           work_kind, status, cancelled_at, start_h, start_m, end_h, end_m, break_min,
           plan_comment, billing_note,
           jurisdiction:jurisdictions ( name ),
           site:sites ( site_code, name, customer:customers ( staff_code, name, billing_no ) )
         )`,
      )
      .eq("kind", "site")
      .eq("status", "planned")
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date")
      .order("id")
      // 🔴 多対一の埋め込みを supabase-js の型パーサは配列と推論する（実際は1件）。handoff.ts と同じく受け直す
      .range(f, t) as unknown as PromiseLike<{ data: Raw[] | null; error: { message: string } | null }>,
  );
  if (res.error) throw new Error(`配置の取得に失敗しました: ${res.error.message}`);

  const list = res.data.filter((r) => r.shift !== null);
  // 勤務日 → 日勤/夜勤 → 得意先 → 作業所 → 名札の並び（日報チェック表と同じ順に近づける）
  list.sort((a, b) => {
    const sa = a.shift!;
    const sb = b.shift!;
    return (
      a.work_date.localeCompare(b.work_date) ||
      Number(isNight(sa.work_kind)) - Number(isNight(sb.work_kind)) ||
      (sa.site?.customer?.staff_code ?? "").localeCompare(sb.site?.customer?.staff_code ?? "") ||
      (sa.site?.name ?? "").localeCompare(sb.site?.name ?? "", "ja") ||
      a.position - b.position
    );
  });

  let confirmed = 0;
  let draft = 0;
  let cancelled = 0;
  let onsiteCancelled = 0;

  const rows = list.map((r) => {
    const s = r.shift!;
    // 🔴 中止（行く前）は枠の状態。中止しても配置は消さない（9/07 決定）ので、誰が入っていたかは残る
    const state = s.cancelled_at !== null ? "中止" : s.status === "confirmed" ? "確定" : "仮組み";
    if (state === "中止") cancelled++;
    else if (state === "確定") confirmed++;
    else draft++;
    if (r.onsite_cancelled) onsiteCancelled++;

    const company = r.guard?.company;
    return [
      r.work_date,
      weekdayOf(r.work_date),
      isNight(s.work_kind) ? "夜勤" : "日勤",
      WORK_KIND_LABEL[s.work_kind],
      s.jurisdiction?.name ?? "",
      s.site?.customer?.staff_code ?? "",
      s.site?.customer?.name ?? "",
      // 🟠 請求番号は得意先のものを出す（ShiftMax で得意先に1対1・s20-output-design.md §6-3 #4）
      s.site?.customer?.billing_no ?? "",
      s.site?.site_code ?? "",
      s.site?.name ?? "",
      state,
      formatTime(s.start_h, s.start_m),
      formatTime(s.end_h, s.end_m),
      s.break_min === null ? "" : String(s.break_min),
      // null＝交通誘導（例外だけ職種を付けている ─ types.ts JobType）
      r.job_type ? JOB_TYPE_LABEL[r.job_type] : "交通誘導",
      r.role === "leader" ? "1" : "",
      r.onsite_cancelled ? "1" : "",
      r.guard?.staff_code ?? "",
      r.guard?.name ?? "",
      company && company.kind === "partner" ? company.name : "自社",
      s.plan_comment ?? "",
      s.billing_note ?? "",
    ];
  });

  return { rows, confirmed, draft, cancelled, onsiteCancelled };
}

export function toExportCsv(rows: readonly (readonly string[])[]): string {
  return toCsvWithBom([EXPORT_HEADER as readonly string[], ...rows]);
}

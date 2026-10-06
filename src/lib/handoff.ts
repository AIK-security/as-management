// S-02 べんり君への引き渡し ─ 18列CSV の組み立て（2026-10-06）。
//
// 設計：docs/screen-design.md §3／仕様：docs/shiftmax-api-analysis.md §3（18列）・§7-6-2（日付）
//
// 🔴 この工程が要るかどうかは**未判定**（requirements.md §8-1）。それでも作るのは、
//   「べんり君相当データの出力」は引き渡しの有無にかかわらず作ると決めてあるため（同 §4-3）。
//   要らないと決まったら、**このファイルと /handoff を消すだけ**で捨てられる（設計原則5）。
//
// 🔴 新システムは ShiftMax と通信しない。ここは CSV を作るだけで、送るのはべんり君のコピー
//   （追加する fncImportAndSend）。認証情報もここには来ない（2026-08-31 決定）。
//
// 2026-10-06 に決めたこと（柴山）：
//   1. 協力会社の隊員は個人で出さず「応援」の行として出す。会社名は予定コメントに足す
//   2. 中止にした枠は区分を「日勤現中／夜勤現中」に読み替える
//   3. 警備先番号が引けない枠が1つでもあれば、ダウンロードさせない（べんり君は送信ごと止まるため）
//   4. 休み・内勤・教育は出さない（事務が ShiftMax で使っているかを先に聞く）
//   5. 貸出（AS の隊員を協力会社へ出す）は出さない（べんり君での扱いが未確認）
//   6. 班名は空、サブは role='sub' のときだけ 1
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { WORK_KIND_LABEL, toShiftMaxDate } from "@/lib/board-format";
import type { WorkKind } from "@/lib/types";

/**
 * 18列の見出し。
 * 🟠 15〜17列目は、べんり君が「設定」シートの値で書き換えてから送っている（shiftmax-api-analysis.md §3）。
 *   正しい名前は**実際に送る前に**設定シートで確かめる。それまでは既定の名前で出す。
 */
export const HANDOFF_HEADER = [
  "日付",
  "現場コード",
  "警備先番号",
  "現場名",
  "班名",
  "開始時間",
  "開始分",
  "終了時間",
  "終了分",
  "昼休憩",
  "個人コード",
  "隊員ナンバー",
  "社員名",
  "予定コメント",
  "リーダー",
  "サブ",
  "遠距離",
  "請求備考",
] as const;

/** 画面で並べる1行（CSV の1行と一対一）。cells が CSV にそのまま出る */
export type HandoffRow = {
  shiftId: string;
  /** 画面で「応援に寄せた」「空き」を見分けるための印。CSV には出ない */
  note: "partner" | "vacant" | null;
  cells: string[];
};

/** 警備先番号が引けなかった枠 */
export type HandoffMissing = {
  siteName: string;
  customerName: string | null;
  kindLabel: string;
};

export type HandoffData = {
  date: string;
  rows: HandoffRow[];
  /** 確定した枠の数（＝出力の対象） */
  confirmedShifts: number;
  /** 仮組みの枠の数（出力しない。画面で知らせるだけ） */
  draftShifts: number;
  missing: HandoffMissing[];
  /** 協力会社の隊員がいたのに「応援」の隊員が見つからない（出力を止める） */
  partnerGuardMissing: boolean;
};

type ShiftRaw = {
  id: string;
  work_kind: WorkKind;
  status: "draft" | "confirmed";
  cancelled_at: string | null;
  headcount: number;
  start_h: number;
  start_m: number;
  end_h: number;
  end_m: number;
  break_min: number | null;
  plan_comment: string | null;
  billing_note: string | null;
  site: {
    name: string;
    customer: { staff_code: string; name: string } | null;
  } | null;
  assignments: {
    kind: string;
    status: string;
    role: string;
    is_long_distance: boolean;
    position: number;
    guard: {
      staff_code: string | null;
      guard_no: string | null;
      name: string;
      company: { kind: string; name: string } | null;
    } | null;
  }[];
};

const NIGHT_KINDS: readonly WorkKind[] = ["nightA", "nightB", "nightCancel"];

/** 夜勤を後ろに置く並び（べんり君は日勤→夜勤の順で1日を作っている） */
const KIND_ORDER: Record<WorkKind, number> = {
  day: 0,
  dayCancel: 1,
  nightA: 2,
  nightB: 3,
  nightCancel: 4,
};

/**
 * 勤務マスタ（duty_codes）を引くときの区分の名前。
 * 🔴 中止にした枠（cancelled_at あり）は「現中」に読み替える（決定2）。
 *   日勤現中 217件・夜勤現中 211件が得意先ごとに揃っている（data-gap-20260917.md §2-1）。
 */
function kindLabelOf(shift: Pick<ShiftRaw, "work_kind" | "cancelled_at">): string {
  if (shift.cancelled_at === null) return WORK_KIND_LABEL[shift.work_kind];
  return NIGHT_KINDS.includes(shift.work_kind) ? "夜勤現中" : "日勤現中";
}

const flag = (b: boolean) => (b ? "1" : "0");

/**
 * 全項目を `"` で囲む。値の中の `"` は `""` にする（べんり君の fncCreateCsv_Kansei と同じ）。
 * 🔴 csv.ts の toCsv は「必要なときだけ囲む」なので使わない。形をべんり君に揃える。
 * 末尾にも CRLF を付ける（同上）。
 */
export function toHandoffCsv(rows: readonly HandoffRow[]): string {
  const lines = [HANDOFF_HEADER as readonly string[], ...rows.map((r) => r.cells)];
  return lines.map((l) => l.map((v) => `"${v.replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
}

export async function getHandoffData(workDate: string, jurisdictionId: string): Promise<HandoffData> {
  const supabase = await createClient();

  const [shiftRes, supportRes] = await Promise.all([
    supabase
      .from("shifts")
      .select(
        `id, work_kind, status, cancelled_at, headcount,
         start_h, start_m, end_h, end_m, break_min, plan_comment, billing_note,
         site:sites ( name, customer:customers ( staff_code, name ) ),
         assignments (
           kind, status, role, is_long_distance, position,
           guard:guards ( staff_code, guard_no, name, company:companies ( kind, name ) )
         )`,
      )
      .eq("work_date", workDate)
      .eq("jurisdiction_id", jurisdictionId)
      .order("start_h")
      .order("start_m")
      .order("id"),
    // 🔴 協力会社の隊員は ShiftMax に個人で存在しない。「応援」1枠に寄せる（決定1・2026-08-31）。
    //   社員マスターの「応援　東京」（個人コード 524）。名前で引くのは、コードを画面のどこにも
    //   書き込まないため（コードが変わってもマスタを直せば追随する）
    supabase
      .from("guards")
      .select("staff_code, guard_no, name, jurisdiction_id")
      .like("name", "応援%")
      .eq("status", "active"),
  ]);
  if (shiftRes.error) throw new Error(`枠の取得に失敗しました: ${shiftRes.error.message}`);
  if (supportRes.error) throw new Error(`応援の隊員の取得に失敗しました: ${supportRes.error.message}`);

  const allShifts = (shiftRes.data ?? []) as unknown as ShiftRaw[];
  const shifts = allShifts
    .filter((s) => s.status === "confirmed")
    // 日勤→夜勤の順。同じ区分の中は取得時の順（開始時刻順）のまま（sort は安定）
    .sort((a, b) => KIND_ORDER[a.work_kind] - KIND_ORDER[b.work_kind]);

  const supports = (supportRes.data ?? []) as {
    staff_code: string | null;
    guard_no: string | null;
    name: string;
    jurisdiction_id: string;
  }[];
  // 管轄が同じものを優先する（今は「応援　東京」1件だけ）
  const support = supports.find((g) => g.jurisdiction_id === jurisdictionId) ?? supports[0] ?? null;

  // ── 警備先番号（〈得意先の担当コード × 区分〉→ 番号）──────────────
  // 🔴 duty_codes は 1,593行あり、1,000行で切れる。必要な得意先だけに絞ったうえで最後まで読む
  const customerCodes = [
    ...new Set(shifts.map((s) => s.site?.customer?.staff_code).filter((c): c is string => !!c)),
  ];
  const dutyRes =
    customerCodes.length === 0
      ? { data: [] as { guard_target_no: string; sm_site_code: string; kind_label: string; customer_staff_code: string }[], error: null }
      : await fetchAll<{
          guard_target_no: string;
          sm_site_code: string;
          kind_label: string;
          customer_staff_code: string;
        }>((from, to) =>
          supabase
            .from("duty_codes")
            .select("guard_target_no, sm_site_code, kind_label, customer_staff_code")
            .in("customer_staff_code", customerCodes)
            .order("guard_target_no")
            .range(from, to),
        );
  if (dutyRes.error) throw new Error(`勤務マスタの取得に失敗しました: ${dutyRes.error.message}`);
  const dutyByKey = new Map(
    dutyRes.data.map((d) => [`${d.customer_staff_code}:${d.kind_label}`, d]),
  );

  // ── 行を組み立てる ─────────────────────────────────────
  const date = toShiftMaxDate(workDate);
  const rows: HandoffRow[] = [];
  const missing: HandoffMissing[] = [];
  let partnerGuardMissing = false;

  for (const s of shifts) {
    const kindLabel = kindLabelOf(s);
    const customer = s.site?.customer ?? null;
    const duty = customer ? dutyByKey.get(`${customer.staff_code}:${kindLabel}`) : undefined;
    if (!duty) {
      missing.push({ siteName: s.site?.name ?? "（現場不明）", customerName: customer?.name ?? null, kindLabel });
    }

    const common = (personal: [string, string, string], comment: string, leader: boolean, sub: boolean, far: boolean) => [
      date,
      duty?.sm_site_code ?? "",
      duty?.guard_target_no ?? "",
      s.site?.name ?? "",
      "", // 班名：実データで全件空（決定6）
      String(s.start_h),
      String(s.start_m),
      String(s.end_h),
      String(s.end_m),
      String(s.break_min ?? 0),
      ...personal,
      comment,
      flag(leader),
      flag(sub),
      flag(far),
      s.billing_note ?? "",
    ];

    // 🔴 現場の配置だけ（貸出・休みは出さない ─ 決定4・5）。隊長を先頭に、あとは並べた順
    const placed = s.assignments
      .filter((a) => a.kind === "site" && a.status === "planned" && a.guard)
      .sort((a, b) => {
        const lead = Number(b.role === "leader") - Number(a.role === "leader");
        return lead !== 0 ? lead : a.position - b.position;
      });

    for (const a of placed) {
      const g = a.guard!;
      const isPartner = g.company?.kind === "partner";
      let personal: [string, string, string];
      let comment = s.plan_comment ?? "";
      if (isPartner) {
        if (!support) partnerGuardMissing = true;
        personal = [support?.staff_code ?? "", support?.guard_no ?? "", support?.name ?? ""];
        // 🔴 どの協力会社かは、現行でも予定コメントに書いている（data-gap-20260917.md §6）
        const companyName = g.company?.name ?? "";
        if (companyName && !comment.includes(companyName)) {
          comment = comment ? `${comment} ${companyName}` : companyName;
        }
      } else {
        personal = [g.staff_code ?? "", g.guard_no ?? "", g.name];
      }
      rows.push({
        shiftId: s.id,
        note: isPartner ? "partner" : null,
        cells: common(personal, comment, a.role === "leader", a.role === "sub", a.is_long_distance),
      });
    }

    // 🔴 足りない人数ぶんは「未割当」の行で出す（個人コード 0・社員名は空）。
    //   18列に人数の列が無いため、行の数が人数を表す（shiftmax-api-analysis.md §3）
    for (let i = placed.length; i < s.headcount; i++) {
      rows.push({
        shiftId: s.id,
        note: "vacant",
        cells: common(["0", "0", ""], s.plan_comment ?? "", false, false, false),
      });
    }
  }

  return {
    date: workDate,
    rows,
    confirmedShifts: shifts.length,
    draftShifts: allShifts.length - shifts.length,
    missing,
    partnerGuardMissing,
  };
}

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
//   2. ~~中止にした枠は区分を「日勤現中／夜勤現中」に読み替える~~
//      → 🔴 2026-10-08 訂正：**中止にした枠は出さない**。管制の答え（美土路さん経由）で、
//        前日・当日朝の中止は A表で ×、**べんり君からは消している**と分かった。
//        現着中止は区分「日勤現中／夜勤現中」の枠として別に持つ（その枠はそのまま出る）
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
 *   2026-10-07 確認：設定シート（9月のべんり君）の値は3つとも空＝**見出しは空で送られている**。
 *   CSV は人が読めるよう既定の名前で出し、書き換えはべんり君側の読み込みマクロで今と同じに行う。
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
  /** 🔴 この人だけ現着中止（2026-10-08）。画面で「現中」と見せるための印。CSV には出ない */
  onsiteCancelled: boolean;
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
    /** 🔴 この人だけ現着中止（2026-10-08）。行の区分を「現中」にして出す */
    onsite_cancelled: boolean;
    guard: {
      staff_code: string | null;
      guard_no: string | null;
      name: string;
      company: { kind: string; name: string } | null;
    } | null;
  }[];
};

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
 * 現着中止は区分「日勤現中／夜勤現中」の枠なので、そのまま引ける
 *   （日勤現中 217件・夜勤現中 211件が得意先ごとに揃っている・data-gap-20260917.md §2-1）。
 */
function kindLabelOf(shift: Pick<ShiftRaw, "work_kind">): string {
  return WORK_KIND_LABEL[shift.work_kind];
}

/**
 * 🔴 人ごとの現着中止（2026-10-08）。その人の行だけ「現中」の区分で引く。
 *   べんり君では、現着中止の人は現中の区分の行として送っている。
 */
const ONSITE_CANCEL_KIND: Record<WorkKind, WorkKind> = {
  day: "dayCancel",
  dayCancel: "dayCancel",
  nightA: "nightCancel",
  nightB: "nightCancel",
  nightCancel: "nightCancel",
};

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
           kind, status, role, is_long_distance, position, onsite_cancelled,
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
  // 🔴 中止（前日・当日朝）は出さない。べんり君では消している（決定2・2026-10-08 訂正）。
  //   仮組みの件数にも数えない（確定しても出ないものを「確定してください」と言わない）
  const liveShifts = allShifts.filter((s) => s.cancelled_at === null);
  const shifts = liveShifts
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

  const missingKeys = new Set<string>();

  for (const s of shifts) {
    const customer = s.site?.customer ?? null;
    // 🔴 警備先番号は〈得意先 × 区分〉で引く。人ごとの現着中止があると、同じ枠の中で区分が変わる
    const dutyFor = (kind: WorkKind) => {
      const kindLabel = kindLabelOf({ work_kind: kind });
      const duty = customer ? dutyByKey.get(`${customer.staff_code}:${kindLabel}`) : undefined;
      const key = `${s.id}:${kindLabel}`;
      if (!duty && !missingKeys.has(key)) {
        missingKeys.add(key);
        missing.push({ siteName: s.site?.name ?? "（現場不明）", customerName: customer?.name ?? null, kindLabel });
      }
      return duty;
    };

    const common = (
      duty: ReturnType<typeof dutyFor>,
      personal: [string, string, string],
      comment: string,
      leader: boolean,
      sub: boolean,
      far: boolean,
    ) => [
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
        onsiteCancelled: a.onsite_cancelled,
        cells: common(
          dutyFor(a.onsite_cancelled ? ONSITE_CANCEL_KIND[s.work_kind] : s.work_kind),
          personal,
          comment,
          a.role === "leader",
          a.role === "sub",
          a.is_long_distance,
        ),
      });
    }

    // 🔴 足りない人数ぶんは「未割当」の行で出す（個人コード 0・社員名は空）。
    //   18列に人数の列が無いため、行の数が人数を表す（shiftmax-api-analysis.md §3）
    for (let i = placed.length; i < s.headcount; i++) {
      rows.push({
        shiftId: s.id,
        note: "vacant",
        onsiteCancelled: false,
        cells: common(dutyFor(s.work_kind), ["0", "0", ""], s.plan_comment ?? "", false, false, false),
      });
    }
  }

  return {
    date: workDate,
    rows,
    confirmedShifts: shifts.length,
    draftShifts: liveShifts.length - shifts.length,
    missing,
    partnerGuardMissing,
  };
}

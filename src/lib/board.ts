// 配置ボードが表示するデータの組み立て。
//
// 段1 ではダミーデータから組むが、**この関数の戻り値の形は Supabase に載せ替えても変えない**。
// 画面側がデータ取得元を知らずに済むようにしておく（差し替えを1か所に閉じる）。

import {
  ASSIGNMENTS,
  COMPANIES,
  CUSTOMERS,
  GUARDS,
  JURISDICTIONS,
  NG_ENTRIES,
  QUALIFICATIONS,
  SHIFTS,
  SITES,
  SITE_EXPERIENCE,
} from "@/lib/fixtures/board";
import type {
  Assignment,
  BoardWarning,
  Guard,
  OffKind,
  PlateView,
  Qualification,
  ShiftRow,
  WorkKind,
} from "@/lib/types";

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

export type BoardShiftGroup = "day" | "night";

export type BoardData = {
  date: string;
  jurisdictionName: string;
  group: BoardShiftGroup;
  rows: ShiftRow[];
  /** 未配置の隊員（プール） */
  pool: Guard[];
  /** 非現場ステータス（有給・研修 など） */
  offGroups: { label: string; guards: Guard[] }[];
  /** 協力会社への貸出 */
  lentGroups: { companyName: string; siteName: string; guards: Guard[] }[];
  warnings: BoardWarning[];
  counts: { draft: number; confirmed: number; shortage: number };
};

const qualById = new Map(QUALIFICATIONS.map((q) => [q.id, q]));
const guardById = new Map(GUARDS.map((g) => [g.id, g]));
const siteById = new Map(SITES.map((s) => [s.id, s]));
const customerById = new Map(CUSTOMERS.map((c) => [c.id, c]));
const companyById = new Map(COMPANIES.map((c) => [c.id, c]));

function isNightShift(kind: WorkKind): boolean {
  return kind === "nightA" || kind === "nightB" || kind === "nightCancel";
}

/** その枠にその隊員を入れたときに成立する NG を集める */
function ngReasonsFor(
  guardId: string,
  siteId: string,
  coAssignedGuardIds: string[],
): string[] {
  const reasons: string[] = [];
  for (const ng of NG_ENTRIES) {
    if (ng.guardId === guardId && ng.siteId === siteId) {
      reasons.push(ng.reason);
    }
    // 人 × 人 の NG は双方向に効く
    const pairHit =
      (ng.guardId === guardId && ng.counterpartGuardId && coAssignedGuardIds.includes(ng.counterpartGuardId)) ||
      (ng.counterpartGuardId === guardId && coAssignedGuardIds.includes(ng.guardId));
    if (pairHit) {
      const other = ng.guardId === guardId ? ng.counterpartGuardId! : ng.guardId;
      reasons.push(`${ng.reason}（${guardById.get(other)?.shortName ?? other}）`);
    }
  }
  return reasons;
}

function toPlate(
  assignment: Assignment,
  guard: Guard,
  siteId: string,
  coAssignedGuardIds: string[],
): PlateView {
  const company = companyById.get(guard.companyId);
  return {
    assignmentId: assignment.id,
    guard,
    role: assignment.role,
    experienced: SITE_EXPERIENCE.has(`${guard.id}:${siteId}`),
    ngReasons: ngReasonsFor(guard.id, siteId, coAssignedGuardIds),
    isPartner: company?.kind === "partner",
    isOtherJurisdiction: guard.jurisdictionId !== "j-10",
  };
}

export function getBoardData(group: BoardShiftGroup = "day"): BoardData {
  const jurisdictionId = "j-10";
  const jurisdiction = JURISDICTIONS.find((j) => j.id === jurisdictionId)!;

  const shifts = SHIFTS.filter(
    (s) =>
      s.jurisdictionId === jurisdictionId &&
      (group === "night" ? isNightShift(s.workKind) : !isNightShift(s.workKind)),
  );

  const assignedGuardIds = new Set<string>();
  const rows: ShiftRow[] = [];
  const warnings: BoardWarning[] = [];
  let shortage = 0;

  for (const shift of shifts) {
    const site = siteById.get(shift.siteId)!;
    const customer = customerById.get(site.customerId)!;
    const rowAssignments = ASSIGNMENTS.filter(
      (a) => a.kind === "site" && a.shiftId === shift.id && a.status === "planned",
    ).sort((a, b) => a.position - b.position);

    const coAssignedGuardIds = rowAssignments.map((a) => a.guardId);
    const plates = rowAssignments.map((a) => {
      const guard = guardById.get(a.guardId)!;
      assignedGuardIds.add(guard.id);
      return toPlate(a, guard, site.id, coAssignedGuardIds);
    });

    // 現場が求める資格のうち、その枠に誰も持っていないもの
    const held = new Set(plates.flatMap((p) => p.guard.qualificationIds));
    const missingQualifications = site.requiredQualificationIds
      .filter((q) => !held.has(q))
      .map((q) => qualById.get(q))
      .filter((q): q is Qualification => Boolean(q));

    if (plates.length < shift.headcount) {
      shortage++;
      warnings.push({
        kind: "shortage",
        message: `${site.name}：必要${shift.headcount}に対し${plates.length}名（${shift.headcount - plates.length}名不足）`,
      });
    }
    for (const q of missingQualifications) {
      warnings.push({
        kind: "qualification",
        message: `${site.name}：${q.name} が必要だが未配置`,
      });
    }
    for (const plate of plates) {
      for (const reason of plate.ngReasons) {
        warnings.push({
          kind: "ng",
          message: `${site.name}：${plate.guard.shortName} は ${reason}`,
        });
      }
    }

    rows.push({ shift, site, customer, plates, missingQualifications });
  }

  // 非現場・貸出は「その日そう扱われている隊員」なのでプールから除く
  const offAssignments = ASSIGNMENTS.filter((a) => a.kind === "off");
  const lentAssignments = ASSIGNMENTS.filter((a) => a.kind === "lent_out");
  const busy = new Set([
    ...assignedGuardIds,
    ...offAssignments.map((a) => a.guardId),
    ...lentAssignments.map((a) => a.guardId),
  ]);

  const offMap = new Map<string, Guard[]>();
  for (const a of offAssignments) {
    const label = OFF_KIND_LABEL[a.offKind!];
    const list = offMap.get(label) ?? [];
    list.push(guardById.get(a.guardId)!);
    offMap.set(label, list);
  }

  const lentMap = new Map<string, { companyName: string; siteName: string; guards: Guard[] }>();
  for (const a of lentAssignments) {
    const company = companyById.get(a.lentToCompanyId!)!;
    const key = `${company.id}:${a.externalSiteName}`;
    const entry =
      lentMap.get(key) ??
      { companyName: company.name, siteName: a.externalSiteName ?? "", guards: [] };
    entry.guards.push(guardById.get(a.guardId)!);
    lentMap.set(key, entry);
  }

  return {
    date: shifts[0]?.workDate ?? "",
    jurisdictionName: jurisdiction.name,
    group,
    rows,
    pool: GUARDS.filter((g) => !busy.has(g.id)),
    offGroups: [...offMap.entries()].map(([label, guards]) => ({ label, guards })),
    lentGroups: [...lentMap.values()],
    warnings,
    counts: {
      draft: shifts.filter((s) => s.status === "draft").length,
      confirmed: shifts.filter((s) => s.status === "confirmed").length,
      shortage,
    },
  };
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

export function qualificationLabels(ids: string[]): string[] {
  return ids.map((id) => qualById.get(id)?.shortLabel).filter((v): v is string => Boolean(v));
}

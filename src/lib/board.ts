// 配置ボードが表示するデータの組み立て。
//
// 🔴 段2 でデータ元を fixtures → Supabase に移した（2026-09-02）。
//   段1 の時点で「戻り値の形は載せ替えても変えない」と決めておいたため、
//   画面側（page.tsx / ShiftRowCard / Plate）の構造は変えずに済んでいる。
//
// 🔴 RLS が最後の砦。ここは anon キーのクライアント経由で読むため、
//   ログインしていない・profile が無い・is_active=false のいずれでも 0 件になる。
//   「見えない」は壊れているのではなく、そう設計してある。
import "server-only";
import { createClient } from "@/lib/supabase/server";
// 🔴 内部でも使う。再エクスポートしただけでは同一モジュール内から参照できない
import { OFF_KIND_LABEL, addDays, daysBetween, todayInJst } from "@/lib/board-format";
import type {
  Assignment,
  BoardGroup,
  BoardWarning,
  Company,
  Customer,
  Guard,
  GuardView,
  Jurisdiction,
  NgEntry,
  PlateView,
  Qualification,
  Shift,
  ShiftRow,
  Site,
  WorkKind,
} from "@/lib/types";

// 🔴 表示の整形は board-format.ts へ移した（2026-09-03）。
//   このファイルは server-only であり、クライアント（D&D）から import できない。
//   既存の import を壊さないよう、ここから再エクスポートする。
export {
  OFF_KIND_LABEL,
  WORK_KIND_LABEL,
  todayInJst,
  addDays,
  formatTime,
  toShiftMaxDate,
  formatBoardDate,
} from "@/lib/board-format";

export type BoardShiftGroup = "day" | "night";

/** 日勤／夜勤の切り替えが拾う勤務区分。「現中」も元の時間帯側に含める */
const GROUP_WORK_KINDS: Record<BoardShiftGroup, WorkKind[]> = {
  day: ["day", "dayCancel"],
  night: ["nightA", "nightB", "nightCancel"],
};

export type BoardData = {
  date: string;
  jurisdiction: Jurisdiction;
  /** ヘッダの管轄切り替え用 */
  jurisdictions: Jurisdiction[];
  group: BoardShiftGroup;
  rows: ShiftRow[];
  /** rows を得意先でまとめたもの。画面はこちらを描く（並び順は BoardGroup を参照） */
  groups: BoardGroup[];
  /** 未配置の隊員（プール） */
  pool: GuardView[];
  /** 非現場ステータス（有給・研修 など） */
  offGroups: { label: string; guards: Guard[] }[];
  /** 協力会社への貸出 */
  lentGroups: { companyName: string; siteName: string; guards: Guard[] }[];
  warnings: BoardWarning[];
  counts: { draft: number; confirmed: number; shortage: number };
  /** 🔴 その日に枠が1件も無いとき、データがある直近の日付を出す（空画面で詰まらせない） */
  nearestDateWithShifts: string | null;
};

// ─────────────────────────────────────────────────────────
// 取得
// ─────────────────────────────────────────────────────────

/** supabase-js の埋め込み select が返す形。DB 行＋関連 */
type ShiftRowRaw = Shift & {
  site:
    | (Site & {
        customer: Customer | null;
        site_required_qualifications: { qualification_id: string }[];
      })
    | null;
};

export type BoardParams = {
  /** YYYY-MM-DD。省略時は JST の今日 */
  workDate?: string;
  /** 管轄コード（"10" など）。省略時は最小のコード */
  jurisdictionCode?: string;
  group?: BoardShiftGroup;
};

export async function getBoardData(params: BoardParams = {}): Promise<BoardData> {
  const supabase = await createClient();
  const group = params.group ?? "day";
  const workDate = params.workDate ?? todayInJst();

  // ── 管轄 ────────────────────────────────────────────
  const { data: jurisdictionRows, error: jError } = await supabase
    .from("jurisdictions")
    .select("id, code, name, allow_cross_staff, allow_cross_site")
    .order("code");
  if (jError) throw jError;

  const jurisdictions = (jurisdictionRows ?? []) as Jurisdiction[];
  if (jurisdictions.length === 0) {
    // マイグレーションは通ったがダミー投入がまだ、という状態。
    // ここで落とすと原因が分かりにくいので、空のボードとして返す。
    return emptyBoard(workDate, group);
  }
  const jurisdiction =
    jurisdictions.find((j) => j.code === params.jurisdictionCode) ?? jurisdictions[0];

  // ── 枠（現場・得意先・必要資格を同時に引く）────────────
  const { data: shiftRaw, error: sError } = await supabase
    .from("shifts")
    .select(
      `id, site_id, work_date, jurisdiction_id, work_kind, headcount,
       start_h, start_m, end_h, end_m, break_min,
       band_name, plan_comment, billing_note, status, changed_after_confirm,
       site:sites!inner (
         id, site_code, guard_target_no, name, short_name, customer_id, jurisdiction_id,
         customer:customers ( id, staff_code, name, name_kana ),
         site_required_qualifications ( qualification_id )
       )`,
    )
    .eq("work_date", workDate)
    .eq("jurisdiction_id", jurisdiction.id)
    .in("work_kind", GROUP_WORK_KINDS[group])
    // 🔴 ここで付ける順序は**グループの中の順序**になる（2026-09-02 決定）。
    //    得意先でまとめたあと、そのまとまりの中は開始時刻順。
    //    id を最後に入れるのは同時刻の並びを毎回同じにするため
    //    （seed の id は連番由来なので安定する）。
    .order("start_h")
    .order("start_m")
    .order("id");
  if (sError) throw sError;

  const shifts = (shiftRaw ?? []) as unknown as ShiftRowRaw[];
  const shiftIds = shifts.map((s) => s.id);

  // ── その日の稼働（配置・非現場・貸出をまとめて1回で引く）──
  // 🔴 data-model.md §4-2 が1テーブルに統合した意図がここで効く。
  //    「応援中と気づかず自社案件に配置する」を防ぐには、
  //    その日の稼働が**1回のクエリで全部見える**必要がある。
  const { data: assignRaw, error: aError } = await supabase
    .from("assignments")
    .select(
      `id, guard_id, work_date, kind, shift_id, role, is_long_distance, position,
       off_kind, lent_to_company_id, external_site_name, status`,
    )
    .eq("work_date", workDate)
    .eq("status", "planned")
    .order("position");
  if (aError) throw aError;
  const allAssignments = (assignRaw ?? []) as Assignment[];

  // ── マスタ（隊員・会社・資格・NG）────────────────────
  const [guardsRes, companiesRes, qualsRes, guardQualsRes, ngRes] = await Promise.all([
    supabase
      .from("guards")
      .select("id, staff_code, name, short_name, company_id, jurisdiction_id")
      .eq("status", "active")
      .order("staff_code", { nullsFirst: false }),
    supabase.from("companies").select("id, kind, name"),
    supabase.from("qualifications").select("id, code, name, short_label"),
    supabase.from("guard_qualifications").select("guard_id, qualification_id"),
    supabase
      .from("ng_entries")
      .select("id, kind, guard_id, site_id, counterpart_guard_id, reason, severity"),
  ]);
  for (const r of [guardsRes, companiesRes, qualsRes, guardQualsRes, ngRes]) {
    if (r.error) throw r.error;
  }

  const guards = (guardsRes.data ?? []) as Guard[];
  const companies = (companiesRes.data ?? []) as Company[];
  const qualifications = (qualsRes.data ?? []) as Qualification[];
  const guardQuals = (guardQualsRes.data ?? []) as {
    guard_id: string;
    qualification_id: string;
  }[];
  const ngEntries = (ngRes.data ?? []) as NgEntry[];

  const guardById = new Map(guards.map((g) => [g.id, g]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const qualById = new Map(qualifications.map((q) => [q.id, q]));

  const qualIdsByGuard = new Map<string, string[]>();
  for (const gq of guardQuals) {
    const list = qualIdsByGuard.get(gq.guard_id) ?? [];
    list.push(gq.qualification_id);
    qualIdsByGuard.set(gq.guard_id, list);
  }

  // ── 経験（★）── 専用テーブルは作らず assignments の履歴から引く
  //
  // 🔴 期間を切る。切らないと年々重くなり、いずれ画面が開かなくなる。
  //   1年より前の経験を「行ったことがある」と言ってよいかは業務判断だが、
  //   誰にも確認していないので、まず1年で置く（gap-analysis A-1 に積む）。
  const experienced = new Set<string>();
  if (shiftIds.length > 0) {
    const { data: pastRaw, error: pError } = await supabase
      .from("assignments")
      .select("guard_id, shift:shifts!inner ( site_id )")
      .eq("kind", "site")
      .lt("work_date", workDate)
      .gte("work_date", addDays(workDate, -365));
    if (pError) throw pError;
    for (const row of (pastRaw ?? []) as unknown as {
      guard_id: string;
      shift: { site_id: string } | null;
    }[]) {
      if (row.shift) experienced.add(`${row.guard_id}:${row.shift.site_id}`);
    }
  }

  // ─────────────────────────────────────────────────────
  // 組み立て
  // ─────────────────────────────────────────────────────
  const shiftIdSet = new Set(shiftIds);
  const siteAssignments = allAssignments.filter(
    (a) => a.kind === "site" && a.shift_id && shiftIdSet.has(a.shift_id),
  );
  const offAssignments = allAssignments.filter((a) => a.kind === "off");
  const lentAssignments = allAssignments.filter((a) => a.kind === "lent_out");

  const byShift = new Map<string, Assignment[]>();
  for (const a of siteAssignments) {
    const list = byShift.get(a.shift_id!) ?? [];
    list.push(a);
    byShift.set(a.shift_id!, list);
  }

  const rows: ShiftRow[] = [];
  const warnings: BoardWarning[] = [];
  const assignedGuardIds = new Set<string>();
  let shortage = 0;

  for (const raw of shifts) {
    const site = raw.site;
    if (!site) continue; // !inner を付けているので通常は起きない
    const rowAssignments = (byShift.get(raw.id) ?? []).sort((a, b) => a.position - b.position);
    const coAssignedGuardIds = rowAssignments.map((a) => a.guard_id);

    const plates: PlateView[] = [];
    for (const a of rowAssignments) {
      const guard = guardById.get(a.guard_id);
      if (!guard) continue; // 退職して status=inactive になった隊員の過去行など
      assignedGuardIds.add(guard.id);
      const company = companyById.get(guard.company_id);
      const qualIds = qualIdsByGuard.get(guard.id) ?? [];
      plates.push({
        assignmentId: a.id,
        guard,
        qualLabels: qualIds
          .map((id) => qualById.get(id)?.short_label)
          .filter((v): v is string => Boolean(v)),
        role: a.role,
        experienced: experienced.has(`${guard.id}:${site.id}`),
        ngReasons: ngReasonsFor(ngEntries, guardById, guard.id, site.id, coAssignedGuardIds),
        isPartner: company?.kind === "partner",
        isOtherJurisdiction: guard.jurisdiction_id !== jurisdiction.id,
      });
    }

    // 現場が求める資格のうち、その枠に誰も持っていないもの
    const held = new Set(
      rowAssignments.flatMap((a) => qualIdsByGuard.get(a.guard_id) ?? []),
    );
    const missingQualifications = site.site_required_qualifications
      .map((r) => r.qualification_id)
      .filter((id) => !held.has(id))
      .map((id) => qualById.get(id))
      .filter((q): q is Qualification => Boolean(q));

    const shift = toShift(raw);

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
          message: `${site.name}：${plate.guard.short_name} は ${reason}`,
        });
      }
    }

    rows.push({ shift, site, customer: site.customer, plates, missingQualifications });
  }

  // 非現場・貸出は「その日そう扱われている隊員」なのでプールから除く
  const busy = new Set([
    ...assignedGuardIds,
    ...offAssignments.map((a) => a.guard_id),
    ...lentAssignments.map((a) => a.guard_id),
  ]);

  const offMap = new Map<string, Guard[]>();
  for (const a of offAssignments) {
    const guard = guardById.get(a.guard_id);
    if (!guard || !a.off_kind) continue;
    const label = OFF_KIND_LABEL[a.off_kind];
    const list = offMap.get(label) ?? [];
    list.push(guard);
    offMap.set(label, list);
  }

  const lentMap = new Map<string, { companyName: string; siteName: string; guards: Guard[] }>();
  for (const a of lentAssignments) {
    const guard = guardById.get(a.guard_id);
    const company = a.lent_to_company_id ? companyById.get(a.lent_to_company_id) : undefined;
    if (!guard || !company) continue;
    const key = `${company.id}:${a.external_site_name}`;
    const entry =
      lentMap.get(key) ??
      { companyName: company.name, siteName: a.external_site_name ?? "", guards: [] };
    entry.guards.push(guard);
    lentMap.set(key, entry);
  }

  const pool: GuardView[] = guards
    .filter((g) => !busy.has(g.id))
    .map((g) => ({
      guard: g,
      qualLabels: (qualIdsByGuard.get(g.id) ?? [])
        .map((id) => qualById.get(id)?.short_label)
        .filter((v): v is string => Boolean(v)),
      isPartner: companyById.get(g.company_id)?.kind === "partner",
    }));

  return {
    date: workDate,
    jurisdiction,
    jurisdictions,
    group,
    rows,
    groups: groupByCustomer(rows),
    pool,
    offGroups: [...offMap.entries()].map(([label, guards]) => ({ label, guards })),
    lentGroups: [...lentMap.values()],
    warnings,
    counts: {
      draft: rows.filter((r) => r.shift.status === "draft").length,
      confirmed: rows.filter((r) => r.shift.status === "confirmed").length,
      shortage,
    },
    nearestDateWithShifts:
      rows.length > 0 ? null : await findNearestDateWithShifts(supabase, workDate, jurisdiction.id),
  };
}

// ─────────────────────────────────────────────────────────
// 補助
// ─────────────────────────────────────────────────────────

/**
 * 得意先ごとにまとめる。
 *
 * 🔴 グループの並びは**得意先名（フリガナ優先）順で固定**する（2026-09-02 決定）。
 *   「その日いちばん早い枠の時刻順」も検討したが、**日によって会社の並びが変わる**。
 *   40現場を毎日見る作業では、探す場所が固定であることのほうが効く。
 *   当日変更で枠が増減しても、他社のカード位置がずれない利点もある。
 *
 * 🔴 rows は既に開始時刻順で渡ってくる。JS の sort は安定なので、
 *   ここで並べ替えてもグループ内の時刻順は崩れない。
 */
function groupByCustomer(rows: ShiftRow[]): BoardGroup[] {
  const map = new Map<string, BoardGroup>();

  for (const row of rows) {
    const key = row.customer?.id ?? "";
    const group = map.get(key) ?? {
      customer: row.customer,
      rows: [],
      siteCount: 0,
      placed: 0,
      headcount: 0,
    };
    group.rows.push(row);
    group.siteCount += 1;
    group.placed += row.plates.length;
    group.headcount += row.shift.headcount;
    map.set(key, group);
  }

  // 日本語の並びはコードポイント順では合わない（ひらがな・カタカナ・漢字）。
  const collator = new Intl.Collator("ja");
  const sortKey = (g: BoardGroup) => g.customer?.name_kana || g.customer?.name || "";

  return [...map.values()].sort((a, b) => {
    // 得意先が紐づいていない現場は最後にまとめる（データ不備が埋もれないように）
    if (!a.customer !== !b.customer) return a.customer ? -1 : 1;
    return collator.compare(sortKey(a), sortKey(b));
  });
}

/** 埋め込み select の戻りから、枠の列だけを取り出す */
function toShift(raw: ShiftRowRaw): Shift {
  const { site: _site, ...shift } = raw;
  void _site;
  return shift as Shift;
}

/**
 * その枠にその隊員を入れたときに成立する NG を集める。
 * 🔴 「人 × 人」は対称。保存は1行なので、検索時に両方向を見る（data-model.md §5-1）。
 */
function ngReasonsFor(
  ngEntries: NgEntry[],
  guardById: Map<string, Guard>,
  guardId: string,
  siteId: string,
  coAssignedGuardIds: string[],
): string[] {
  const reasons: string[] = [];
  for (const ng of ngEntries) {
    if (ng.kind === "site_guard" && ng.guard_id === guardId && ng.site_id === siteId) {
      reasons.push(ng.reason);
      continue;
    }
    if (ng.kind !== "guard_guard" || !ng.counterpart_guard_id) continue;
    const hitForward =
      ng.guard_id === guardId && coAssignedGuardIds.includes(ng.counterpart_guard_id);
    const hitBackward =
      ng.counterpart_guard_id === guardId && coAssignedGuardIds.includes(ng.guard_id);
    if (hitForward || hitBackward) {
      const other = hitForward ? ng.counterpart_guard_id : ng.guard_id;
      reasons.push(`${ng.reason}（${guardById.get(other)?.short_name ?? other}）`);
    }
  }
  return reasons;
}

/**
 * 🔴 その日に枠が無いときの逃げ道。
 *   空のボードだけ出すと「壊れているのか、その日が本当に空なのか」が区別できない。
 *   前後で最も近い、枠が存在する日付を返す。
 */
async function findNearestDateWithShifts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workDate: string,
  jurisdictionId: string,
): Promise<string | null> {
  const [ahead, behind] = await Promise.all([
    supabase
      .from("shifts")
      .select("work_date")
      .eq("jurisdiction_id", jurisdictionId)
      .gt("work_date", workDate)
      .order("work_date")
      .limit(1),
    supabase
      .from("shifts")
      .select("work_date")
      .eq("jurisdiction_id", jurisdictionId)
      .lt("work_date", workDate)
      .order("work_date", { ascending: false })
      .limit(1),
  ]);

  const next = ahead.data?.[0]?.work_date as string | undefined;
  const prev = behind.data?.[0]?.work_date as string | undefined;
  if (!next) return prev ?? null;
  if (!prev) return next;
  // 近いほうを返す
  return daysBetween(workDate, next) <= daysBetween(prev, workDate) ? next : prev;
}

function emptyBoard(workDate: string, group: BoardShiftGroup): BoardData {
  const placeholder: Jurisdiction = {
    id: "",
    code: "",
    name: "（管轄マスタが空）",
    allow_cross_staff: false,
    allow_cross_site: false,
  };
  return {
    date: workDate,
    jurisdiction: placeholder,
    jurisdictions: [],
    group,
    rows: [],
    groups: [],
    pool: [],
    offGroups: [],
    lentGroups: [],
    warnings: [],
    counts: { draft: 0, confirmed: 0, shortage: 0 },
    nearestDateWithShifts: null,
  };
}

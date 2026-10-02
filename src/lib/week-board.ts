// S-07 A表（週表）が表示するデータの組み立て。
//
// 設計は docs/screen-design.md §7-2。
// **1画面 = 1週 × 1管轄 × 日勤/夜勤。** `S-01`（1日）に「週」を足しただけで、
// 絞り込みの軸は同じ。行き来しても文脈が切れない。
//
// 🔴 なぜ getBoardData を7回呼ばないのか
//   あちらは `work_date` を `.eq` で1日に固定している。7回呼べば往復が7倍になり、
//   9/08 に段数を 8→2 に畳んで直した遅さを、別の形で作り直すことになる。
//   → **同じ形のクエリを日付範囲（gte/lte）で1回投げる。** 往復は増えない。
//
// 🔴 なぜ PlateView を使い回さないのか
//   あちらは experienced / ngReasons / isOtherJurisdiction を**必ず持つ**型である。
//   週表の第1段階（表示のみ）はそれらを引いていないので、false や [] を詰めると
//   「判定した結果そうだった」と区別がつかなくなる。
//   → 持っている情報だけの型（WeekPlate）を別に置く。D&D を足すときに広げる。
//
// 🔴 RLS が最後の砦。board.ts と同じく anon キー経由で読むため、
//   ログインしていなければ 0 件になる。「見えない」は設計どおり。
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { keepSiteJurisdictions } from "@/lib/site-jurisdictions";
import {
  GROUP_WORK_KINDS,
  OFF_KIND_LABEL,
  WORK_KIND_LABEL,
  addDays,
  startOfWeek,
  todayInJst,
  type BoardShiftGroup,
} from "@/lib/board-format";
import { findOverlaps } from "@/lib/overlap";
import type {
  Assignment,
  AssignmentRole,
  Company,
  Customer,
  Guard,
  Jurisdiction,
  OffKind,
  Qualification,
  Shift,
  Site,
} from "@/lib/types";

/** 週表のセルに並ぶ隊員1名。🔴 `PlateView` とは別物（上のコメント参照） */
export type WeekPlate = {
  assignmentId: string;
  guard: Guard;
  qualLabels: string[];
  role: AssignmentRole;
  isPartner: boolean;
  /**
   * 🔴 同じ隊員が同じ時間帯の別の枠にもいる。
   *   仮組みのうちは DB が止めない（assignments_no_overlap は `is_confirmed` 付き）。
   *   止めない代わりに**画面が必ず見せる**、が設計（board_core.sql 384行）。
   *   週表は日をまたいで人を動かせる＝重複を作りやすいので、日別より効く。
   */
  overlapping: boolean;
};

/** セルの中の枠。同じ日・同じ現場に班違いで複数あることがある */
export type WeekCellShift = {
  shift: Shift;
  plates: WeekPlate[];
};

export type WeekCell = {
  date: string;
  shifts: WeekCellShift[];
  /** その日その現場の必要人数の合計 */
  headcount: number;
  /** 実際に配置されている人数 */
  placed: number;
};

/** 週表の1行＝1現場 × 7日 */
export type WeekSiteRow = {
  site: Site;
  customer: Customer | null;
  cells: WeekCell[];
};

/** 得意先ごとのまとまり。A表の実物が得意先で束ねている（2026-09-09 実物解析） */
export type WeekGroup = {
  customer: Customer | null;
  rows: WeekSiteRow[];
};

/** 最下部の業務外の行（研修・有給 など）。A表の実物にも下部にこの区画がある */
export type WeekOffRow = {
  offKind: OffKind;
  label: string;
  cells: { date: string; guards: Guard[] }[];
};

/** プールの隊員。🔴 週の稼働日数を持つのが日別との違い（設計 §7-2-4） */
export type WeekPoolGuard = {
  guard: Guard;
  qualLabels: string[];
  isPartner: boolean;
  /** この週に稼働する日数。日別の画面では出せない情報 */
  weekDays: number;
};

export type WeekBoardData = {
  /** 週の初日（月曜） */
  startDate: string;
  /** 7日ぶんの日付 */
  dates: string[];
  /** 🔴 プールを絞る日。列ヘッダのクリックで移す（設計 §7-2-4） */
  baseDate: string;
  jurisdiction: Jurisdiction;
  jurisdictions: Jurisdiction[];
  group: BoardShiftGroup;
  groups: WeekGroup[];
  offRows: WeekOffRow[];
  pool: WeekPoolGuard[];
  counts: { draft: number; confirmed: number; shortage: number; overlap: number };
};

export type WeekBoardParams = {
  /** 週の初日。省略時は今日を含む週 */
  startDate?: string;
  /** プールの基準日。省略時は「今日がその週にあれば今日、なければ初日」 */
  baseDate?: string;
  jurisdictionCode?: string;
  group?: BoardShiftGroup;
};

/**
 * 重なりを見るために planned_* まで引いた配置。
 * 🔴 `Assignment` はこの2列を持たない（画面が使ってこなかったため）。
 *   board.ts の `SpanRaw` と同じ作法で、必要な側がローカルに広げる。
 */
type AssignmentWithSpan = Assignment & {
  planned_start_at: string | null;
  planned_end_at: string | null;
};

/** supabase-js の埋め込み select が返す形 */
type WeekShiftRaw = Shift & {
  site: (Site & { customer: Customer | null }) | null;
};

export async function getWeekBoardData(params: WeekBoardParams = {}): Promise<WeekBoardData> {
  const supabase = await createClient();
  const group = params.group ?? "day";
  const today = todayInJst();
  const startDate = params.startDate ?? startOfWeek(today);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
  const endDate = dates[6];
  // 今日がその週に入っていれば今日を既定の基準日にする。週送りしたら初日
  const baseDate =
    params.baseDate && dates.includes(params.baseDate)
      ? params.baseDate
      : dates.includes(today)
        ? today
        : startDate;

  const { data: jurisdictionRows, error: jError } = await supabase
    .from("jurisdictions")
    .select("id, code, name, allow_cross_staff, allow_cross_site")
    .order("code");
  if (jError) throw jError;

  // 切り替えに出すのは現場を持つ管轄だけ（src/lib/site-jurisdictions.ts）
  const jurisdictions = await keepSiteJurisdictions(
    supabase,
    (jurisdictionRows ?? []) as Jurisdiction[],
  );
  if (jurisdictions.length === 0) {
    // マイグレーションは通ったがダミー投入がまだ、という状態（board.ts と同じ扱い）
    return emptyWeek(startDate, dates, baseDate, group);
  }
  const jurisdiction =
    jurisdictions.find((j) => j.code === params.jurisdictionCode) ?? jurisdictions[0];

  // 🔴 ここに足すクエリは「管轄が決まっていれば投げられる」ものだけ。
  //   他の結果に依存するものを混ぜると静かに壊れる（board.ts と同じ約束）。
  const [shiftRes, assignRes, guardsRes, companiesRes, qualsRes, guardQualsRes] =
    await Promise.all([
      supabase
        .from("shifts")
        .select(
          `id, site_id, work_date, jurisdiction_id, work_kind, headcount,
         start_h, start_m, end_h, end_m, break_min,
         plan_comment, billing_note, status, cancelled_at,
         site:sites!inner (
           id, site_code, name, short_name, customer_id, jurisdiction_id,
           customer:customers ( id, staff_code, name, name_kana )
         )`,
        )
        .gte("work_date", startDate)
        .lte("work_date", endDate)
        .eq("jurisdiction_id", jurisdiction.id)
        .in("work_kind", GROUP_WORK_KINDS[group])
        .order("start_h")
        .order("start_m")
        .order("id"),

      // その週の稼働（配置・非現場・貸出をまとめて1回で引く）
      supabase
        .from("assignments")
        .select(
          `id, guard_id, work_date, kind, shift_id, role, is_long_distance, position,
         off_kind, off_work_kind, lent_to_company_id, external_site_name, status,
         planned_start_at, planned_end_at`,
        )
        // 🔴 前後1日を含める。夜勤は work_date が**開始日**なので、
        //   20:00–06:00 の枠は隣の日の枠と重なりうる（board.ts と同じ理由）。
        //   セルに並べるのは週の中だけで、広く取るのは重なりを見るため。
        .gte("work_date", addDays(startDate, -1))
        .lte("work_date", addDays(endDate, 1))
        .eq("status", "planned")
        .order("position"),

      supabase
        .from("guards")
        .select("id, staff_code, name, short_name, company_id, jurisdiction_id")
        .eq("status", "active")
        .order("staff_code", { nullsFirst: false }),
      supabase.from("companies").select("id, kind, name"),
      supabase.from("qualifications").select("id, code, name, short_label"),
      supabase.from("guard_qualifications").select("guard_id, qualification_id"),
    ]);

  for (const r of [shiftRes, assignRes, guardsRes, companiesRes, qualsRes, guardQualsRes]) {
    if (r.error) throw r.error;
  }

  const shifts = (shiftRes.data ?? []) as unknown as WeekShiftRaw[];
  const assignments = (assignRes.data ?? []) as AssignmentWithSpan[];
  const guards = (guardsRes.data ?? []) as Guard[];
  const companies = (companiesRes.data ?? []) as Company[];
  const qualifications = (qualsRes.data ?? []) as Qualification[];
  const guardQuals = (guardQualsRes.data ?? []) as {
    guard_id: string;
    qualification_id: string;
  }[];

  // ── 索引 ────────────────────────────────────────────
  const guardById = new Map(guards.map((g) => [g.id, g]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const qualById = new Map(qualifications.map((q) => [q.id, q]));

  const qualIdsByGuard = new Map<string, string[]>();
  for (const gq of guardQuals) {
    const list = qualIdsByGuard.get(gq.guard_id) ?? [];
    list.push(gq.qualification_id);
    qualIdsByGuard.set(gq.guard_id, list);
  }
  const qualLabelsOf = (guardId: string) =>
    (qualIdsByGuard.get(guardId) ?? [])
      .map((id) => qualById.get(id)?.short_label)
      .filter((v): v is string => Boolean(v));

  const isPartnerOf = (g: Guard) => companyById.get(g.company_id)?.kind === "partner";

  // 🔴 時間帯の重なり。**判定ではなく写し**（判定は DB の assignments_no_overlap）。
  //   仮組みのうちは DB が止めないので、ここで見せないと誰も気づけないまま
  //   一括確定でまとめて弾かれる。
  const overlapIds = new Set<string>();
  for (const [a, b] of findOverlaps(
    assignments
      .filter((a) => a.planned_start_at !== null && a.planned_end_at !== null)
      .map((a) => ({
        key: a.guard_id,
        start: a.planned_start_at as string,
        end: a.planned_end_at as string,
        id: a.id,
      })),
  )) {
    overlapIds.add(a.id);
    overlapIds.add(b.id);
  }

  // 枠 → 配置
  const assignsByShift = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (a.kind !== "site" || !a.shift_id) continue;
    const list = assignsByShift.get(a.shift_id) ?? [];
    list.push(a);
    assignsByShift.set(a.shift_id, list);
  }

  // ── 現場 × 日 のセルへ畳む ───────────────────────────
  //
  // 🔴 行は「その週に1日でも枠がある現場」だけ。全 1,593 件は出せない
  //   （設計 §7-2-10 の暫定）。
  const rowBySite = new Map<string, WeekSiteRow>();
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  for (const raw of shifts) {
    // 現場は別の入れ物へ、残りの列がそのまま Shift になる
    const { site, ...shiftCols } = raw;
    if (!site) continue; // !inner なので通常ありえないが、型の上では null
    const idx = dateIndex.get(shiftCols.work_date);
    if (idx === undefined) continue;

    let row = rowBySite.get(site.id);
    if (!row) {
      const { customer, ...siteCols } = site;
      row = {
        site: siteCols as Site,
        customer: customer ?? null,
        cells: dates.map((d) => ({ date: d, shifts: [], headcount: 0, placed: 0 })),
      };
      rowBySite.set(site.id, row);
    }

    const plates: WeekPlate[] = (assignsByShift.get(shiftCols.id) ?? [])
      .map((a) => {
        const guard = guardById.get(a.guard_id);
        if (!guard) return null;
        return {
          assignmentId: a.id,
          guard,
          qualLabels: qualLabelsOf(guard.id),
          role: a.role,
          isPartner: isPartnerOf(guard),
          overlapping: overlapIds.has(a.id),
        };
      })
      .filter((p): p is WeekPlate => p !== null);

    const cell = row.cells[idx];
    cell.shifts.push({ shift: shiftCols as Shift, plates });
    cell.headcount += shiftCols.headcount;
    cell.placed += plates.length;
  }

  // ── 得意先で束ねる ──────────────────────────────────
  //
  // 🔴 並び順は S-01 と同じ考え方（2026-09-02）：グループ＝得意先名順（固定）。
  //   毎週同じ場所に出るので探す位置を覚えられる。
  const groupMap = new Map<string, WeekGroup>();
  for (const row of rowBySite.values()) {
    const key = row.customer?.id ?? "";
    const g = groupMap.get(key) ?? { customer: row.customer, rows: [] };
    g.rows.push(row);
    groupMap.set(key, g);
  }
  const groups = [...groupMap.values()]
    .sort((a, b) => (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "", "ja"))
    .map((g) => ({
      ...g,
      rows: g.rows.sort((a, b) => a.site.name.localeCompare(b.site.name, "ja")),
    }));

  // ── 業務外の行（研修・有給 など）────────────────────
  // 🔴 一部勤務可（2026-09-16）は行を分ける。
  //   「有給」と「有給（夜A）」を同じ行に混ぜると、
  //   その日その隊員が**出られるのか出られないのか**が週表から読めなくなる。
  //   キーは区分まで含める（offKind だけだと一部と終日が同じ行に落ちる）。
  const offMap = new Map<string, { offKind: OffKind; label: string; byDate: Map<string, Guard[]> }>();
  for (const a of assignments) {
    if (a.kind !== "off" || !a.off_kind) continue;
    const guard = guardById.get(a.guard_id);
    if (!guard) continue;
    const key = `${a.off_kind}:${a.off_work_kind ?? ""}`;
    const base = OFF_KIND_LABEL[a.off_kind];
    const entry =
      offMap.get(key) ??
      {
        offKind: a.off_kind,
        label: a.off_work_kind ? `${base}（${WORK_KIND_LABEL[a.off_work_kind]}）` : base,
        byDate: new Map<string, Guard[]>(),
      };
    const list = entry.byDate.get(a.work_date) ?? [];
    list.push(guard);
    entry.byDate.set(a.work_date, list);
    offMap.set(key, entry);
  }
  const offRows: WeekOffRow[] = [...offMap.values()]
    .map(({ offKind, label, byDate }) => ({
      offKind,
      label,
      cells: dates.map((d) => ({ date: d, guards: byDate.get(d) ?? [] })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));

  // ── プール（基準日に稼働が無い隊員）──────────────────
  //
  // 🔴 「未配置」は日が決まって初めて意味を持つ（設計 §7-2-4）。
  //   週表には日が7つあるので、基準日で絞る。
  // 🔴 一部勤務可（2026-09-16）はプールに残す。
  //   週表は日勤・夜勤を分けずに1枚で見る画面なので、
  //   「日勤だけ休み」の隊員はその日の夜勤には出られる。
  //   外すのは**終日の休み**と、実際の稼働（配置・貸出）だけ。
  //   ⚠️ そのぶん「日勤を休む人を日勤の枠に置ける」は残る。
  //      区分まで見て止めるかは未決（screen-design.md §10）。
  const busyOnBase = new Set(
    assignments
      .filter((a) => a.work_date === baseDate)
      .filter((a) => a.kind !== "off" || !a.off_work_kind)
      .map((a) => a.guard_id),
  );
  // 週の稼働日数（現場に出る日だけ数える。有給・研修は稼働ではない）
  const weekDaysByGuard = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (a.kind === "off") continue;
    // 🔴 取得は前後1日ぶん広い。日数は週の中だけで数える
    if (!dateIndex.has(a.work_date)) continue;
    const set = weekDaysByGuard.get(a.guard_id) ?? new Set<string>();
    set.add(a.work_date);
    weekDaysByGuard.set(a.guard_id, set);
  }

  const pool: WeekPoolGuard[] = guards
    .filter((g) => !busyOnBase.has(g.id))
    .map((g) => ({
      guard: g,
      qualLabels: qualLabelsOf(g.id),
      isPartner: isPartnerOf(g),
      weekDays: weekDaysByGuard.get(g.id)?.size ?? 0,
    }));

  // ── 集計 ────────────────────────────────────────────
  let draft = 0;
  let confirmed = 0;
  let shortage = 0;
  let overlap = 0;
  for (const row of rowBySite.values()) {
    for (const cell of row.cells) {
      for (const s of cell.shifts) {
        if (s.shift.status === "confirmed") confirmed += 1;
        else draft += 1;
      }
      if (cell.shifts.length > 0 && cell.placed < cell.headcount) shortage += 1;
      for (const s2 of cell.shifts) overlap += s2.plates.filter((p) => p.overlapping).length;
    }
  }

  return {
    startDate,
    dates,
    baseDate,
    jurisdiction,
    jurisdictions,
    group,
    groups,
    offRows,
    pool,
    counts: { draft, confirmed, shortage, overlap },
  };
}

function emptyWeek(
  startDate: string,
  dates: string[],
  baseDate: string,
  group: BoardShiftGroup,
): WeekBoardData {
  return {
    startDate,
    dates,
    baseDate,
    jurisdiction: { id: "", code: "", name: "—", allow_cross_staff: true, allow_cross_site: true },
    jurisdictions: [],
    group,
    groups: [],
    offRows: [],
    pool: [],
    counts: { draft: 0, confirmed: 0, shortage: 0, overlap: 0 },
  };
}

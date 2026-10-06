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
import { keepSiteJurisdictions } from "@/lib/site-jurisdictions";
import { fetchAll } from "@/lib/fetch-all";
import { foldQuals } from "@/lib/qual-labels";
// 🔴 内部でも使う。再エクスポートしただけでは同一モジュール内から参照できない
import {
  GROUP_WORK_KINDS,
  OFF_KIND_LABEL,
  WORK_KIND_LABEL,
  addDays,
  compareByKana,
  daysBetween,
  formatSpanPlace,
  todayInJst,
  type BoardShiftGroup,
} from "@/lib/board-format";
import { findOverlaps } from "@/lib/overlap";
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
  GROUP_WORK_KINDS,
  todayInJst,
  addDays,
  startOfWeek,
  formatTime,
  formatWeekDay,
  toShiftMaxDate,
  formatBoardDate,
} from "@/lib/board-format";
export type { BoardShiftGroup } from "@/lib/board-format";

// 🔴 BoardShiftGroup と GROUP_WORK_KINDS は board-format.ts へ移した（2026-09-15）。
//   週表（S-07）が同じ切り替えを持つため。上で再エクスポートしているので
//   `from "@/lib/board"` の既存 import は変わらない。

/** 「現場を追加」の候補。予定のひな形（plan_*）を持つので、選ぶだけで時刻が埋まる */
export type SitePick = {
  id: string;
  name: string;
  short_name: string;
  customerName: string | null;
  plan_start_h: number | null;
  plan_start_m: number | null;
  plan_end_h: number | null;
  plan_end_m: number | null;
  plan_break: number | null;
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
  /**
   * 「現場を追加」で選べる現場（その管轄の稼働中のもの）。
   * 🔴 ダミーは42件だが**実データは 1,593 件**。件数が増えたら
   *   ここで全件を画面へ送るのをやめ、検索をサーバ側へ移すこと。
   *   （今は全件でも一瞬で、検索の往復を挟まないほうが速い）
   */
  sitePicks: SitePick[];
  /** 新規現場を作るときに選ぶ得意先。ShiftMax 由来のマスタなので**選ぶだけ**（新規作成はしない） */
  customerPicks: { id: string; name: string }[];
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

/**
 * 経験（★）の〈隊員 × 現場〉を、表示日より前の1年ぶん**全件**引く（2026-10-02）。
 *
 * 🔴 以前は assignments を1年ぶん直接読んでいた。PostgREST は既定で 1,000行までしか返さないため、
 *   7月の実データ（配置 2,901件）を入れた時点で約1,900件が**黙って落ち**、★ が付かなくなった。
 *   → ビュー guard_site_experience（20261002180000）で〈隊員 × 現場〉に畳み、
 *     さらに 1,000行ずつ**最後まで**取る（src/lib/fetch-all.ts）。
 *
 * 🔴 **その盤面に出ている現場だけ**に絞る（2026-10-06）。
 *   ★ は枠の中のプレートにしか出ない（プールには出ない）ので、ほかの現場の経験は使っていなかった。
 *   3か月分を入れた時点で全件が 1,231行＝2回に分けて順番に取っており、配置ボードでいちばん遅い問い合わせだった
 *   （350〜580ms・柴山の手元で実測）。
 */
function fetchExperience(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workDate: string,
  siteIds: string[],
) {
  if (siteIds.length === 0) {
    return Promise.resolve({ data: [] as { guard_id: string; site_id: string }[], error: null });
  }
  return fetchAll<{ guard_id: string; site_id: string }>((from, to) =>
    supabase
      .from("guard_site_experience")
      .select("guard_id, site_id")
      .in("site_id", siteIds)
      .lt("first_date", workDate)
      .gte("last_date", addDays(workDate, -365))
      .order("guard_id")
      .order("site_id")
      .range(from, to),
  );
}

export async function getBoardData(params: BoardParams = {}): Promise<BoardData> {
  const supabase = await createClient();
  const group = params.group ?? "day";
  const workDate = params.workDate ?? todayInJst();

  // ── 管轄 ────────────────────────────────────────────
  // 切り替えに出すのは現場を持つ管轄だけ（src/lib/site-jurisdictions.ts）
  // 🔴 一覧を Promise のまま渡し、現場の問い合わせと同時に投げる（2026-10-06）
  const jurisdictions = await keepSiteJurisdictions(
    supabase,
    supabase
      .from("jurisdictions")
      .select("id, code, name, allow_cross_staff, allow_cross_site")
      .order("code")
      .then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as Jurisdiction[];
      }),
  );
  if (jurisdictions.length === 0) {
    // マイグレーションは通ったがダミー投入がまだ、という状態。
    // ここで落とすと原因が分かりにくいので、空のボードとして返す。
    return emptyBoard(workDate, group);
  }
  const jurisdiction =
    jurisdictions.find((j) => j.code === params.jurisdictionCode) ?? jurisdictions[0];

  // 枠（現場・得意先・必要資格を同時に引く）
  // 🔴 経験（★）がこの結果の現場で絞るので、Promise.all の外で先に投げておく（2026-10-06）
  //   Promise.resolve で包むのは、supabase-js の問い合わせが**then を呼ぶたびに投げ直す**ため。
  //   包まずに2か所から待つと、同じ問い合わせが2回飛ぶ
  const shiftsQuery = Promise.resolve(
    supabase
      .from("shifts")
      .select(
        `id, site_id, work_date, jurisdiction_id, work_kind, headcount,
       start_h, start_m, end_h, end_m, break_min,
       plan_comment, billing_note, status, cancelled_at,
       site:sites!inner (
         id, site_code, name, short_name, customer_id, jurisdiction_id,
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
      .order("id"),
  );

  // ── 取得：🔴 段数を2つに畳む（2026-09-08）────────────────
  //
  // 以前はここから下が**8回の直列**だった。1回ごとに Supabase への往復が
  // まるごと積み上がり、日付の切り替えに約4秒かかっていた（柴山の実測）。
  // 管轄以外はどれも他の結果を必要としないので、まとめて投げてよい。
  // → 効くのは往復の**回数**ではなく**段数**。8段 → 2段。
  //
  // 🔴 経験（past）だけは枠の結果を待つ（2026-10-06）。盤面の現場に絞るため。
  //   枠（約100ms）のあとに小さい1回を足すほうが、全件を2回に分けて取るより速い。
  //   ほかの問い合わせは待たせない（枠の Promise に .then でつないでいる）。
  //
  // 🔴 ここに足すクエリは「管轄が決まっていれば投げられる」ものだけ。
  //   他の結果に依存するものを混ぜると、静かに壊れる。
  const [
    shiftRes,
    assignRes,
    guardsRes,
    companiesRes,
    qualsRes,
    guardQualsRes,
    ngRes,
    pastRes,
    spanRes,
    sitePickRes,
    customerPickRes,
  ] = await Promise.all([
    shiftsQuery,

    // その日の稼働（配置・非現場・貸出をまとめて1回で引く）
    // 🔴 data-model.md §4-2 が1テーブルに統合した意図がここで効く。
    //    「応援中と気づかず自社案件に配置する」を防ぐには、
    //    その日の稼働が**1回のクエリで全部見える**必要がある。
    supabase
      .from("assignments")
      .select(
        `id, guard_id, work_date, kind, shift_id, role, is_long_distance, position,
       off_kind, off_work_kind, lent_to_company_id, external_site_name, status,
       shift:shifts ( work_kind )`,
      )
      .eq("work_date", workDate)
      .eq("status", "planned")
      .order("position"),

    // マスタ（隊員・会社・資格・NG）
    supabase
      .from("guards")
      .select("id, staff_code, name, name_kana, short_name, company_id, jurisdiction_id")
      .eq("status", "active")
      .order("staff_code", { nullsFirst: false }),
    supabase.from("companies").select("id, kind, name"),
    supabase.from("qualifications").select("id, code, name, short_label, category"),
    // 🔴 資格は隊員 × 資格で育つ（250名 × 数種）。1,000行で切れないよう最後まで読む
    // 🔴 期限切れは「持っていない」扱い（2026-10-05）。列車見張は全件に期限がある
    fetchAll<{ guard_id: string; qualification_id: string }>((from, to) =>
      supabase
        .from("guard_qualifications")
        .select("guard_id, qualification_id")
        .or(`expires_on.is.null,expires_on.gte.${workDate}`)
        .order("guard_id")
        .order("qualification_id")
        .range(from, to),
    ),
    supabase
      .from("ng_entries")
      .select("id, kind, guard_id, site_id, counterpart_guard_id, reason, severity"),

    // 経験（★）── 〈隊員 × 現場〉に畳んだビューから引く（fetchExperience）
    // 🔴 期間を切る。1年より前の経験を「行ったことがある」と言ってよいかは業務判断だが、
    //   誰にも確認していないので、まず1年で置く（gap-analysis A-1 に積む）。
    shiftsQuery.then(({ data }) =>
      fetchExperience(supabase, workDate, [...new Set((data ?? []).map((s) => s.site_id))]),
    ),

    // 重なり判定に使う前後1日ぶんの稼働時間帯
    // 🔴 その日の実態で見る。管轄や日勤/夜勤で切ると見えない重なりが残る。
    // 🔴 前後1日を含める。夜勤は work_date が**開始日**なので、
    //   20:00–06:00 の枠は隣の日の枠と重なりうる。
    // 🔴 判定はしていない。保存を止めるのは DB の assignments_no_overlap だけで、
    //   ここは同じ規則の写しを**先に見せている**にすぎない（src/lib/overlap.ts）。
    supabase
      .from("assignments")
      .select(
        `guard_id, work_date, planned_start_at, planned_end_at,
       shift:shifts (
         id,
         work_kind,
         site:sites ( short_name, customer:customers ( name ) ),
         jurisdiction:jurisdictions ( name )
       )`,
      )
      .eq("status", "planned")
      .gte("work_date", addDays(workDate, -1))
      .lte("work_date", addDays(workDate, 1))
      .not("planned_start_at", "is", null)
      .not("planned_end_at", "is", null),

    // 「現場を追加」の候補
    // 🔴 その管轄の稼働中の現場だけ。管轄をまたぐ配置はできるが、
    //   **枠を作る**のは自管轄の現場に限る（jurisdiction は shifts の NOT NULL 列で、
    //   引き渡しが「日付 × 管轄」単位のため）。
    supabase
      .from("sites")
      .select(
        `id, name, short_name, plan_start_h, plan_start_m, plan_end_h, plan_end_m, plan_break,
       customer:customers ( name )`,
      )
      .eq("jurisdiction_id", jurisdiction.id)
      .eq("status", "active")
      .order("name"),

    supabase.from("customers").select("id, name").order("name"),
  ]);

  for (const r of [
    shiftRes,
    assignRes,
    guardsRes,
    companiesRes,
    qualsRes,
    guardQualsRes,
    ngRes,
    pastRes,
    spanRes,
    sitePickRes,
    customerPickRes,
  ]) {
    if (r.error) throw r.error;
  }

  const shifts = (shiftRes.data ?? []) as unknown as ShiftRowRaw[];
  const shiftIds = shifts.map((s) => s.id);
  // 🔴 shift.work_kind はプールの「日勤済／夜勤済」にだけ使う（2026-10-05）。
  //   別の管轄の枠も含むため、shifts（この管轄だけ）からは引けない
  const allAssignments = (assignRes.data ?? []) as unknown as (Assignment & {
    shift: { work_kind: WorkKind } | null;
  })[];

  // 🔴 フリガナ順にしておく。プール（未配置）はこの順のまま出る（2026-10-05）
  const guards = ((guardsRes.data ?? []) as Guard[]).sort(compareByKana);
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

  // ── 経験（★）── 取得は上の Promise.all 済み。ここは組み立てるだけ
  const experienced = new Set<string>();
  for (const row of pastRes.data) experienced.add(`${row.guard_id}:${row.site_id}`);

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
  let shortage = 0;

  for (const raw of shifts) {
    const site = raw.site;
    if (!site) continue; // !inner を付けているので通常は起きない
    // 🔴 隊長を先頭に置く（2026-09-07・管制からの要望）。
    //   position は「枠の中で人を並べ替えた結果」を持つ列で、隊長かどうかとは別。
    //   並べ替えの中に隊長を混ぜると、隊長を付け外しするたびに順番が動いて分かりにくい。
    //   そこで **表示の段でだけ** 隊長を前に出し、position は触らない。
    const rowAssignments = (byShift.get(raw.id) ?? [])
      .slice()
      .sort((a, b) => {
        const lead = Number(b.role === "leader") - Number(a.role === "leader");
        return lead !== 0 ? lead : a.position - b.position;
      });
    const coAssignedGuardIds = rowAssignments.map((a) => a.guard_id);

    // 🔴 列車見張は「この現場が必要とする会社」のものだけ名札に出す（qual-labels.ts）
    const requiredIds = new Set(site.site_required_qualifications.map((r) => r.qualification_id));
    const plates: PlateView[] = [];
    for (const a of rowAssignments) {
      const guard = guardById.get(a.guard_id);
      if (!guard) continue; // 退職して status=inactive になった隊員の過去行など
      const company = companyById.get(guard.company_id);
      const qualIds = qualIdsByGuard.get(guard.id) ?? [];
      plates.push({
        assignmentId: a.id,
        guard,
        qualLabels: foldQuals(qualIds, qualById, { kind: "site", required: requiredIds }).labels,
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

    // 🔴 中止の枠は警告を出さない。誰も稼働しないので「不足」も「資格」も意味を持たない。
    //   ここで消さないと、中止にした瞬間に⚠要確認が増える＝中止にするほど画面が汚れる。
    const cancelled = shift.cancelled_at !== null;

    if (!cancelled && plates.length < shift.headcount) {
      shortage++;
      warnings.push({
        kind: "shortage",
        message: `${site.name}：必要${shift.headcount}に対し${plates.length}名（${shift.headcount - plates.length}名不足）`,
      });
    }
    for (const q of cancelled ? [] : missingQualifications) {
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

  // ── 時間帯の重なり（要確認に最初から出す）────────────
  //
  // 🔴 なぜ「確定して失敗してから」ではないのか（2026-09-04・柴山の指摘）
  //   重なりは、警告の中で**唯一 確定 を丸ごと止める**条件である
  //   （不足も資格不足も NG も置ける ─ screen-design.md §2-5）。
  //   押してから知らされると、40枠のどこを直せばよいかを探すところから始まる。
  //   **押す前に見えていれば、そもそもエラーに当たらない。**
  //
  // 重なりの元データは上の Promise.all で取得済み
  const spanRaw = spanRes.data;

  type SpanRaw = {
    guard_id: string;
    work_date: string;
    planned_start_at: string;
    planned_end_at: string;
    shift: {
      id: string;
      work_kind: WorkKind;
      site: { short_name: string; customer: { name: string } | null } | null;
      jurisdiction: { name: string } | null;
    } | null;
  };

  const spans = ((spanRaw ?? []) as unknown as SpanRaw[]).map((r) => ({
    key: r.guard_id,
    start: r.planned_start_at,
    end: r.planned_end_at,
    // 🔴 片方でもこの盤面にあるものだけ出す。
    //   両方とも別の管轄・別の勤務なら、この画面からは直せず、
    //   この画面の 一括確定 も止めない。出しても手が出せない警告は
    //   「読まない帯」を作るだけで、本当に効く警告まで埋もれる。
    //   （どちらの盤面にも片側は必ずあるので、見落としにはならない）
    onThisBoard: r.shift ? shiftIdSet.has(r.shift.id) : false,
    place: formatSpanPlace({
      siteName: r.shift?.site?.short_name ?? null,
      customerName: r.shift?.site?.customer?.name ?? null,
      jurisdictionName: r.shift?.jurisdiction?.name ?? null,
      workKind: r.shift?.work_kind ?? null,
      start: r.planned_start_at,
      end: r.planned_end_at,
    }),
  }));

  const overlapSeen = new Set<string>();
  for (const [a, b] of findOverlaps(spans)) {
    if (!a.onThisBoard && !b.onThisBoard) continue;
    const guard = guardById.get(a.key);
    const message = `${guard?.short_name ?? "（氏名不明）"}：${a.place} と ${b.place}`;
    if (overlapSeen.has(message)) continue;
    overlapSeen.add(message);
    warnings.push({ kind: "overlap", message });
  }

  // 🔴 重なりを先頭に出す。ここだけが「直さないと確定できない」種類の警告で、
  //   不足・資格・NG と同じ扱いで混ぜると、閉じられる帯の下へ流れて見えなくなる。
  warnings.sort((a, b) => Number(b.kind === "overlap") - Number(a.kind === "overlap"));

  // ── プールから除く人 ─────────────────────────────────
  //
  // 🔴 「その日すでに稼働がある人」を除く。**いま画面に出ている枠だけでは判定しない**
  //   （2026-09-03 修正）。
  //   直していたのは次の誤りである：
  //   東京の 08:00–17:00 に確定済みの隊員が、管轄を千葉に切り替えた途端
  //   「未配置」としてプールに現れていた。assignedGuardIds を
  //   **画面に出ている枠に入っている人**からしか作っていなかったため。
  //   人は管轄をまたいで1人しかいない。プールは画面の都合ではなく
  //   **その日の実態**で決まる。
  //
  // 🔴 ただし**反対側の区分にだけ入っている人はプールに残し、印を付ける**（2026-10-05）。
  //   以前はここで一律に外しており、日勤に入れた人を夜勤の盤面に置く経路が無かった。
  //   7月の実データで「日勤＋夜A」25件・「日勤＋夜B」14件（約15名）＝**1日1〜2件**ある。
  //   印（日勤済／夜勤済）は「今日もう1回出ている人」を、うっかり入れないため。
  //   時間帯が本当に重なれば、確定時に DB（assignments_no_overlap）が止め、要確認にも出る。
  //   🟠 同じ区分の掛け持ち（夜A＋夜A・7月に4件／1名）はまれなので、従来どおり外す。
  // 🔴 休みは**いま見ている区分にかかるものだけ**プールから外す（2026-09-16）。
  //   「一部勤務可」── 日勤なら出られる／A夜勤なら出られる、という休み方が実在する。
  //   全部まとめて外していると、夜勤だけ休む隊員が日勤の盤面からも消える。
  //
  //   🔴 夜勤は A と B の**両方を休むときだけ**外す。
  //     この盤面の「夜勤」は nightA と nightB を1つにまとめた表示なので、
  //     片方だけ休む人はもう片方に出られる。
  //     ⚠️ そのぶん「A を休む人が A の枠に置けてしまう」は残る。
  //        枠単位で止めるかは未決（screen-design.md §10）。
  const nightOff = new Map<string, Set<string>>();
  const busy = new Set<string>();
  /** 反対側の区分にだけ入っている人 → 名札の印 */
  const doneOther = new Map<string, string>();
  const ownKinds = new Set<WorkKind>(GROUP_WORK_KINDS[group]);
  for (const a of allAssignments) {
    if (a.kind !== "off") {
      if (a.kind === "site" && a.shift && !ownKinds.has(a.shift.work_kind)) {
        doneOther.set(a.guard_id, group === "day" ? "夜勤済" : "日勤済");
        continue;
      }
      busy.add(a.guard_id);
      continue;
    }
    // 終日の休み（区分の指定なし）は、どの盤面からも外す
    if (!a.off_work_kind) {
      busy.add(a.guard_id);
      continue;
    }
    if (a.off_work_kind === "day") {
      if (group === "day") busy.add(a.guard_id);
      continue;
    }
    const set = nightOff.get(a.guard_id) ?? new Set<string>();
    set.add(a.off_work_kind);
    nightOff.set(a.guard_id, set);
  }
  if (group === "night") {
    for (const [guardId, kinds] of nightOff) {
      if (kinds.has("nightA") && kinds.has("nightB")) busy.add(guardId);
    }
  }

  // 🔴 ラベルは「有給」ではなく「有給（夜A）」まで出す（2026-09-16）。
  //   一部勤務可を入れた以上、**終日休みなのか一部なのか**が分からないと、
  //   プールに居ないことの理由が読めない。
  const offMap = new Map<string, Guard[]>();
  for (const a of offAssignments) {
    const guard = guardById.get(a.guard_id);
    if (!guard || !a.off_kind) continue;
    const base = OFF_KIND_LABEL[a.off_kind];
    const label = a.off_work_kind ? `${base}（${WORK_KIND_LABEL[a.off_work_kind]}）` : base;
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
    .map((g) => {
      // 🔴 プールでは列車見張を「列N」に畳む（qual-labels.ts）
      const q = foldQuals(qualIdsByGuard.get(g.id) ?? [], qualById, { kind: "pool" });
      return {
        guard: g,
        qualLabels: q.labels,
        trainLabels: q.train,
        isPartner: companyById.get(g.company_id)?.kind === "partner",
        doneLabel: doneOther.get(g.id),
      };
    });

  // ── 「現場を追加」の候補（取得は上の Promise.all 済み）──────
  const siteRows = sitePickRes.data;

  const sitePicks: SitePick[] = (
    (siteRows ?? []) as unknown as (Omit<SitePick, "customerName"> & {
      customer: { name: string } | null;
    })[]
  ).map(({ customer, ...rest }) => ({ ...rest, customerName: customer?.name ?? null }));

  const customerRows = customerPickRes.data;

  return {
    date: workDate,
    jurisdiction,
    jurisdictions,
    group,
    rows,
    sitePicks,
    customerPicks: (customerRows ?? []) as { id: string; name: string }[],
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
    sitePicks: [],
    customerPicks: [],
    warnings: [],
    counts: { draft: 0, confirmed: 0, shortage: 0 },
    nearestDateWithShifts: null,
  };
}

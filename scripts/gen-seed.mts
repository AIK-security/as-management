// ダミーデータ（scripts/dummy-data.mts）から seed SQL を生成する。
//
// 🔴 なぜ生成するのか
//   段2 で配置ボードのデータ元を fixtures → Supabase に移す。
//   fixtures は決定的な擬似乱数で作られているため、同じ絵を DB 側でも再現できる。
//   生成物（supabase/seed/*.sql）をコミットしておけば、
//   **投入する人は Node を持っていなくても SQL Editor に貼るだけで済む**。
//
// 実行：node --experimental-strip-types scripts/gen-seed.mts
//
// 🔴 ここで作るのは**すべて架空のデータ**。本番データは持ち込まない（CLAUDE.md）。

import {
  ASSIGNMENTS,
  BOARD_DATE,
  COMPANIES,
  CUSTOMERS,
  GUARDS,
  JURISDICTIONS,
  NG_ENTRIES,
  QUALIFICATIONS,
  SHIFTS,
  SITES,
  SITE_EXPERIENCE,
} from "./dummy-data.mts";
import { writeFileSync, mkdirSync } from "node:fs";

// ── UUID を決定的に作る ────────────────────────────────
// fixtures の id（"s-1" など）は uuid ではないため、種類ごとに前置きを変えて
// 連番から uuid を組み立てる。**毎回同じ値になる**ので、seed を流し直しても
// 参照が崩れない（手で書いた画面の URL などが生き続ける）。
const PREFIX = {
  jurisdiction: "10000000",
  company: "20000000",
  qualification: "30000000",
  customer: "40000000",
  site: "50000000",
  guard: "60000000",
  shift: "70000000",
  assignment: "80000000",
  ng: "90000000",
  guardQual: "a0000000",
  siteReqQual: "b0000000",
  pastShift: "c0000000",
  pastAssignment: "d0000000",
} as const;

function uuidOf(kind: keyof typeof PREFIX, n: number): string {
  return `${PREFIX[kind]}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** fixtures の id 末尾の数値を取る（"s-12" → 12） */
function idNum(id: string): number {
  const n = Number(id.split("-").pop());
  if (!Number.isFinite(n)) throw new Error(`数値を取り出せない id: ${id}`);
  return n;
}

const jurisdictionUuid = new Map(
  JURISDICTIONS.map((j, i) => [j.id, uuidOf("jurisdiction", i + 1)]),
);
const companyUuid = new Map(COMPANIES.map((c, i) => [c.id, uuidOf("company", i + 1)]));
const qualUuid = new Map(QUALIFICATIONS.map((q, i) => [q.id, uuidOf("qualification", i + 1)]));
const customerUuid = new Map(CUSTOMERS.map((c) => [c.id, uuidOf("customer", idNum(c.id))]));
const siteUuid = new Map(SITES.map((s) => [s.id, uuidOf("site", idNum(s.id))]));
const guardUuid = new Map(GUARDS.map((g) => [g.id, uuidOf("guard", idNum(g.id))]));
const shiftUuid = new Map(SHIFTS.map((s) => [s.id, uuidOf("shift", idNum(s.id))]));

// ── SQL リテラル ──────────────────────────────────────
function q(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "null";
  return `'${v.replace(/'/g, "''")}'`;
}
function n(v: number | null | undefined): string {
  return v === null || v === undefined ? "null" : String(v);
}
function b(v: boolean): string {
  return v ? "true" : "false";
}

/** JST の日時を timestamptz リテラルにする。DB 側の時差解釈に頼らない */
function jst(date: string, h: number, m: number, addDay = 0): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + addDay));
  const iso = t.toISOString().slice(0, 10);
  return `'${iso} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09'`;
}

// ── 配置の予定時刻を枠から作る ─────────────────────────
type Interval = { start: number; end: number };

/** 枠の予定時刻。終了が開始以下なら翌日にまたぐ（夜勤 20:00→06:00） */
function shiftInterval(sh: (typeof SHIFTS)[number]) {
  const crossesDay = sh.endH * 60 + sh.endM <= sh.startH * 60 + sh.startM;
  return {
    startSql: jst(sh.workDate, sh.startH, sh.startM),
    endSql: jst(sh.workDate, sh.endH, sh.endM, crossesDay ? 1 : 0),
    // 重なり判定用（分単位・その日の 00:00 起点）
    range: {
      start: sh.startH * 60 + sh.startM,
      end: sh.endH * 60 + sh.endM + (crossesDay ? 24 * 60 : 0),
    } as Interval,
  };
}

const shiftById = new Map(SHIFTS.map((s) => [s.id, s]));

// ── 🔴 確定どうしの時間帯の重なりを取り除く ────────────────
//
// fixtures は隊員カーソルを一巡させて枠を埋めるため、
// **同じ隊員が同じ時間帯の2枠に入っている行がある**（現実には不可能）。
// DB 側は EXCLUDE 制約（assignments_no_overlap）でこれを拒否するので、
// そのまま流すと seed が落ちる。
//
// 🟢 制約が正しく仕事をしている。dummy 側を現実に合わせる。
// ・**確定どうしが重なる場合だけ**後から来たほうを落とす（枠は1名不足になる）
// ・仮組み（draft）どうしの重なりは残す。**仮組み中は重ねられる**のが仕様であり、
//   画面の警告表示を確かめる材料になる（8/27 決定・自動で弾かない）
const confirmedByGuard = new Map<string, Interval[]>();
const droppedAssignmentIds = new Set<string>();

for (const a of ASSIGNMENTS) {
  if (a.kind !== "site" || !a.shiftId) continue;
  const sh = shiftById.get(a.shiftId)!;
  if (sh.status !== "confirmed") continue;
  const { range } = shiftInterval(sh);
  const taken = confirmedByGuard.get(a.guardId) ?? [];
  const clash = taken.some((t) => t.start < range.end && range.start < t.end);
  if (clash) {
    droppedAssignmentIds.add(a.id);
  } else {
    taken.push(range);
    confirmedByGuard.set(a.guardId, taken);
  }
}

const assignments = ASSIGNMENTS.filter((a) => !droppedAssignmentIds.has(a.id));

// ── 過去の配置履歴（★「行ったことがある」の元データ）─────────
//
// 🔴 専用テーブルは作らない。★ は assignments の履歴から引く（data-model.md §4-6）。
//   fixtures の SITE_EXPERIENCE と同じ組み合わせを、過去日の配置として入れる。
//
// 🔴 過去分の予定時刻は入れない（null）。
//   架空の過去に「何時から何時まで」を捏造しても意味が無く、
//   時刻が無い行は重なり判定の対象外（制約の where 句）なので副作用も無い。
const PAST_DATE = "2026-08-18";
const experiencePairs = [...SITE_EXPERIENCE].map((key) => {
  const [guardId, siteId] = key.split(":");
  return { guardId, siteId };
});
const pastSiteIds = [...new Set(experiencePairs.map((p) => p.siteId))];

// ── 生成 ──────────────────────────────────────────────
const out: string[] = [];
const w = (s = "") => out.push(s);

w("-- =============================================================");
w("-- 配置ボードのダミーデータ（自動生成・2026-09-02）");
w("--");
w("-- 🔴 このファイルは手で編集しない。");
w("--    生成元：scripts/dummy-data.mts");
w("--    再生成：node --experimental-strip-types scripts/gen-seed.mts");
w("--");
w("-- 🔴 氏名・現場名・得意先名はすべて架空。本番データは持ち込まない（CLAUDE.md）。");
w("--    規模だけ実測に寄せてある（現場42件／隊員104名／プレート約130枚）。");
w("--    密度が違うと画面設計の検証にならないため。");
w("--");
w("-- 使い方：Supabase ダッシュボード > SQL Editor に貼って実行する。");
w("--        何度流しても同じ状態になる（先頭で truncate する）。");
w("-- =============================================================");
w();
w("begin;");
w();
w("-- 依存の順に消す。cascade は使わない（消える範囲を明示する）");
w("truncate table");
w("  public.assignments,");
w("  public.ng_entries,");
w("  public.board_reviews,");
w("  public.shifts,");
w("  public.site_required_qualifications,");
w("  public.guard_qualifications,");
w("  public.guard_contacts,");
w("  public.sites,");
w("  public.guards,");
w("  public.customers,");
w("  public.companies,");
w("  public.qualifications,");
w("  public.departments,");
w("  public.jurisdictions;");
w();

// 管轄
w("-- ── 管轄 ──────────────────────────────────────────");
w("insert into public.jurisdictions (id, code, name, allow_cross_staff, allow_cross_site) values");
w(
  JURISDICTIONS.map(
    (j) =>
      `  ('${jurisdictionUuid.get(j.id)}', ${q(j.code)}, ${q(j.name)}, ${b(j.allowCrossStaff)}, ${b(j.allowCrossSite)})`,
  ).join(",\n") + ";",
);
w();

// 会社
w("-- ── 会社（自社／協力会社）──────────────────────────");
w("insert into public.companies (id, name, kind) values");
w(
  COMPANIES.map((c) => `  ('${companyUuid.get(c.id)}', ${q(c.name)}, ${q(c.kind)})`).join(",\n") +
    ";",
);
w();

// 資格
w("-- ── 資格 ──────────────────────────────────────────");
w("insert into public.qualifications (id, code, name, short_label) values");
w(
  QUALIFICATIONS.map(
    (x) => `  ('${qualUuid.get(x.id)}', ${q(x.id)}, ${q(x.name)}, ${q(x.shortLabel)})`,
  ).join(",\n") + ";",
);
w();

// 得意先
w("-- ── 得意先 ────────────────────────────────────────");
w("insert into public.customers (id, staff_code, name) values");
w(
  CUSTOMERS.map(
    (c) => `  ('${customerUuid.get(c.id)}', ${q(`CU${String(idNum(c.id)).padStart(4, "0")}`)}, ${q(c.name)})`,
  ).join(",\n") + ";",
);
w();

// 現場
w("-- ── 現場（勤務マスタ）──────────────────────────────");
w(
  "insert into public.sites (id, site_code, guard_target_no, name, short_name, customer_id, jurisdiction_id) values",
);
w(
  SITES.map(
    (s) =>
      `  ('${siteUuid.get(s.id)}', ${q(`ST${String(idNum(s.id)).padStart(4, "0")}`)}, ${q(s.guardPostNo)}, ${q(s.name)}, ${q(s.shortName)}, '${customerUuid.get(s.customerId)}', '${jurisdictionUuid.get(s.jurisdictionId)}')`,
  ).join(",\n") + ";",
);
w();

// 現場が求める資格
const siteReq = SITES.flatMap((s) =>
  s.requiredQualificationIds.map((qid) => ({ siteId: s.id, qid })),
);
if (siteReq.length) {
  w("-- ── 現場が求める資格 ───────────────────────────────");
  w("insert into public.site_required_qualifications (id, site_id, qualification_id) values");
  w(
    siteReq
      .map(
        (r, i) =>
          `  ('${uuidOf("siteReqQual", i + 1)}', '${siteUuid.get(r.siteId)}', '${qualUuid.get(r.qid)}')`,
      )
      .join(",\n") + ";",
  );
  w();
}

// 隊員
w("-- ── 隊員 ──────────────────────────────────────────");
w("-- 🔴 協力会社の隊員は staff_code を持たない（ShiftMax に登録が無い）");
w(
  "insert into public.guards (id, staff_code, name, short_name, jurisdiction_id, company_id, employment_type) values",
);
w(
  GUARDS.map((g) => {
    const partner = COMPANIES.find((c) => c.id === g.companyId)?.kind === "partner";
    return `  ('${guardUuid.get(g.id)}', ${q(g.personCode)}, ${q(g.name)}, ${q(g.shortName)}, '${jurisdictionUuid.get(g.jurisdictionId)}', '${companyUuid.get(g.companyId)}', ${q(partner ? "partner" : "employee")})`;
  }).join(",\n") + ";",
);
w();

// 隊員が持つ資格
const guardQuals = GUARDS.flatMap((g) =>
  g.qualificationIds.map((qid) => ({ guardId: g.id, qid })),
);
w("-- ── 隊員が持つ資格 ─────────────────────────────────");
w("insert into public.guard_qualifications (id, guard_id, qualification_id) values");
w(
  guardQuals
    .map(
      (r, i) =>
        `  ('${uuidOf("guardQual", i + 1)}', '${guardUuid.get(r.guardId)}', '${qualUuid.get(r.qid)}')`,
    )
    .join(",\n") + ";",
);
w();

// 配置枠
w("-- ── 配置枠（A表の1行）──────────────────────────────");
w("-- jurisdiction_id はトリガーが sites から埋めるため、ここでは渡さない");
w(
  "insert into public.shifts (id, site_id, work_date, jurisdiction_id, work_kind, headcount, start_h, start_m, end_h, end_m, break_min, band_name, plan_comment, status, changed_after_confirm) values",
);
w(
  SHIFTS.map(
    (s) =>
      `  ('${shiftUuid.get(s.id)}', '${siteUuid.get(s.siteId)}', '${s.workDate}', '${jurisdictionUuid.get(s.jurisdictionId)}', ${q(s.workKind)}, ${n(s.headcount)}, ${n(s.startH)}, ${n(s.startM)}, ${n(s.endH)}, ${n(s.endM)}, ${n(s.breakMin)}, ${q(s.bandName)}, ${q(s.planComment)}, ${q(s.status)}, ${b(s.changedAfterConfirm)})`,
  ).join(",\n") + ";",
);
w();

// 過去の枠（★の元データ）
w("-- ── 過去の枠（★「行ったことがある」の元データ）──────────");
w("-- 🔴 経験は専用テーブルではなく assignments の履歴から引く（data-model.md §4-6）");
w(
  "insert into public.shifts (id, site_id, work_date, jurisdiction_id, work_kind, headcount, start_h, end_h, status) values",
);
w(
  pastSiteIds
    .map((siteId) => {
      const site = SITES.find((s) => s.id === siteId)!;
      return `  ('${uuidOf("pastShift", idNum(siteId))}', '${siteUuid.get(siteId)}', '${PAST_DATE}', '${jurisdictionUuid.get(site.jurisdictionId)}', 'day', 1, 8, 17, 'confirmed')`;
    })
    .join(",\n") + ";",
);
w();

// 稼働
w("-- ── 稼働（配置・非現場・貸出を1テーブルに統合）──────────");
w("-- 🔴 実績（actual_*・overtime_min）は入れない。第1弾では埋まらないのが正（§8-4）");
w("--");
w("-- 🔴 変更検知トリガーを一時的に止める。");
w("--   assignments を1件入れるたびに「確定後に変更あり」が立つため、");
w("--   このまま流すと**確定済みの枠が全部『要 再引き渡し』になる**。");
w("--   投入は変更ではないので、ここでは走らせない。");
w("--   （enable し忘れると当日変更を検知できなくなるので、直後に必ず戻す）");
w("alter table public.assignments disable trigger assignments_mark_shift_changed_ins_del;");
w("alter table public.assignments disable trigger assignments_mark_shift_changed_upd;");
w();
w(
  "insert into public.assignments (id, guard_id, work_date, kind, shift_id, planned_start_at, planned_end_at, planned_break_min, role, position, lent_to_company_id, external_site_name, off_kind, status) values",
);
w(
  assignments
    .map((a) => {
      const sh = a.shiftId ? shiftById.get(a.shiftId)! : null;
      const iv = sh ? shiftInterval(sh) : null;
      return (
        `  ('${uuidOf("assignment", idNum(a.id))}', '${guardUuid.get(a.guardId)}', '${a.workDate}', ${q(a.kind)}, ` +
        `${a.shiftId ? `'${shiftUuid.get(a.shiftId)}'` : "null"}, ` +
        `${iv ? iv.startSql : "null"}, ${iv ? iv.endSql : "null"}, ${sh ? n(sh.breakMin) : "null"}, ` +
        `${q(a.role)}, ${n(a.position)}, ` +
        `${a.lentToCompanyId ? `'${companyUuid.get(a.lentToCompanyId)}'` : "null"}, ${q(a.externalSiteName)}, ` +
        `${q(a.offKind)}, ${q(a.status)})`
      );
    })
    .join(",\n") + ";",
);
w();

// 過去の稼働
w("-- ── 過去の稼働（★の元データ）────────────────────────");
w("-- 予定時刻は入れない。架空の過去に時刻を捏造しても意味が無く、");
w("-- 時刻が無い行は重なり判定の対象外（assignments_no_overlap の where 句）");
w("--");
w("-- 🔴 予定時刻の自動補完も外す（20260903000000_assignment_planned_times.sql）。");
w("--   このトリガーは kind='site' の行に枠の時刻を必ず埋める。埋まると");
w("--   **同じ日に複数現場へ行った履歴が EXCLUDE 制約に触れて seed が落ちる**。");
w("--   履歴は「行ったことがある」を示すためだけの行であり、時刻は使わない。");
w("alter table public.assignments disable trigger assignments_fill_planned_times_trg;");
w(
  "insert into public.assignments (id, guard_id, work_date, kind, shift_id, role, position, status) values",
);
w(
  experiencePairs
    .map(
      (p, i) =>
        `  ('${uuidOf("pastAssignment", i + 1)}', '${guardUuid.get(p.guardId)}', '${PAST_DATE}', 'site', '${uuidOf("pastShift", idNum(p.siteId))}', 'member', 0, 'planned')`,
    )
    .join(",\n") + ";",
);
w();
w("-- 🔴 外したトリガーを戻す。ここから先は編集＝変更として扱われる");
w("alter table public.assignments enable trigger assignments_fill_planned_times_trg;");
w("alter table public.assignments enable trigger assignments_mark_shift_changed_ins_del;");
w("alter table public.assignments enable trigger assignments_mark_shift_changed_upd;");
w();

// NG
w("-- ── NG リスト ─────────────────────────────────────");
w("-- 🔴 実データが存在しない（誰も仕様を持っていない・§8-3）。器の確認用");
w(
  "insert into public.ng_entries (id, kind, guard_id, site_id, counterpart_guard_id, reason_kind, reason, severity) values",
);
w(
  NG_ENTRIES.map((ng, i) => {
    const isSite = Boolean(ng.siteId);
    const reasonKind = isSite
      ? ng.reason === "監督NG"
        ? "supervisor_ng"
        : "other"
      : "conflict";
    return (
      `  ('${uuidOf("ng", i + 1)}', ${q(isSite ? "site_guard" : "guard_guard")}, '${guardUuid.get(ng.guardId)}', ` +
      `${ng.siteId ? `'${siteUuid.get(ng.siteId)}'` : "null"}, ` +
      `${ng.counterpartGuardId ? `'${guardUuid.get(ng.counterpartGuardId)}'` : "null"}, ` +
      `${q(reasonKind)}, ${q(ng.reason)}, 'warn')`
    );
  }).join(",\n") + ";",
);
w();

w("commit;");
w();
w("-- ── 投入後の確認 ──────────────────────────────────");
w("select 'jurisdictions' as t, count(*) from public.jurisdictions");
w("union all select 'companies', count(*) from public.companies");
w("union all select 'qualifications', count(*) from public.qualifications");
w("union all select 'customers', count(*) from public.customers");
w("union all select 'sites', count(*) from public.sites");
w("union all select 'guards', count(*) from public.guards");
w("union all select 'guard_qualifications', count(*) from public.guard_qualifications");
w("union all select 'shifts', count(*) from public.shifts");
w("union all select 'assignments', count(*) from public.assignments");
w("union all select 'ng_entries', count(*) from public.ng_entries");
w("order by 1;");

mkdirSync("supabase/seed", { recursive: true });
writeFileSync("supabase/seed/20260902_dummy_board.sql", out.join("\n") + "\n", "utf8");

console.log(`生成: supabase/seed/20260902_dummy_board.sql`);
console.log(`  管轄 ${JURISDICTIONS.length} / 会社 ${COMPANIES.length} / 資格 ${QUALIFICATIONS.length}`);
console.log(`  得意先 ${CUSTOMERS.length} / 現場 ${SITES.length} / 隊員 ${GUARDS.length}`);
console.log(`  枠 ${SHIFTS.length}（＋過去 ${pastSiteIds.length}）/ 稼働 ${assignments.length}（＋過去 ${experiencePairs.length}）`);
console.log(`  NG ${NG_ENTRIES.length}`);
if (droppedAssignmentIds.size) {
  console.log(
    `  🔴 確定どうしの時間帯が重なるため ${droppedAssignmentIds.size} 件を落とした（枠が1名不足になる）`,
  );
}
console.log(`  基準日: ${BOARD_DATE}`);

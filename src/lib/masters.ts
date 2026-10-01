// マスタ画面（S-10〜）のデータ取得。
//
// 設計は docs/screen-design.md §6。
//
// 🔴 なぜ配置ボード（board.ts）と分けるのか
//   board.ts は「1日 × 1管轄」を1回で組み立てる専用の取得で、
//   マスタ一覧の「全件から検索してページ送り」とは形が違う。
//   1つの関数に押し込むと、どちらの都合で書かれた分岐か読めなくなる（設計原則3）。
//
// 🔴 実データの件数を前提にする。
//   現場 1,593 / 隊員 254+協力会社 / 得意先 603（CLAUDE.md）。
//   ダミーは42件・104名だが、**全件を画面へ送る作りにしない**。
//   検索とページ送りは最初からサーバ側で行う
//   （配置ボードの現場候補は全件送りのままで、実データ移行時の宿題として残っている）。
import "server-only";
import { createClient } from "@/lib/supabase/server";

/** 1ページの件数。密度優先（共通デザインルール）で多めに出す。 */
export const PAGE_SIZE = 50;

/**
 * 🔴 検索語を PostgREST のフィルタ構文から守る。
 *
 *   `.or("name.ilike.%foo%,...")` は**文字列で組み立てる DSL** で、
 *   利用者が `,` `(` `)` を入れると条件の区切りとして解釈され、
 *   意図しない絞り込み（＝別の行が見える）に化ける余地がある。
 *   ワイルドカードの `%` `*` も、入れられると全件一致になり検索の意味が消える。
 *   → **これらは検索語として落とす。** 現場名・氏名の検索で使う文字ではない。
 */
function safeSearchTerm(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/[,()%*\\]/g, "").slice(0, 60);
}

/** ページ番号を 1 以上の整数に正す（URL は手で書き換えられる）。 */
function safePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export type MasterQuery = { q: string; page: number };

/** searchParams から検索条件を取り出す。全マスタ共通。 */
export function parseMasterQuery(sp: { q?: string; page?: string }): MasterQuery {
  return { q: safeSearchTerm(sp.q), page: safePage(sp.page) };
}

/** 一覧の共通の戻り値。件数はページャの表示に要る。 */
export type MasterList<T> = {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
};

function toList<T>(rows: T[], total: number, page: number): MasterList<T> {
  return {
    rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

function rangeFor(page: number): [number, number] {
  const from = (page - 1) * PAGE_SIZE;
  return [from, from + PAGE_SIZE - 1];
}

// ─────────────────────────────────────────────────────────
// 現場（S-10）
// ─────────────────────────────────────────────────────────

export type SiteRow = {
  id: string;
  site_code: string;
  guard_target_no: string;
  name: string;
  short_name: string;
  status: string;
  plan_start_h: number | null;
  plan_start_m: number | null;
  plan_end_h: number | null;
  plan_end_m: number | null;
  plan_break: number | null;
  name_kana: string | null;
  address: string | null;
  band_name: string | null;
  billing_no: string | null;
  customer: { name: string } | null;
  jurisdiction: { name: string } | null;
  department: { name: string } | null;
};

export async function listSites({ q, page }: MasterQuery): Promise<MasterList<SiteRow>> {
  const supabase = await createClient();
  const [from, to] = rangeFor(page);

  // 🔴 部署は外部キー名を指定して繋ぐ（2026-10-01）。
  //   9/24 の整合性の修正で sites → departments の外部キーが2本になり
  //   （department_id 単独／department_id + jurisdiction_id の複合）、
  //   名前を書かないと PostgREST がどちらか決められず一覧ごと落ちる。隊員も同じ。
  let query = supabase
    .from("sites")
    .select(
      `id, site_code, guard_target_no, name, short_name, status,
       plan_start_h, plan_start_m, plan_end_h, plan_end_m, plan_break,
       name_kana, address, band_name, billing_no,
       customer:customers ( name ),
       jurisdiction:jurisdictions ( name ),
       department:departments!sites_department_id_fkey ( name )`,
      { count: "exact" },
    )
    .order("name")
    .range(from, to);

  // 🔴 検索対象は「管制が手元の紙に持っている値」に合わせる。
  //   現場名・略称のほか、**警備先番号**（べんり君の入力キー）で引けることが要る。
  if (q) {
    query = query.or(
      `name.ilike.%${q}%,short_name.ilike.%${q}%,name_kana.ilike.%${q}%,guard_target_no.ilike.%${q}%,site_code.ilike.%${q}%,address.ilike.%${q}%`,
    );
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`現場マスタの取得に失敗しました: ${error.message}`);

  return toList((data ?? []) as unknown as SiteRow[], count ?? 0, page);
}

// ─────────────────────────────────────────────────────────
// 隊員（S-11）
// ─────────────────────────────────────────────────────────

export type GuardRow = {
  id: string;
  staff_code: string | null;
  name: string;
  short_name: string;
  guard_no: string | null;
  name_kana: string | null;
  email: string | null;
  employment_type: string;
  status: string;
  company: { name: string; kind: string } | null;
  jurisdiction: { name: string } | null;
  department: { name: string } | null;
  guard_qualifications: {
    expires_on: string | null;
    qualification: { short_label: string; name: string } | null;
  }[];
};

export async function listGuards({ q, page }: MasterQuery): Promise<MasterList<GuardRow>> {
  const supabase = await createClient();
  const [from, to] = rangeFor(page);

  let query = supabase
    .from("guards")
    .select(
      `id, staff_code, guard_no, name, short_name, name_kana, email, employment_type, status,
       company:companies ( name, kind ),
       jurisdiction:jurisdictions ( name ),
       department:departments!guards_department_id_fkey ( name ),
       guard_qualifications ( expires_on, qualification:qualifications ( short_label, name ) )`,
      { count: "exact" },
    )
    .order("name")
    .range(from, to);

  if (q) {
    query = query.or(
      `name.ilike.%${q}%,short_name.ilike.%${q}%,name_kana.ilike.%${q}%,staff_code.ilike.%${q}%,guard_no.ilike.%${q}%`,
    );
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`隊員マスタの取得に失敗しました: ${error.message}`);

  return toList((data ?? []) as unknown as GuardRow[], count ?? 0, page);
}

// ─────────────────────────────────────────────────────────
// 得意先（S-12）
// ─────────────────────────────────────────────────────────

export type CustomerRow = {
  id: string;
  staff_code: string;
  name: string;
  name_kana: string | null;
  /** 担当名。得意先は「顧客名」より担当で呼ばれることがある */
  contact_name: string | null;
  billing_no: string | null;
  billing_name: string | null;
  jurisdiction: { name: string } | null;
  /** 🔴 customers に status 列は無い（2026-09-08 にマイグレーションで確認）。
   *   有効・無効の区別はこのマスタでは持っていない。 */
  /** 現場数。得意先の規模がひと目で分かる（「1社で20件超」＝管制の実感） */
  site_count: { count: number }[];
};

export async function listCustomers({ q, page }: MasterQuery): Promise<MasterList<CustomerRow>> {
  const supabase = await createClient();
  const [from, to] = rangeFor(page);

  let query = supabase
    .from("customers")
    .select(`id, staff_code, name, name_kana, contact_name, billing_no, billing_name,
       jurisdiction:jurisdictions ( name ),
       site_count:sites ( count )`, {
      count: "exact",
    })
    .order("name")
    .range(from, to);

  if (q) {
    query = query.or(`name.ilike.%${q}%,name_kana.ilike.%${q}%,staff_code.ilike.%${q}%`);
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`得意先マスタの取得に失敗しました: ${error.message}`);

  return toList((data ?? []) as unknown as CustomerRow[], count ?? 0, page);
}

// ─────────────────────────────────────────────────────────
// NG（S-13）
//
// 🔴 なぜ画面が要るのか
//   NG は「誰も仕様を持っておらず、運用開始後に貯める前提」で器だけ作った
//   （screen-design.md §10-3 / ng_entries の comment）。
//   **貯める入口が無ければ、その前提はいつまでも成立しない。**
//
// 🔴 埋め込み結合を使わない理由
//   ng_entries は guards を **2本の外部キー**で参照している
//   （guard_id と counterpart_guard_id）。
//   PostgREST の埋め込みはどちらを指すか曖昧になり、
//   解消するには**制約名を書く**ことになる。制約名は SQL に書いていない
//   （インライン references の自動命名）ため、**推測で書くことになる**。
//   → 素直に2段で取り、JS 側で名前を当てる。読む人が確かめられる形を選ぶ。
// ─────────────────────────────────────────────────────────

export type NgKind = "site_guard" | "guard_guard";
export type NgSeverity = "block" | "warn";
export type NgReasonKind = "supervisor_ng" | "conflict" | "other";

export const ngReasonLabel: Record<NgReasonKind, string> = {
  supervisor_ng: "監督NG",
  conflict: "不仲",
  other: "その他",
};

export type NgRow = {
  id: string;
  kind: NgKind;
  reason_kind: NgReasonKind;
  reason: string;
  severity: NgSeverity;
  created_at: string;
  guardName: string;
  /** kind = 'site_guard' のとき */
  siteName: string | null;
  /** kind = 'guard_guard' のとき */
  counterpartName: string | null;
};

export async function listNgEntries({ q, page }: MasterQuery): Promise<MasterList<NgRow>> {
  const supabase = await createClient();
  const [from, to] = rangeFor(page);

  // 1段目：NG の行そのもの
  let base = supabase
    .from("ng_entries")
    .select("id, kind, guard_id, site_id, counterpart_guard_id, reason_kind, reason, severity, created_at", {
      count: "exact",
    })
    // 🔴 新しい順。NG は「さっき起きたこと」を入れる場所で、
    //   入れた直後に一番上で見えないと、入ったのかどうか分からない。
    .order("created_at", { ascending: false })
    .range(from, to);

  // 🟠 検索できるのは**理由の本文だけ**。
  //   氏名・現場名で引くには結合した先を条件にする必要があり、
  //   PostgREST では親テーブル側の絞り込みに使えない（ビューを作る話になる）。
  //   NG は当面おそらく数十件で、理由で引ければ足りると判断した。
  //   件数が増えて足りなくなったらビューを足す。
  if (q) base = base.ilike("reason", `%${q}%`);

  const { data, count, error } = await base;
  if (error) throw new Error(`NG リストの取得に失敗しました: ${error.message}`);

  type Raw = {
    id: string;
    kind: NgKind;
    guard_id: string;
    site_id: string | null;
    counterpart_guard_id: string | null;
    reason_kind: NgReasonKind;
    reason: string;
    severity: NgSeverity;
    created_at: string;
  };
  const raw = (data ?? []) as Raw[];

  // 2段目：出てきた id ぶんだけ名前を引く
  const guardIds = [
    ...new Set(raw.flatMap((r) => [r.guard_id, r.counterpart_guard_id].filter(Boolean) as string[])),
  ];
  const siteIds = [...new Set(raw.map((r) => r.site_id).filter(Boolean) as string[])];

  const [guardsRes, sitesRes] = await Promise.all([
    guardIds.length
      ? supabase.from("guards").select("id, name").in("id", guardIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? supabase.from("sites").select("id, name").in("id", siteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const guardName = new Map(
    ((guardsRes.data ?? []) as { id: string; name: string }[]).map((g) => [g.id, g.name]),
  );
  const siteName = new Map(
    ((sitesRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
  );

  const rows: NgRow[] = raw.map((r) => ({
    id: r.id,
    kind: r.kind,
    reason_kind: r.reason_kind,
    reason: r.reason,
    severity: r.severity,
    created_at: r.created_at,
    // 🔴 名前が引けない＝隊員が消えた場合。空欄にせず「（不明）」と出す。
    //   空欄だと「まだ読み込み中なのか、データが壊れているのか」が分からない。
    guardName: guardName.get(r.guard_id) ?? "（不明）",
    siteName: r.site_id ? (siteName.get(r.site_id) ?? "（不明）") : null,
    counterpartName: r.counterpart_guard_id
      ? (guardName.get(r.counterpart_guard_id) ?? "（不明）")
      : null,
  }));

  return toList(rows, count ?? 0, page);
}

/** NG 登録の選択肢。
 *  🟠 実データでは現場 1,593 件。全件を画面へ送るのは配置ボードと同じ宿題
 *     （board.ts に注記済み）。ここも実データ移行時に検索へ寄せる。 */
export async function listNgPicks() {
  const supabase = await createClient();
  const [guardsRes, sitesRes] = await Promise.all([
    supabase.from("guards").select("id, name").eq("status", "active").order("name"),
    supabase.from("sites").select("id, name, guard_target_no").eq("status", "active").order("name"),
  ]);
  if (guardsRes.error) throw new Error(`隊員の取得に失敗しました: ${guardsRes.error.message}`);
  if (sitesRes.error) throw new Error(`現場の取得に失敗しました: ${sitesRes.error.message}`);

  return {
    guards: (guardsRes.data ?? []) as { id: string; name: string }[],
    sites: (sitesRes.data ?? []) as { id: string; name: string; guard_target_no: string }[],
  };
}

// ─────────────────────────────────────────────────────────
// 現場の詳細（S-10 編集）
// ─────────────────────────────────────────────────────────

export type SiteDetail = {
  id: string;
  site_code: string;
  guard_target_no: string;
  name: string;
  short_name: string;
  name_kana: string | null;
  address: string | null;
  band_name: string | null;
  billing_no: string | null;
  // 🔴 ShiftMax 勤務マスターの O列・P列（2026-09-09 に追加）。
  //   得意先マスターには無く、勤務マスターにしか無い列。担当コードとは別物。
  customer_code: string | null;
  customer_no: string | null;
  plan_start_h: number | null;
  plan_start_m: number | null;
  plan_end_h: number | null;
  plan_end_m: number | null;
  plan_break: number | null;
  has_plan: boolean;
  customer_id: string | null;
  jurisdiction_id: string;
  department_id: string | null;
  status: string;
};

export async function getSite(id: string): Promise<SiteDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select(
      `id, site_code, guard_target_no, name, short_name, name_kana, address, band_name,
       billing_no, customer_code, customer_no,
       plan_start_h, plan_start_m, plan_end_h, plan_end_m, plan_break, has_plan,
       customer_id, jurisdiction_id, department_id, status`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`現場の取得に失敗しました: ${error.message}`);
  return (data as SiteDetail | null) ?? null;
}

/** 編集フォームの選択肢。得意先・管轄・部署 */
export async function getSiteFormOptions() {
  const supabase = await createClient();
  const [cus, jur, dep] = await Promise.all([
    supabase.from("customers").select("id, name").order("name"),
    supabase.from("jurisdictions").select("id, name").order("code"),
    supabase.from("departments").select("id, name, jurisdiction_id").order("code"),
  ]);
  for (const r of [cus, jur, dep]) if (r.error) throw new Error(r.error.message);
  return {
    customers: (cus.data ?? []) as { id: string; name: string }[],
    jurisdictions: (jur.data ?? []) as { id: string; name: string }[],
    departments: (dep.data ?? []) as { id: string; name: string; jurisdiction_id: string }[],
  };
}

/**
 * 現場を消すと何が一緒に消えるか／何が邪魔をするかを数える。
 *
 * 🔴 消える前に見せる。9/7 に枠の削除で決めたのと同じ考え方
 *   （「消えたことに後で気づく作りにしない」）。
 *
 * 🔴 shifts は **cascade ではない**（20260902000000_board_core.sql）。
 *   枠が1件でもあると DB が削除を拒む（FK 違反）。これは安全側の仕様なので
 *   アプリ側でも先に数え、**なぜ消せないか**を日本語で言う。
 *   一方 site_required_qualifications と ng_entries は cascade で**黙って消える**。
 */
/** 🔴 数えられなかったときに 0 を返さない。区別できないと削除の判断を誤る。 */
export type SiteRefs =
  | { ok: true; shifts: number; requiredQualifications: number; ngEntries: number }
  | { ok: false };

export async function countSiteRefs(siteId: string): Promise<SiteRefs> {
  const supabase = await createClient();
  const [shifts, quals, ngs] = await Promise.all([
    supabase.from("shifts").select("id", { count: "exact", head: true }).eq("site_id", siteId),
    supabase
      .from("site_required_qualifications")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId),
    supabase.from("ng_entries").select("id", { count: "exact", head: true }).eq("site_id", siteId),
  ]);
  // 🔴 エラーを握りつぶさない。count は失敗時も null になるため、`?? 0` と書くと
  //   「本当に0件」と区別がつかない。削除の確認帯は**この数字を根拠に押させる**ので、
  //   嘘の 0 は出しうる中で最悪の値になる（一緒に消えるものが見えないまま押させる）。
  for (const r of [shifts, quals, ngs]) if (r.error) return { ok: false };
  if (shifts.count === null || quals.count === null || ngs.count === null) {
    return { ok: false };
  }
  return {
    ok: true,
    shifts: shifts.count,
    requiredQualifications: quals.count,
    ngEntries: ngs.count,
  };
}

// ─────────────────────────────────────────────────────────
// 隊員の詳細（S-11 編集）2026-09-09
//
// 🔴 現場（S-10）と同じ形に揃える。1名体制では「画面ごとに作法が違う」ことが
//   そのまま保守コストになる。詳細＝ getX / getXFormOptions / countXRefs の3本。
// ─────────────────────────────────────────────────────────

export type GuardDetail = {
  id: string;
  staff_code: string | null;
  guard_no: string | null;
  name: string;
  short_name: string;
  name_kana: string | null;
  email: string | null;
  /** 🔴 最寄り駅（2026-09-16）。ShiftMax には無い列なので取込では埋まらない */
  nearest_station: string | null;
  jurisdiction_id: string;
  department_id: string | null;
  company_id: string;
  employment_type: string;
  status: string;
  note: string | null;
};

/** 隊員が持つ資格。期限は「切れない資格」を表すため null 可（data-model.md §5-2）。 */
export type GuardQualificationRow = {
  id: string;
  qualification_id: string;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  qualification: { short_label: string; name: string; has_expiry: boolean } | null;
};

/** 連絡先。🔴 `reachable` が「LINE が繋がらない約4割」を扱うための列（§4-4）。 */
export type GuardContactRow = {
  id: string;
  kind: string;
  value: string;
  reachable: boolean;
  is_primary: boolean;
};

export async function getGuard(id: string): Promise<GuardDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guards")
    .select(
      `id, staff_code, guard_no, name, short_name, name_kana, email, nearest_station,
       jurisdiction_id, department_id, company_id, employment_type, status, note`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`隊員の取得に失敗しました: ${error.message}`);
  return (data as GuardDetail | null) ?? null;
}

export async function getGuardQualifications(guardId: string): Promise<GuardQualificationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guard_qualifications")
    .select(
      `id, qualification_id, number, issued_on, expires_on,
       qualification:qualifications ( short_label, name, has_expiry )`,
    )
    .eq("guard_id", guardId);
  if (error) throw new Error(`資格の取得に失敗しました: ${error.message}`);
  const rows = (data ?? []) as unknown as GuardQualificationRow[];
  // 表示順は資格マスタの並びに寄せる（付けた順だと画面が毎回変わる）
  return rows.sort((a, b) =>
    (a.qualification?.short_label ?? "").localeCompare(b.qualification?.short_label ?? ""),
  );
}

export async function getGuardContacts(guardId: string): Promise<GuardContactRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guard_contacts")
    .select("id, kind, value, reachable, is_primary")
    .eq("guard_id", guardId)
    .order("is_primary", { ascending: false })
    .order("kind");
  if (error) throw new Error(`連絡先の取得に失敗しました: ${error.message}`);
  return (data ?? []) as GuardContactRow[];
}

/** 編集フォームの選択肢。会社・管轄・部署・資格 */
export async function getGuardFormOptions() {
  const supabase = await createClient();
  const [com, jur, dep, qua] = await Promise.all([
    supabase.from("companies").select("id, name, kind").order("kind").order("name"),
    supabase.from("jurisdictions").select("id, name").order("code"),
    supabase.from("departments").select("id, name, jurisdiction_id").order("code"),
    supabase.from("qualifications").select("id, short_label, name, has_expiry").order("code"),
  ]);
  for (const r of [com, jur, dep, qua]) if (r.error) throw new Error(r.error.message);
  return {
    companies: (com.data ?? []) as { id: string; name: string; kind: string }[],
    jurisdictions: (jur.data ?? []) as { id: string; name: string }[],
    departments: (dep.data ?? []) as { id: string; name: string; jurisdiction_id: string }[],
    qualifications: (qua.data ?? []) as {
      id: string;
      short_label: string;
      name: string;
      has_expiry: boolean;
    }[],
  };
}

/**
 * 隊員を消すと何が一緒に消えるか／何が邪魔をするかを数える。
 *
 * 🔴 assignments は **cascade ではない**（board_core.sql:312）。稼働が1件でもあれば
 *   DB が削除を拒む。過去の配置ごと消えるほうが害が大きいという、現場と同じ判断。
 * 🔴 一方 guard_contacts・guard_qualifications・ng_entries は cascade で**黙って消える**。
 *   NG は counterpart_guard_id 側でも消えるため、**相手方として登録されたNGも数える**。
 */
export type GuardRefs =
  | {
      ok: true;
      assignments: number;
      qualifications: number;
      contacts: number;
      ngEntries: number;
    }
  | { ok: false };

export async function countGuardRefs(guardId: string): Promise<GuardRefs> {
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [asg, qua, con, ngOwn, ngPair] = await Promise.all([
    supabase.from("assignments").select("id", head).eq("guard_id", guardId),
    supabase.from("guard_qualifications").select("id", head).eq("guard_id", guardId),
    supabase.from("guard_contacts").select("id", head).eq("guard_id", guardId),
    supabase.from("ng_entries").select("id", head).eq("guard_id", guardId),
    supabase.from("ng_entries").select("id", head).eq("counterpart_guard_id", guardId),
  ]);
  // 🔴 0件は疑う。count はエラー時にも null になるので `?? 0` と書けない（S-10 と同じ）
  const all = [asg, qua, con, ngOwn, ngPair];
  for (const r of all) if (r.error) return { ok: false };
  if (all.some((r) => r.count === null)) return { ok: false };
  return {
    ok: true,
    assignments: asg.count!,
    qualifications: qua.count!,
    contacts: con.count!,
    ngEntries: ngOwn.count! + ngPair.count!,
  };
}

// ─────────────────────────────────────────────────────────
// 得意先の詳細（S-12 編集）2026-09-09
//
// 🔴 customers に status 列は無い（2026-09-08 に確認）。
//   「使っていない得意先」を止める手段がマスタ側に無いということなので、
//   状態の選択肢は**出さない**。無い列を画面に描くと、押しても効かない欄になる。
// ─────────────────────────────────────────────────────────

export type CustomerDetail = {
  id: string;
  staff_code: string;
  name: string;
  name_kana: string | null;
  contact_name: string | null;
  billing_no: string | null;
  billing_name: string | null;
  jurisdiction_id: string | null;
  department_id: string | null;
};

export async function getCustomer(id: string): Promise<CustomerDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(
      `id, staff_code, name, name_kana, contact_name, billing_no, billing_name,
       jurisdiction_id, department_id`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`得意先の取得に失敗しました: ${error.message}`);
  return (data as CustomerDetail | null) ?? null;
}

/** 編集フォームの選択肢。管轄・部署（得意先は会社・資格を持たない） */
export async function getCustomerFormOptions() {
  const supabase = await createClient();
  const [jur, dep] = await Promise.all([
    supabase.from("jurisdictions").select("id, name").order("code"),
    supabase.from("departments").select("id, name, jurisdiction_id").order("code"),
  ]);
  for (const r of [jur, dep]) if (r.error) throw new Error(r.error.message);
  return {
    jurisdictions: (jur.data ?? []) as { id: string; name: string }[],
    departments: (dep.data ?? []) as { id: string; name: string; jurisdiction_id: string }[],
  };
}

/**
 * 得意先を消すと何が邪魔をするかを数える。
 *
 * 🔴 customers を参照しているのは sites だけ（board_core.sql:178・cascade 無し）。
 *   現場が1件でもあれば DB が拒む。**現場が消えるより拒まれるほうが安全**。
 */
export type CustomerRefs = { ok: true; sites: number } | { ok: false };

export async function countCustomerRefs(customerId: string): Promise<CustomerRefs> {
  const supabase = await createClient();
  const r = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  // 🔴 0件は疑う（S-10・S-11 と同じ）。count はエラー時も null になる
  if (r.error || r.count === null) return { ok: false };
  return { ok: true, sites: r.count };
}

// ─────────────────────────────────────────────────────────
// 現場に紐づくもの（S-10 詳細に載せる）2026-09-09
//
// 🔴 なぜ載せるのか（柴山・2026-09-09）
//   「現場情報に日付が入ってなくてどうやって日々の配置管理を行うのか」。
//   日付は現場マスタではなく配置枠（shifts）が持っているが、
//   **現場を開いても枠が1件も見えない**のでは、その説明が画面から読み取れない。
//   「それぞれの枠から確認や編集ができないと使えたもんじゃない」も同じ話。
// ─────────────────────────────────────────────────────────

/** 現場の配置枠。A表は「日付 × 現場」の表なので、現場から日付が引けないと辿れない */
export type SiteShiftRow = {
  id: string;
  work_date: string;
  work_kind: string;
  headcount: number;
  start_h: number;
  start_m: number;
  end_h: number;
  end_m: number;
  break_min: number;
  band_name: string | null;
  plan_comment: string | null;
  billing_note: string | null;
  status: string;
  /** 実際に配置済みの人数（枠の充足を見るのに要る） */
  placed: number;
};

/**
 * 現場の配置枠を**日付順（古い→新しい）**に返す。
 *
 * 🔴 全件は返さない。現場によっては毎日枠が立つため、実データでは数百件になる。
 *   ここは「この現場がどう回っているか」を見る場所なので、直近だけでよい。
 *
 * 🔴 取るのは新しい順、**並べるのは日付順**（2026-09-09・柴山の指摘）。
 *   取得も日付順にすると limit が**いちばん古い30件**を拾ってしまい、
 *   これから先の枠が1件も出なくなる。取得と表示で向きを分けるのはこのため。
 */
export async function getSiteShifts(siteId: string, limit = 30): Promise<SiteShiftRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shifts")
    .select(
      `id, work_date, work_kind, headcount, start_h, start_m, end_h, end_m, break_min,
       band_name, plan_comment, billing_note, status,
       assignments ( id )`,
    )
    .eq("site_id", siteId)
    .order("work_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`配置枠の取得に失敗しました: ${error.message}`);

  type Raw = Omit<SiteShiftRow, "placed"> & { assignments: { id: string }[] };
  return ((data ?? []) as unknown as Raw[])
    .map(({ assignments, ...rest }) => ({ ...rest, placed: assignments.length }))
    // work_date は "YYYY-MM-DD" なので文字列比較で日付順になる
    .sort((a, b) => a.work_date.localeCompare(b.work_date));
}

/** 現場が求める資格。配置ボードの警告はここを見ている */
export type SiteQualificationRow = {
  id: string;
  qualification_id: string;
  required_count: number;
  qualification: { short_label: string; name: string } | null;
};

export async function getSiteRequiredQualifications(
  siteId: string,
): Promise<SiteQualificationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_required_qualifications")
    .select(`id, qualification_id, required_count, qualification:qualifications ( short_label, name )`)
    .eq("site_id", siteId);
  if (error) throw new Error(`必要資格の取得に失敗しました: ${error.message}`);
  const rows = (data ?? []) as unknown as SiteQualificationRow[];
  return rows.sort((a, b) =>
    (a.qualification?.short_label ?? "").localeCompare(b.qualification?.short_label ?? ""),
  );
}

/** この現場に入れない隊員（NG）。一覧画面まで行かずにここで分かるようにする */
export type SiteNgRow = {
  id: string;
  guard_id: string;
  guardName: string;
  reason_kind: string;
  reason: string;
  severity: string;
};

export async function getSiteNgEntries(siteId: string): Promise<SiteNgRow[]> {
  const supabase = await createClient();
  // 🔴 埋め込み結合を使わない。ng_entries は guards を2本の外部キーで参照しており、
  //   曖昧さを解くには制約名を推測して書くことになる（2026-09-08 の NG 一覧と同じ判断）。
  const { data, error } = await supabase
    .from("ng_entries")
    .select("id, guard_id, reason_kind, reason, severity")
    .eq("kind", "site_guard")
    .eq("site_id", siteId);
  if (error) throw new Error(`NG の取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as Omit<SiteNgRow, "guardName">[];
  if (rows.length === 0) return [];

  const { data: gs, error: gErr } = await supabase
    .from("guards")
    .select("id, name")
    .in("id", rows.map((r) => r.guard_id));
  if (gErr) throw new Error(`隊員名の取得に失敗しました: ${gErr.message}`);
  const nameOf = new Map((gs ?? []).map((g) => [g.id as string, g.name as string]));

  return rows.map((r) => ({ ...r, guardName: nameOf.get(r.guard_id) ?? "（不明）" }));
}

// ─────────────────────────────────────────────────────────
// 隊員・得意先に紐づくもの（2026-09-09）
//
// 🔴 「情報をそれぞれの枠から確認や編集ができないと使えたもんじゃない」（柴山）。
//   隊員を開いて**いつどこに行ったか**が見えない、得意先を開いて**どの現場を持つか**が
//   見えないのでは、台帳として使えない。
// ─────────────────────────────────────────────────────────

export type GuardAssignmentRow = {
  id: string;
  work_date: string;
  kind: string;
  role: string;
  is_long_distance: boolean;
  off_kind: string | null;
  external_site_name: string | null;
  status: string;
  /** kind='site' のときの現場名 */
  siteName: string | null;
  workKind: string | null;
};

export async function getGuardAssignments(
  guardId: string,
  limit = 30,
): Promise<GuardAssignmentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assignments")
    .select(
      `id, work_date, kind, role, is_long_distance, off_kind, external_site_name, status,
       shift:shifts ( work_kind, site:sites ( name ) )`,
    )
    .eq("guard_id", guardId)
    .order("work_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`稼働の取得に失敗しました: ${error.message}`);

  type Raw = Omit<GuardAssignmentRow, "siteName" | "workKind"> & {
    shift: { work_kind: string; site: { name: string } | null } | null;
  };
  // 🔴 取得は新しい順・表示は日付順（配置枠と揃える）
  return ((data ?? []) as unknown as Raw[])
    .map(({ shift, ...rest }) => ({
      ...rest,
      siteName: shift?.site?.name ?? null,
      workKind: shift?.work_kind ?? null,
    }))
    .sort((a, b) => a.work_date.localeCompare(b.work_date));
}

export type CustomerSiteRow = {
  id: string;
  site_code: string;
  guard_target_no: string;
  name: string;
  short_name: string;
  status: string;
  band_name: string | null;
  plan_start_h: number | null;
  plan_start_m: number | null;
  plan_end_h: number | null;
  plan_end_m: number | null;
};

export async function getCustomerSites(
  customerId: string,
  limit = 100,
): Promise<CustomerSiteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select(
      `id, site_code, guard_target_no, name, short_name, status, band_name,
       plan_start_h, plan_start_m, plan_end_h, plan_end_m`,
    )
    .eq("customer_id", customerId)
    .order("name")
    .limit(limit);
  if (error) throw new Error(`現場の取得に失敗しました: ${error.message}`);
  return (data ?? []) as CustomerSiteRow[];
}

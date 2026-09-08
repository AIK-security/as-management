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

  let query = supabase
    .from("sites")
    .select(
      `id, site_code, guard_target_no, name, short_name, status,
       plan_start_h, plan_start_m, plan_end_h, plan_end_m, plan_break,
       name_kana, address, band_name, billing_no,
       customer:customers ( name ),
       jurisdiction:jurisdictions ( name ),
       department:departments ( name )`,
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
       department:departments ( name ),
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
       billing_no, plan_start_h, plan_start_m, plan_end_h, plan_end_m, plan_break, has_plan,
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
export async function countSiteRefs(siteId: string) {
  const supabase = await createClient();
  const [shifts, quals, ngs] = await Promise.all([
    supabase.from("shifts").select("id", { count: "exact", head: true }).eq("site_id", siteId),
    supabase
      .from("site_required_qualifications")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId),
    supabase.from("ng_entries").select("id", { count: "exact", head: true }).eq("site_id", siteId),
  ]);
  return {
    shifts: shifts.count ?? 0,
    requiredQualifications: quals.count ?? 0,
    ngEntries: ngs.count ?? 0,
  };
}

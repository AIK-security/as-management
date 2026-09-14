// ShiftMax マスタの取込（書き込み側）。2026-09-14 追加。
//
// 🔴 方針（2026-09-14 決定）：**新規は作る。既存は ShiftMax 由来の列だけ更新する。**
//   新システムが独自に持っているもの ─ 連絡先・資格・NG・協力会社の隊員・
//   隊員の所属会社 ─ は**一切触らない**。
//   ShiftMax が正である間は、何度でも取り直せる状態を保つのが狙い。
//
// 🔴 認可は3枚重ねの2枚目。Server Action は URL なので、ここでも必ず見る。
"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  CustomerImportRow,
  GuardImportRow,
  MasterKind,
  SiteImportRow,
} from "@/lib/master-import";

export type ImportResult =
  | {
      ok: true;
      kind: MasterKind;
      created: number;
      updated: number;
      /** 得意先が見つからず、紐付けを見送った現場の件数（現場の取込のみ） */
      unresolvedCustomers: number;
      /** 新しく作った管轄・部署 */
      newJurisdictions: string[];
      newDepartments: string[];
    }
  | { ok: false; message: string };

type Supa = Awaited<ReturnType<typeof createClient>>;

function toMessage(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "この操作の権限がありません。";
  if (error.code === "23505") return `同じコードの行が重複しています（${error.message}）`;
  return `取り込めませんでした（${error.message}）`;
}

/** 1回の書き込みで送る行数。1,593 行を4回に割る程度。 */
const CHUNK = 500;

function chunk<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * コード → id の対応表を作る。
 *
 * 🔴 **必ず範囲を送って全件取る。** PostgREST は既定で 1,000 行しか返さないため、
 *   素直に `select()` すると勤務マスター1,593件のうち**後ろが黙って落ちる**
 *   ＝ 既存の現場が「新規」と判定され、コードの重複で取込が丸ごと失敗する。
 */
async function codeToId(supabase: Supa, table: string, col: string) {
  const map = new Map<string, string>();
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from(table)
      .select(`id, ${col}`)
      .range(from, from + size - 1);
    if (error) return { ok: false as const, message: toMessage(error) };
    // 🔴 列名を変数で渡すため、supabase-js の型パーサが select 文字列を読めない。
    //   ここだけ unknown 経由で受ける（返る形は id と code の2列で確定している）
    for (const r of (data ?? []) as unknown as Record<string, string>[]) {
      if (r[col]) map.set(r[col], r.id);
    }
    if ((data?.length ?? 0) < size) break;
  }
  return { ok: true as const, map };
}

/**
 * 管轄・部署を、CSV に出てきたぶんだけ用意する。
 *
 * 🔴 自動で作る。CSV が**コードと名前の両方**を持っているため、
 *   先に人が登録しておかないと取り込めない作りにする理由が無い。
 */
async function ensureOrgs(
  supabase: Supa,
  jurisdictions: Map<string, string | null>,
  departments: Map<string, { name: string | null; jurisdictionCode: string | null }>,
) {
  const newJurisdictions: string[] = [];
  const newDepartments: string[] = [];

  const jm = await codeToId(supabase, "jurisdictions", "code");
  if (!jm.ok) return jm;

  const addJ = [...jurisdictions.entries()].filter(([code]) => !jm.map.has(code));
  if (addJ.length > 0) {
    const { data, error } = await supabase
      .from("jurisdictions")
      .insert(addJ.map(([code, name]) => ({ code, name: name ?? code })))
      .select("id, code");
    if (error) return { ok: false as const, message: toMessage(error) };
    for (const r of (data ?? []) as { id: string; code: string }[]) {
      jm.map.set(r.code, r.id);
      newJurisdictions.push(r.code);
    }
  }

  const dm = await codeToId(supabase, "departments", "code");
  if (!dm.ok) return dm;

  const addD = [...departments.entries()].filter(([code]) => !dm.map.has(code));
  const rows: { code: string; name: string; jurisdiction_id: string }[] = [];
  for (const [code, info] of addD) {
    // 🔴 部署は管轄にぶら下がる（`departments.jurisdiction_id` は NOT NULL）。
    //   管轄が分からない部署は**作らない**。その隊員・現場は部署なしで取り込む。
    const jid = info.jurisdictionCode ? jm.map.get(info.jurisdictionCode) : undefined;
    if (!jid) continue;
    rows.push({ code, name: info.name ?? code, jurisdiction_id: jid });
  }
  if (rows.length > 0) {
    const { data, error } = await supabase.from("departments").insert(rows).select("id, code");
    if (error) return { ok: false as const, message: toMessage(error) };
    for (const r of (data ?? []) as { id: string; code: string }[]) {
      dm.map.set(r.code, r.id);
      newDepartments.push(r.code);
    }
  }

  return {
    ok: true as const,
    jurisdiction: jm.map,
    department: dm.map,
    newJurisdictions,
    newDepartments,
  };
}

/** 取込1件ぶんの入力。画面側で解釈・検証を済ませたものを受け取る。 */
export type ImportInput =
  | { kind: "guards"; rows: GuardImportRow[] }
  | { kind: "sites"; rows: SiteImportRow[] }
  | { kind: "customers"; rows: CustomerImportRow[] };

export async function importMaster(input: ImportInput): Promise<ImportResult> {
  await requireRole("control", "admin");
  if (input.rows.length === 0) return { ok: false, message: "取り込む行がありません。" };

  const supabase = await createClient();

  // ── 管轄・部署を先に揃える ──────────────────────────
  const jset = new Map<string, string | null>();
  const dset = new Map<string, { name: string | null; jurisdictionCode: string | null }>();
  for (const r of input.rows) {
    const jc = r.jurisdiction_code;
    if (jc) jset.set(jc, r.jurisdiction_name);
    if (r.department_code) {
      dset.set(r.department_code, { name: r.department_name, jurisdictionCode: jc ?? null });
    }
  }
  const orgs = await ensureOrgs(supabase, jset, dset);
  if (!orgs.ok) return orgs;

  const jid = (code: string | null) => (code ? (orgs.jurisdiction.get(code) ?? null) : null);
  const did = (code: string | null) => (code ? (orgs.department.get(code) ?? null) : null);

  const base = {
    newJurisdictions: orgs.newJurisdictions,
    newDepartments: orgs.newDepartments,
    unresolvedCustomers: 0,
  };

  // ─────────────────────────────────────────────────────
  // 隊員
  // ─────────────────────────────────────────────────────
  if (input.kind === "guards") {
    const existing = await codeToId(supabase, "guards", "staff_code");
    if (!existing.ok) return existing;

    // 🔴 会社は ShiftMax に無い概念。社員マスターに載る隊員は全員自社。
    //   協力会社の隊員は新システムだけが持つ（`shiftmax-api-analysis.md` §7-1）。
    const { data: own, error: ownErr } = await supabase
      .from("companies")
      .select("id, name")
      .eq("kind", "own")
      .order("created_at", { ascending: true })
      .limit(1);
    if (ownErr) return { ok: false, message: toMessage(ownErr) };
    const ownId = (own ?? [])[0]?.id as string | undefined;
    if (!ownId) {
      return {
        ok: false,
        message: "自社の会社が登録されていません。先に会社マスタに自社を1件作ってください。",
      };
    }

    const missingJ = input.rows.find((r) => !jid(r.jurisdiction_code));
    if (missingJ) {
      return { ok: false, message: `管轄 ${missingJ.jurisdiction_code} を用意できませんでした。` };
    }

    // ShiftMax 由来の列だけを組み立てる（`company_id` はここに入れない）
    const shiftmaxCols = (r: GuardImportRow) => ({
      staff_code: r.staff_code,
      guard_no: r.guard_no,
      name: r.name,
      short_name: r.short_name,
      name_kana: r.name_kana,
      email: r.email,
      jurisdiction_id: jid(r.jurisdiction_code),
      department_id: did(r.department_code),
    });

    const news = input.rows.filter((r) => !existing.map.has(r.staff_code));
    const olds = input.rows.filter((r) => existing.map.has(r.staff_code));

    for (const part of chunk(news)) {
      // 🔴 新規だけ `company_id` を入れる。既存を上書きすると、
      //   手で協力会社に付け替えた隊員が自社へ戻ってしまう
      const { error } = await supabase
        .from("guards")
        .insert(part.map((r) => ({ ...shiftmaxCols(r), company_id: ownId })));
      if (error) return { ok: false, message: toMessage(error) };
    }
    for (const part of chunk(olds)) {
      const { error } = await supabase
        .from("guards")
        .upsert(
          part.map((r) => ({ id: existing.map.get(r.staff_code) as string, ...shiftmaxCols(r) })),
          { onConflict: "id" },
        );
      if (error) return { ok: false, message: toMessage(error) };
    }

    refresh();
    return { ok: true, kind: "guards", created: news.length, updated: olds.length, ...base };
  }

  // ─────────────────────────────────────────────────────
  // 得意先
  // ─────────────────────────────────────────────────────
  if (input.kind === "customers") {
    const existing = await codeToId(supabase, "customers", "staff_code");
    if (!existing.ok) return existing;

    const rows = input.rows.map((r) => ({
      staff_code: r.staff_code,
      name: r.name,
      name_kana: r.name_kana,
      contact_name: r.contact_name,
      billing_no: r.billing_no,
      billing_name: r.billing_name,
      jurisdiction_id: jid(r.jurisdiction_code),
      department_id: did(r.department_code),
    }));

    for (const part of chunk(rows)) {
      const { error } = await supabase
        .from("customers")
        .upsert(part, { onConflict: "staff_code" });
      if (error) return { ok: false, message: toMessage(error) };
    }

    const created = input.rows.filter((r) => !existing.map.has(r.staff_code)).length;
    refresh();
    return {
      ok: true,
      kind: "customers",
      created,
      updated: input.rows.length - created,
      ...base,
    };
  }

  // ─────────────────────────────────────────────────────
  // 現場
  // ─────────────────────────────────────────────────────
  const existing = await codeToId(supabase, "sites", "site_code");
  if (!existing.ok) return existing;
  const customers = await codeToId(supabase, "customers", "staff_code");
  if (!customers.ok) return customers;

  const missingJ = input.rows.find((r) => !jid(r.jurisdiction_code));
  if (missingJ) {
    return { ok: false, message: `管轄 ${missingJ.jurisdiction_code} を用意できませんでした。` };
  }

  const common = (r: SiteImportRow) => ({
    site_code: r.site_code,
    guard_target_no: r.guard_target_no,
    name: r.name,
    short_name: r.short_name,
    name_kana: r.name_kana,
    band_name: r.band_name,
    address: r.address,
    plan_start_h: r.plan_start_h,
    plan_start_m: r.plan_start_m,
    plan_end_h: r.plan_end_h,
    plan_end_m: r.plan_end_m,
    plan_break: r.plan_break,
    has_plan: r.has_plan,
    customer_code: r.customer_code,
    customer_no: r.customer_no,
    billing_no: r.billing_no,
    jurisdiction_id: jid(r.jurisdiction_code),
    department_id: did(r.department_code),
  });

  // 🔴 得意先を引けた行と引けなかった行で、送る列を変える。
  //   引けない行にも `customer_id: null` を送ると、**既に紐付いている現場の
  //   得意先が消える**。得意先マスターを先に取り込んでいないときに必ず起きる。
  const linked = input.rows.filter(
    (r) => r.customer_staff_code && customers.map.has(r.customer_staff_code),
  );
  const unlinked = input.rows.filter(
    (r) => !r.customer_staff_code || !customers.map.has(r.customer_staff_code),
  );

  for (const part of chunk(linked)) {
    const { error } = await supabase.from("sites").upsert(
      part.map((r) => ({
        ...common(r),
        customer_id: customers.map.get(r.customer_staff_code as string) as string,
      })),
      { onConflict: "site_code" },
    );
    if (error) return { ok: false, message: toMessage(error) };
  }
  for (const part of chunk(unlinked)) {
    const { error } = await supabase
      .from("sites")
      .upsert(part.map(common), { onConflict: "site_code" });
    if (error) return { ok: false, message: toMessage(error) };
  }

  const created = input.rows.filter((r) => !existing.map.has(r.site_code)).length;
  refresh();
  return {
    ok: true,
    kind: "sites",
    created,
    updated: input.rows.length - created,
    newJurisdictions: orgs.newJurisdictions,
    newDepartments: orgs.newDepartments,
    unresolvedCustomers: unlinked.filter((r) => r.customer_staff_code).length,
  };
}

// ShiftMax マスタ（べんり君のシートから CSV 化したもの）の読み取りと検証。
// 2026-09-14 追加。
//
// 🔴 ここは**解釈と検証だけ**。書き込みは `src/app/masters/import/actions.ts`。
//   画面でプレビューを出すためにクライアント側でも動く必要があるので、
//   サーバ専用のもの（`server-only` / `next/headers` 依存）を一切 import しない。
//   ＝ 9/09 の自戒「tsc と eslint が通ってもビルドは落ちる」への対処。
//
// 🔴 列の定義は `docs/shiftmax-api-analysis.md` §7（2026-09-09 に実測で訂正した版）。
//   社員10列（B〜K）／勤務24列（B〜Y）／得意先10列（B〜K）。
//   **見出しの名前で突き合わせる**（列の位置では見ない）。理由は2つ：
//   ① べんり君のシートは A 列が空のことがあり、CSV 化の仕方で桁がずれる
//   ② ShiftMax 側に表記ゆれがある（得意先 F 列の実際の見出しは `部署名メイ`）

import { parseCsv } from "@/lib/csv";

// 🔴 2026-10-02：勤務マスターは「現場」ではなく〈得意先×区分〉→ 警備先番号の対応表として
//   `duty_codes` へ入れる。現場は実データから起こした一覧（scripts/extract-sites.py）で入れる。
//   （docs/data-gap-20260917.md §2・§7）
export type MasterKind = "guards" | "duties" | "sites" | "customers";

export const KIND_LABEL: Record<MasterKind, string> = {
  guards: "社員マスター（隊員）",
  duties: "勤務マスター（警備先番号）",
  sites: "現場一覧",
  customers: "得意先マスター",
};

/** 取込に必要な最小の列。これが揃っていない CSV は受け取らない。 */
const REQUIRED: Record<MasterKind, string[]> = {
  guards: ["個人コード", "個人名"],
  duties: ["現場コード", "警備先番号", "略称"],
  sites: ["現場", "現場管轄"],
  customers: ["担当コード", "顧客名"],
};

/**
 * 見出しの表記ゆれを吸収する。
 * 🔴 `部署名メイ` は**実測で確認した ShiftMax 側の実際の見出し**であり、誤記ではない。
 */
const HEADER_ALIASES: Record<string, string> = {
  部署名メイ: "部署名",
  社員コード: "個人コード",
  社員名: "個人名",
  隊員名: "個人名",
  現場名: "現場",
  住所: "現場住所",
  メール: "メールアドレス",
  メールアドレス1: "メールアドレス",
};

/** 空白（半角・全角）を落として突き合わせる。 */
function normalizeHeader(raw: string): string {
  const key = raw.replace(/[\s　]/g, "");
  return HEADER_ALIASES[key] ?? key;
}

export type ImportIssue = { row: number; message: string };

export type GuardImportRow = {
  staff_code: string;
  guard_no: string | null;
  name: string;
  short_name: string;
  name_kana: string | null;
  email: string | null;
  jurisdiction_code: string;
  jurisdiction_name: string | null;
  department_code: string | null;
  department_name: string | null;
};

/** 勤務マスターの1行。現場ではなく〈得意先×区分〉に振られた番号。 */
export type DutyImportRow = {
  guard_target_no: string;
  sm_site_code: string;
  kind_label: string;
  customer_staff_code: string | null;
  customer_code: string | null;
  customer_no: string | null;
  billing_no: string | null;
};

/**
 * 現場一覧の1行。🔴 現場コードは持たない（DB が振る）。
 *   既存の現場とは〈現場名 × 得意先〉で突き合わせる。
 */
export type SiteImportRow = {
  name: string;
  short_name: string;
  name_kana: string | null;
  address: string | null;
  plan_start_h: number | null;
  plan_start_m: number | null;
  plan_end_h: number | null;
  plan_end_m: number | null;
  plan_break: number | null;
  has_plan: boolean;
  customer_code: string | null;
  customer_no: string | null;
  /** 得意先の突合キー（`customers.staff_code`）。ここでは id に解決しない。 */
  customer_staff_code: string | null;
  billing_no: string | null;
  jurisdiction_code: string;
  jurisdiction_name: string | null;
  department_code: string | null;
  department_name: string | null;
};

export type CustomerImportRow = {
  staff_code: string;
  name: string;
  name_kana: string | null;
  contact_name: string | null;
  billing_no: string | null;
  billing_name: string | null;
  jurisdiction_code: string | null;
  jurisdiction_name: string | null;
  department_code: string | null;
  department_name: string | null;
};

export type ImportRows =
  | { kind: "guards"; rows: GuardImportRow[] }
  | { kind: "duties"; rows: DutyImportRow[] }
  | { kind: "sites"; rows: SiteImportRow[] }
  | { kind: "customers"; rows: CustomerImportRow[] };

export type ParseResult =
  | ({
      ok: true;
      /** 取り込める行。エラー行は含まない */
      errors: ImportIssue[];
      /** 取り込むが、目で見て確かめてほしい行 */
      warnings: ImportIssue[];
      /** CSV のデータ行数（エラー行も含む） */
      total: number;
    } & ImportRows)
  | { ok: false; message: string };

/** 1ファイルで受け取る上限。勤務マスターが 1,593 行なので、その倍を上限にする。 */
export const IMPORT_MAX_ROWS = 5000;

// ─────────────────────────────────────────────────────────
// 値の読み取り
// ─────────────────────────────────────────────────────────

function orNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * 数値を読む。空欄は null。
 * 数字として読めない値は **null にせず undefined を返す**（＝呼び出し側でエラーにする）。
 * 🔴 読めない値を黙って null にすると、予定時刻が消えた現場が静かに混ざる。
 */
function num(v: string | undefined): number | null | undefined {
  const t = (v ?? "").trim();
  if (t === "") return null;
  if (!/^[0-9]+$/.test(t)) return undefined;
  return Number(t);
}

/** 勤務予定フラグの真偽。想定外の値は undefined を返し、呼び出し側が警告にする。 */
function flag(v: string | undefined): boolean | undefined {
  const t = (v ?? "").trim().toUpperCase();
  if (t === "" || t === "1" || t === "TRUE" || t === "○" || t === "有") return true;
  if (t === "0" || t === "FALSE" || t === "×" || t === "無" || t === "-") return false;
  return undefined;
}

/**
 * 部署コード。🔴 **`0` は「部署なし」**（2026-10-02・実データで判明）。
 *   ShiftMax は部署の無い得意先・現場に `0`（名前は空）を入れている（得意先603件すべて・現場・社員1件）。
 *   これを部署として作ると、東京と千葉の得意先が同じ部署「0」にぶら下がり、
 *   部署と管轄の整合の外部キー（20260924000000_consistency_guards.sql）で取込が丸ごと落ちる。
 */
function deptCode(v: string | undefined): string | null {
  const t = orNull(v);
  return t === "0" ? null : t;
}

/**
 * 略称が空のときの既定値。プレートに出るので空のままにはできない。
 *
 * 🔴 空白を落としてから切る。`鈴木 次郎` をそのまま4字にすると `鈴木 次` になり、
 *   プレートに中途半端な姓名が並ぶ。取込は一度に数百件が無人で通るため、
 *   ここで転ぶと気づかないまま盤面に出る。
 */
function fallbackShort(short: string | null, name: string, max: number): string {
  return short ?? name.replace(/[\s　]/g, "").slice(0, max);
}

// ─────────────────────────────────────────────────────────
// 本体
// ─────────────────────────────────────────────────────────

/**
 * CSV 文字列を読んで、種別を判定し、行に直す。
 *
 * 🔴 種別は**見出しで自動判定**する。`担当コード` は勤務マスターにも現場一覧にも
 *   入っているため、判定の順番が意味を持つ。
 *   個人コード → 警備先番号 → 現場 → 担当コード の順に見る。
 */
export function parseMasterCsv(text: string): ParseResult {
  const table = parseCsv(text);
  if (table.length === 0) return { ok: false, message: "中身が空の CSV です。" };

  const headers = table[0].map(normalizeHeader);
  const has = (h: string) => headers.includes(h);

  let kind: MasterKind | null = null;
  if (has("個人コード")) kind = "guards";
  else if (has("警備先番号")) kind = "duties";
  else if (has("現場")) kind = "sites";
  else if (has("担当コード")) kind = "customers";

  if (!kind) {
    return {
      ok: false,
      message:
        "どのマスタか判定できませんでした。1行目に見出し（個人コード／警備先番号／現場／担当コード のいずれか）が必要です。",
    };
  }

  const missing = REQUIRED[kind].filter((h) => !has(h));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `${KIND_LABEL[kind]}として読みましたが、${missing.join("・")} の列がありません。`,
    };
  }

  const body = table.slice(1);
  if (body.length === 0) return { ok: false, message: "見出しだけで、データの行がありません。" };
  if (body.length > IMPORT_MAX_ROWS) {
    return {
      ok: false,
      message: `1回に取り込めるのは ${IMPORT_MAX_ROWS.toLocaleString()} 行までです（${body.length.toLocaleString()} 行ありました）。`,
    };
  }

  const index = new Map(headers.map((h, i) => [h, i]));
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const seen = new Map<string, number>();

  /** その行の値を見出し名で取る。 */
  const cellOf = (cells: string[]) => (h: string) => {
    const i = index.get(h);
    return i === undefined ? undefined : cells[i];
  };

  if (kind === "guards") {
    const rows: GuardImportRow[] = [];
    body.forEach((cells, i) => {
      const line = i + 2; // 1行目は見出し
      const at = cellOf(cells);
      const code = orNull(at("個人コード"));
      const name = orNull(at("個人名"));
      if (!code) return errors.push({ row: line, message: "個人コードが空です。" });
      if (!name) return errors.push({ row: line, message: "個人名が空です。" });
      const dup = seen.get(code);
      if (dup) {
        return errors.push({
          row: line,
          message: `個人コード ${code} が ${dup} 行目と重複しています。`,
        });
      }
      seen.set(code, line);

      const jcode = orNull(at("管轄"));
      if (!jcode) return errors.push({ row: line, message: "管轄が空です。" });

      rows.push({
        staff_code: code,
        guard_no: orNull(at("隊員ナンバー")),
        name,
        short_name: fallbackShort(orNull(at("略称")), name, 4),
        name_kana: orNull(at("フリガナ")),
        email: orNull(at("メールアドレス")),
        jurisdiction_code: jcode,
        jurisdiction_name: orNull(at("管轄表示")),
        department_code: deptCode(at("部署コード")),
        department_name: orNull(at("部署名")),
      });
    });
    return { ok: true, kind, rows, errors, warnings, total: body.length };
  }

  if (kind === "customers") {
    const rows: CustomerImportRow[] = [];
    body.forEach((cells, i) => {
      const line = i + 2;
      const at = cellOf(cells);
      const code = orNull(at("担当コード"));
      const name = orNull(at("顧客名"));
      if (!code) return errors.push({ row: line, message: "担当コードが空です。" });
      if (!name) return errors.push({ row: line, message: "顧客名が空です。" });
      const dup = seen.get(code);
      if (dup) {
        return errors.push({
          row: line,
          message: `担当コード ${code} が ${dup} 行目と重複しています。`,
        });
      }
      seen.set(code, line);

      rows.push({
        staff_code: code,
        name,
        name_kana: orNull(at("フリガナ")),
        contact_name: orNull(at("担当名")),
        billing_no: orNull(at("請求番号")),
        billing_name: orNull(at("請求名")),
        jurisdiction_code: orNull(at("管轄")),
        jurisdiction_name: orNull(at("管轄表示")),
        department_code: deptCode(at("部署コード")),
        department_name: orNull(at("部署名")),
      });
    });
    return { ok: true, kind, rows, errors, warnings, total: body.length };
  }

  if (kind === "duties") {
    const rows: DutyImportRow[] = [];
    body.forEach((cells, i) => {
      const line = i + 2;
      const at = cellOf(cells);
      const target = orNull(at("警備先番号"));
      const smCode = orNull(at("現場コード"));
      const kindLabel = orNull(at("略称"));
      if (!target) return errors.push({ row: line, message: "警備先番号が空です。" });
      if (!smCode) return errors.push({ row: line, message: "現場コードが空です。" });
      if (!kindLabel) return errors.push({ row: line, message: "略称（区分）が空です。" });
      const dup = seen.get(target);
      if (dup) {
        return errors.push({
          row: line,
          message: `警備先番号 ${target} が ${dup} 行目と重複しています。`,
        });
      }
      seen.set(target, line);

      rows.push({
        guard_target_no: target,
        sm_site_code: smCode,
        kind_label: kindLabel,
        customer_staff_code: orNull(at("担当コード")),
        customer_code: orNull(at("顧客コード")),
        customer_no: orNull(at("得意先番号")),
        billing_no: orNull(at("請求番号")),
      });
    });
    return { ok: true, kind, rows, errors, warnings, total: body.length };
  }

  // ── 現場一覧 ──────────────────────────────────
  const rows: SiteImportRow[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const at = cellOf(cells);
    const name = orNull(at("現場"));
    if (!name) return errors.push({ row: line, message: "現場名が空です。" });
    // 🔴 同じ現場名でも得意先が違えば別の現場（駅名の現場に別の元請けが入る ─ 10/2 確認）
    const staff = orNull(at("担当コード"));
    const key = `${name}\u0000${staff ?? ""}`;
    const dup = seen.get(key);
    if (dup) {
      return errors.push({
        row: line,
        message: `現場「${name}」（同じ得意先）が ${dup} 行目と重複しています。`,
      });
    }
    seen.set(key, line);

    const jcode = orNull(at("現場管轄"));
    if (!jcode) return errors.push({ row: line, message: "現場管轄が空です。" });

    // 予定の時刻。読めない値はエラーにする（黙って未設定にしない）
    const times = {
      plan_start_h: num(at("予定開始時間")),
      plan_start_m: num(at("予定開始分")),
      plan_end_h: num(at("予定終了時間")),
      plan_end_m: num(at("予定終了分")),
      plan_break: num(at("予定休憩時間")),
    };
    const badTime = Object.entries(times).find(([, v]) => v === undefined);
    if (badTime) {
      return errors.push({
        row: line,
        message: "予定の時刻・休憩に数字でない値が入っています。",
      });
    }

    // 🔴 `勤務予定フラグ` が取り得る値は資料に無い（`shiftmax-api-analysis.md` §7-2）。
    //   推測で既定値に倒すと、予定を持たない現場が黙って「持つ」側に混ざる。
    //   想定外の値は **true として取り込んだうえで警告に出す**。
    const f = flag(at("勤務予定フラグ"));
    if (f === undefined) {
      warnings.push({
        row: line,
        message: `勤務予定フラグの値「${(at("勤務予定フラグ") ?? "").trim()}」が想定外です。「予定あり」として取り込みます。`,
      });
    }

    rows.push({
      name,
      short_name: fallbackShort(orNull(at("略称")), name, 8),
      name_kana: orNull(at("フリガナ")),
      address: orNull(at("現場住所")),
      plan_start_h: times.plan_start_h ?? null,
      plan_start_m: times.plan_start_m ?? null,
      plan_end_h: times.plan_end_h ?? null,
      plan_end_m: times.plan_end_m ?? null,
      plan_break: times.plan_break ?? null,
      has_plan: f ?? true,
      customer_code: orNull(at("顧客コード")),
      customer_no: orNull(at("得意先番号")),
      customer_staff_code: staff,
      billing_no: orNull(at("請求番号")),
      jurisdiction_code: jcode,
      jurisdiction_name: orNull(at("管轄表示")),
      department_code: deptCode(at("部署コード")),
      department_name: orNull(at("部署名")),
    });
  });

  return { ok: true, kind: "sites", rows, errors, warnings, total: body.length };
}

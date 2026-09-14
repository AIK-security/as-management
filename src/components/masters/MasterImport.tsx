"use client";

// ShiftMax マスタの取込画面（2026-09-14）。
//
// 流れ：ファイルを選ぶ → **その場で読んで検証し、件数とエラーを見せる** → 確定して取り込む。
// 🔴 読み込んだ瞬間には書き込まない。1,593 行が黙って入るのが一番こわい。
//
// 🔴 種別（隊員／現場／得意先）は見出しから自動で判定する。
//   選ばせると選び間違いが起きるし、CSV 側に答えが書いてある。
import { useRef, useState } from "react";
import { decodeCsvBytes } from "@/lib/csv";
import {
  IMPORT_MAX_ROWS,
  KIND_LABEL,
  parseMasterCsv,
  type ImportIssue,
  type ParseResult,
} from "@/lib/master-import";
import { importMaster, type ImportResult } from "@/app/masters/import/actions";
import { callAction } from "@/lib/action-call";
import { Notice, Section } from "@/components/masters/FormBits";

const BTN_PRIMARY =
  "rounded-md bg-indigo-600 px-4 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:opacity-50";
const BTN_GHOST =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100 disabled:opacity-50";

/** 一度に並べる指摘の数。全部出すと画面が流れて、かえって読めない。 */
const SHOW = 20;

function IssueList({ title, issues, tone }: { title: string; issues: ImportIssue[]; tone: "error" | "warn" }) {
  if (issues.length === 0) return null;
  const color =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded-md border px-2.5 py-2 ${color}`}>
      <div className="text-[13px] font-semibold">
        {title}：{issues.length.toLocaleString()} 件
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {issues.slice(0, SHOW).map((e, i) => (
          <li key={i} className="text-[12px] leading-snug">
            <span className="font-mono">{e.row} 行目</span>　{e.message}
          </li>
        ))}
      </ul>
      {issues.length > SHOW && (
        <div className="mt-1 text-[12px] text-slate-600">
          ほか {(issues.length - SHOW).toLocaleString()} 件（先頭 {SHOW} 件のみ表示）
        </div>
      )}
    </div>
  );
}

export function MasterImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);

  function reset() {
    setParsed(null);
    setFileName(null);
    setError(null);
    setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onPick(file: File) {
    setError(null);
    setDone(null);
    setFileName(file.name);
    try {
      // 🔴 Excel が吐く Shift_JIS も読む（`src/lib/csv.ts`）。
      //   ここで文字化けすると、見出しが一致せず「判定できません」になる
      setParsed(parseMasterCsv(decodeCsvBytes(await file.arrayBuffer())));
    } catch {
      setParsed(null);
      setError("ファイルを読めませんでした。CSV 形式で保存し直してください。");
    }
  }

  async function run() {
    if (!parsed || !parsed.ok) return;
    setPending(true);
    setError(null);
    const r = await callAction(() =>
      parsed.kind === "guards"
        ? importMaster({ kind: "guards", rows: parsed.rows })
        : parsed.kind === "sites"
          ? importMaster({ kind: "sites", rows: parsed.rows })
          : importMaster({ kind: "customers", rows: parsed.rows }),
    );
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setDone(r);
    setParsed(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <Section title="取り込む CSV を選ぶ" hint="隊員・現場・得意先は見出しから自動で判定します">
        <p className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[12px] leading-snug text-slate-600">
          べんり君の <span className="font-mono">社員マスター</span> /{" "}
          <span className="font-mono">勤務マスター</span> /{" "}
          <span className="font-mono">得意先マスター</span> シートを、そのまま CSV
          で保存したものを読みます。1行目が見出しである必要があります。
          <br />
          🔴 <span className="font-semibold">既にある行は、ShiftMax にある項目だけ更新します。</span>
          連絡先・資格・NG・協力会社の隊員など、このシステムだけが持っている情報は書き換えません。
        </p>

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
            }}
            className="text-[13px] file:mr-2 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-slate-600 hover:file:bg-slate-100"
          />
          {fileName && (
            <button type="button" onClick={reset} className={BTN_GHOST}>
              取り消す
            </button>
          )}
        </div>
      </Section>

      {error && <Notice kind="error">{error}</Notice>}

      {parsed && !parsed.ok && <Notice kind="error">{parsed.message}</Notice>}

      {parsed && parsed.ok && (
        <Section
          title={`${KIND_LABEL[parsed.kind]} として読みました`}
          hint={`${fileName ?? ""}（最大 ${IMPORT_MAX_ROWS.toLocaleString()} 行まで）`}
        >
          <div className="mb-2 flex flex-wrap items-center gap-4">
            <div>
              <div className="t-meta text-slate-500">データ行</div>
              <div className="font-mono text-[18px] font-semibold text-slate-900">
                {parsed.total.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="t-meta text-slate-500">取り込む</div>
              <div className="font-mono text-[18px] font-semibold text-indigo-700">
                {parsed.rows.length.toLocaleString()}
              </div>
            </div>
            {parsed.errors.length > 0 && (
              <div>
                <div className="t-meta text-slate-500">取り込まない（エラー）</div>
                <div className="font-mono text-[18px] font-semibold text-rose-700">
                  {parsed.errors.length.toLocaleString()}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <IssueList title="この行は取り込みません" issues={parsed.errors} tone="error" />
            <IssueList title="取り込みますが、確認してください" issues={parsed.warnings} tone="warn" />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={pending || parsed.rows.length === 0}
              onClick={() => void run()}
              className={BTN_PRIMARY}
            >
              {pending
                ? "取り込み中…"
                : `${parsed.rows.length.toLocaleString()} 件を取り込む`}
            </button>
            <button type="button" disabled={pending} onClick={reset} className={BTN_GHOST}>
              やめる
            </button>
          </div>
        </Section>
      )}

      {done && done.ok && (
        <Section title="取り込みました" hint={KIND_LABEL[done.kind]}>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="t-meta text-slate-500">新しく作った</div>
              <div className="font-mono text-[18px] font-semibold text-emerald-700">
                {done.created.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="t-meta text-slate-500">更新した</div>
              <div className="font-mono text-[18px] font-semibold text-slate-900">
                {done.updated.toLocaleString()}
              </div>
            </div>
          </div>

          {done.newJurisdictions.length > 0 && (
            <p className="mt-2 text-[12px] text-slate-600">
              管轄を新しく作りました：
              <span className="font-mono">{done.newJurisdictions.join(", ")}</span>
            </p>
          )}
          {done.newDepartments.length > 0 && (
            <p className="text-[12px] text-slate-600">
              部署を新しく作りました：
              <span className="font-mono">{done.newDepartments.join(", ")}</span>
            </p>
          )}
          {done.unresolvedCustomers > 0 && (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[12px] leading-snug text-amber-900">
              🔴 {done.unresolvedCustomers.toLocaleString()} 件の現場は、担当コードに対応する得意先が
              見つからなかったため<span className="font-semibold">得意先を紐付けていません</span>。
              先に得意先マスターを取り込んでから、現場をもう一度取り込んでください
              （既にある紐付けは消していません）。
            </p>
          )}
        </Section>
      )}
    </div>
  );
}

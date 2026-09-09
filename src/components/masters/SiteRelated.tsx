// 現場に紐づくもの（2026-09-09）。配置枠／必要資格／NG の3枚。
//
// 🔴 なぜ1ファイルにまとめたか
//   どれも「現場詳細の下半分」にしか出ない部品で、単独では使わない。
//   3ファイルに割ると、現場詳細を追うのに4ファイル開くことになる。
//
// 🔴 配置枠は**読むだけ**にしてある。
//   ここで枠を編集できるようにすると、配置ボードと同じ操作が2か所に生まれる。
//   1名体制では両方を保守できないので、**枠を直すのは配置ボード**に寄せ、
//   ここからはその日のボードへ飛べるようにする。
"use client";

import Link from "next/link";
import { useState } from "react";
import { addNgEntry, deleteNgEntry } from "@/app/masters/ng/actions";
import {
  removeSiteRequiredQualification,
  saveSiteRequiredQualification,
} from "@/app/masters/sites/actions";
import type { SiteNgRow, SiteQualificationRow, SiteShiftRow } from "@/lib/masters";
import { Notice, Section } from "@/components/masters/FormBits";

const CELL = "h-8 w-full rounded border border-slate-300 px-1.5 text-[13px] text-slate-900";
const TH =
  "border-b border-slate-200 py-1 pr-2 text-left text-[11px] font-semibold uppercase text-slate-500";

type Result = { ok: true } | { ok: false; message: string };

/** 2桁に揃えて時刻を出す。管制の指摘（8:0 → 08:00）と同じ扱いを一覧でも守る */
function hhmm(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const WORK_KIND: Record<string, string> = {
  day: "日勤",
  nightA: "夜勤A",
  nightB: "夜勤B",
  dayCancel: "日勤中止",
  nightCancel: "夜勤中止",
};

// ─────────────────────────────────────────────────────────
// 1. 配置枠（日付）
// ─────────────────────────────────────────────────────────

export function SiteShiftList({ rows }: { rows: SiteShiftRow[] }) {
  return (
    <Section title="配置枠" hint="直近30件・日付順。直すのは配置ボード">
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-white">
            <tr>
              <th className={TH}>日付</th>
              <th className={TH}>区分</th>
              <th className={TH}>時刻</th>
              <th className={TH}>休憩</th>
              <th className={TH}>配置</th>
              <th className={TH}>班</th>
              <th className={TH}>状態</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-2 text-slate-400">
                  この現場の配置枠はまだありません。配置ボードの「現場を追加」で作ります。
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const group = r.work_kind.startsWith("night") ? "night" : "day";
              const short = r.placed < r.headcount;
              return (
                <tr
                  key={r.id}
                  className="border-b border-slate-100 transition-all duration-150 ease-in-out hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap py-1.5 pr-2 font-mono tabular-nums text-slate-700">
                    {r.work_date}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-slate-600">
                    {WORK_KIND[r.work_kind] ?? r.work_kind}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 font-mono tabular-nums text-slate-700">
                    {hhmm(r.start_h, r.start_m)}–{hhmm(r.end_h, r.end_m)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-slate-500">
                    {r.break_min}分
                  </td>
                  {/* 🔴 充足を数字で出す。A表で丸囲みの人数を見るのと同じ判断材料 */}
                  <td
                    className={[
                      "whitespace-nowrap py-1.5 pr-2 font-semibold tabular-nums",
                      short ? "text-rose-600" : "text-slate-700",
                    ].join(" ")}
                  >
                    {r.placed} / {r.headcount}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-slate-500">
                    {r.band_name ?? "—"}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2">
                    {r.status === "confirmed" ? (
                      <span className="t-badge rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                        確定
                      </span>
                    ) : (
                      <span className="t-badge rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                        仮組み
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5">
                    <Link
                      href={`/board?date=${r.work_date}&group=${group}`}
                      className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[12px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
                    >
                      ボードで開く
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────
// 2. 必要資格
// ─────────────────────────────────────────────────────────

export function SiteQualificationList({
  siteId,
  rows,
  options,
}: {
  siteId: string;
  rows: SiteQualificationRow[];
  options: { id: string; short_label: string; name: string }[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [newCount, setNewCount] = useState(1);

  const held = new Set(rows.map((r) => r.qualification_id));
  const addable = options.filter((o) => !held.has(o.id));

  async function run(fn: () => Promise<Result>) {
    setPending(true);
    setError(null);
    const r = await fn();
    setPending(false);
    if (!r.ok) setError(r.message);
    return r.ok;
  }

  return (
    <Section title="必要資格" hint="配置ボードの警告はここを見ている">
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <th className={TH}>資格</th>
            <th className={TH}>必要人数</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-2 text-slate-400">
                必要資格の登録はありません。
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <SiteQualificationRowEditor
              key={r.id}
              siteId={siteId}
              row={r}
              pending={pending}
              run={run}
            />
          ))}

          {addable.length > 0 && (
            <tr className="border-t border-slate-200">
              <td className="py-1.5 pr-2">
                <select value={newId} onChange={(e) => setNewId(e.target.value)} className={CELL}>
                  <option value="">（資格を選ぶ）</option>
                  {addable.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.short_label} {o.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1.5 pr-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={newCount}
                  onChange={(e) =>
                    setNewCount(Number(e.target.value.replace(/[^0-9]/g, "") || 0))
                  }
                  className={CELL + " w-16 text-right font-mono"}
                />
              </td>
              <td className="py-1.5">
                <button
                  type="button"
                  disabled={pending || !newId}
                  onClick={async () => {
                    const ok = await run(() =>
                      saveSiteRequiredQualification({
                        siteId,
                        qualificationId: newId,
                        requiredCount: newCount,
                      }),
                    );
                    if (ok) {
                      setNewId("");
                      setNewCount(1);
                    }
                  }}
                  className="w-full rounded-md bg-indigo-600 px-2 py-1 text-[13px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:opacity-40"
                >
                  追加
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {error && (
        <div className="mt-2">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
    </Section>
  );
}

function SiteQualificationRowEditor({
  siteId,
  row,
  pending,
  run,
}: {
  siteId: string;
  row: SiteQualificationRow;
  pending: boolean;
  run: (fn: () => Promise<Result>) => Promise<boolean>;
}) {
  const [count, setCount] = useState(row.required_count);
  const dirty = count !== row.required_count;

  return (
    <tr className="border-b border-slate-100 transition-all duration-150 ease-in-out hover:bg-slate-50">
      <td className="py-1.5 pr-2">
        <span
          className="t-badge rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700"
          title={row.qualification?.name}
        >
          {row.qualification?.short_label ?? "?"}
        </span>
        <span className="ml-1.5 text-slate-600">{row.qualification?.name}</span>
      </td>
      <td className="py-1.5 pr-2">
        <input
          type="text"
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(Number(e.target.value.replace(/[^0-9]/g, "") || 0))}
          className={CELL + " w-16 text-right font-mono"}
        />
      </td>
      <td className="py-1.5">
        <div className="flex gap-1">
          {dirty && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  saveSiteRequiredQualification({
                    siteId,
                    qualificationId: row.qualification_id,
                    requiredCount: count,
                  }),
                )
              }
              className="rounded bg-indigo-600 px-1.5 py-1 text-[12px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:opacity-40"
            >
              保存
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => removeSiteRequiredQualification({ id: row.id }))}
            className="rounded border border-rose-300 bg-white px-1.5 py-1 text-[12px] text-rose-700 transition-all duration-150 ease-in-out hover:bg-rose-50"
          >
            外す
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────
// 3. NG（この現場に入れない隊員）
// ─────────────────────────────────────────────────────────

const REASON_KIND: { value: string; label: string }[] = [
  { value: "supervisor_ng", label: "監督NG" },
  { value: "conflict", label: "不仲" },
  { value: "other", label: "その他" },
];

export function SiteNgList({
  siteId,
  rows,
  guards,
}: {
  siteId: string;
  rows: SiteNgRow[];
  guards: { id: string; name: string }[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardId, setGuardId] = useState("");
  const [reasonKind, setReasonKind] = useState("supervisor_ng");
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState("block");

  async function run(fn: () => Promise<Result>) {
    setPending(true);
    setError(null);
    const r = await fn();
    setPending(false);
    if (!r.ok) setError(r.message);
    return r.ok;
  }

  return (
    <Section title="NG（この現場に入れない隊員）" hint="配置の判断材料。理由は必須">
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <th className={TH}>隊員</th>
            <th className={TH}>区分</th>
            <th className={TH}>理由</th>
            <th className={TH}>強さ</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2 text-slate-400">
                この現場の NG はありません。
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-slate-100 transition-all duration-150 ease-in-out hover:bg-slate-50"
            >
              <td className="whitespace-nowrap py-1.5 pr-2 font-semibold text-slate-800">
                {r.guardName}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-2 text-slate-600">
                {REASON_KIND.find((k) => k.value === r.reason_kind)?.label ?? r.reason_kind}
              </td>
              <td className="py-1.5 pr-2 text-slate-600">{r.reason}</td>
              <td className="whitespace-nowrap py-1.5 pr-2">
                {r.severity === "block" ? (
                  <span className="t-badge rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">
                    禁止
                  </span>
                ) : (
                  <span className="t-badge rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                    警告
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap py-1.5">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deleteNgEntry({ id: r.id }))}
                  className="rounded border border-rose-300 bg-white px-1.5 py-1 text-[12px] text-rose-700 transition-all duration-150 ease-in-out hover:bg-rose-50"
                >
                  削除
                </button>
              </td>
            </tr>
          ))}

          <tr className="border-t border-slate-200">
            <td className="py-1.5 pr-2">
              <select
                value={guardId}
                onChange={(e) => setGuardId(e.target.value)}
                className={CELL}
              >
                <option value="">（隊員を選ぶ）</option>
                {guards.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </td>
            <td className="py-1.5 pr-2">
              <select
                value={reasonKind}
                onChange={(e) => setReasonKind(e.target.value)}
                className={CELL}
              >
                {REASON_KIND.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </td>
            <td className="py-1.5 pr-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="なぜ NG か（必須）"
                className={CELL}
              />
            </td>
            <td className="py-1.5 pr-2">
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className={CELL}
              >
                <option value="block">禁止</option>
                <option value="warn">警告</option>
              </select>
            </td>
            <td className="py-1.5">
              <button
                type="button"
                disabled={pending || !guardId || reason.trim() === ""}
                onClick={async () => {
                  const ok = await run(() =>
                    addNgEntry({
                      kind: "site_guard",
                      guardId,
                      siteId,
                      reasonKind: reasonKind as "supervisor_ng" | "conflict" | "other",
                      reason,
                      severity: severity as "block" | "warn",
                    }),
                  );
                  if (ok) {
                    setGuardId("");
                    setReason("");
                  }
                }}
                className="w-full rounded-md bg-indigo-600 px-2 py-1 text-[13px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:opacity-40"
              >
                追加
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      {error && (
        <div className="mt-2">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
    </Section>
  );
}

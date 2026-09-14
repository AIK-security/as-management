// 隊員が持つ資格の付け外し（2026-09-09）。
//
// 🔴 資格を配列ではなくテーブルで持ったのは**有効期限のため**（data-model.md §5-2）。
//   付け外しだけできて期限を触れないなら、テーブルに分けた意味が無い。
//
// 🔴 期限は空欄を許す。空欄＝「切れない資格」。
//   今日の日付などで埋めると、**切れていない資格が期限切れとして赤く出る**。
//
// 🔴 期限切れの判定は JST の今日で行う。Vercel は UTC で動くため、
//   素の Date に任せると本番だけ1日ずれる（一覧・配置ボードと同じ理由）。
//   → today はサーバ側（page.tsx）から渡す。
"use client";

import { useState } from "react";
import {
  removeGuardQualification,
  saveGuardQualification,
} from "@/app/masters/guards/actions";
import type { GuardQualificationRow } from "@/lib/masters";
import { Notice, Section } from "@/components/masters/FormBits";
import { callAction } from "@/lib/action-call";

type Option = { id: string; short_label: string; name: string; has_expiry: boolean };

const CELL = "h-8 w-full rounded border border-slate-300 px-1.5 text-[13px] text-slate-900";

export function GuardQualificationList({
  guardId,
  rows,
  options,
  today,
}: {
  guardId: string;
  rows: GuardQualificationRow[];
  options: Option[];
  today: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 追加用の入力。既に持っている資格は選ばせない（upsert なので事故にはならないが、
  // 「追加したつもりが上書きだった」という見え方を避ける）
  const held = new Set(rows.map((r) => r.qualification_id));
  const addable = options.filter((o) => !held.has(o.id));
  const [newId, setNewId] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [newIssued, setNewIssued] = useState("");
  const [newExpires, setNewExpires] = useState("");
  // 🔴 「切れない資格」（has_expiry=false）は期限を入れさせない。
  //   入れられると、マスタ側の定義と食い違う値がここからだけ入る。
  const newHasExpiry = options.find((o) => o.id === newId)?.has_expiry ?? true;

  async function run(fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setPending(true);
    setError(null);
    const r = await callAction(fn);
    setPending(false);
    if (!r.ok) setError(r.message);
    return r.ok;
  }

  return (
    <Section title="資格" hint="期限が空欄なら「切れない資格」">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase text-slate-500">
            <th className="py-1 pr-2 font-semibold">資格</th>
            <th className="py-1 pr-2 font-semibold">番号</th>
            <th className="py-1 pr-2 font-semibold">取得日</th>
            <th className="py-1 pr-2 font-semibold">期限</th>
            <th className="w-24 py-1" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2 text-slate-400">
                資格の登録はありません。
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <QualificationRow
              key={r.id}
              guardId={guardId}
              row={r}
              today={today}
              pending={pending}
              run={run}
            />
          ))}

          {/* 追加の行。既に持っている資格が無くなったら出さない */}
          {addable.length > 0 && (
            <tr className="border-t border-slate-200 align-middle">
              <td className="py-1.5 pr-2">
                <select
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  className={CELL}
                >
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
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  placeholder="検定番号"
                  className={CELL + " font-mono"}
                />
              </td>
              <td className="py-1.5 pr-2">
                <input
                  type="date"
                  value={newIssued}
                  onChange={(e) => setNewIssued(e.target.value)}
                  className={CELL}
                />
              </td>
              <td className="py-1.5 pr-2">
                <input
                  type="date"
                  value={newHasExpiry ? newExpires : ""}
                  disabled={!newHasExpiry}
                  title={newHasExpiry ? undefined : "この資格に期限はありません"}
                  onChange={(e) => setNewExpires(e.target.value)}
                  className={CELL + (newHasExpiry ? "" : " bg-slate-100 text-slate-400")}
                />
              </td>
              <td className="py-1.5">
                <button
                  type="button"
                  disabled={pending || !newId}
                  onClick={async () => {
                    const ok = await run(() =>
                      saveGuardQualification({
                        guardId,
                        qualificationId: newId,
                        number: newNumber,
                        issuedOn: newIssued,
                        expiresOn: newExpires,
                      }),
                    );
                    if (ok) {
                      setNewId("");
                      setNewNumber("");
                      setNewIssued("");
                      setNewExpires("");
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

function QualificationRow({
  guardId,
  row,
  today,
  pending,
  run,
}: {
  guardId: string;
  row: GuardQualificationRow;
  today: string;
  pending: boolean;
  run: (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => Promise<boolean>;
}) {
  const [number, setNumber] = useState(row.number ?? "");
  const [issuedOn, setIssuedOn] = useState(row.issued_on ?? "");
  const [expiresOn, setExpiresOn] = useState(row.expires_on ?? "");
  const [asking, setAsking] = useState(false);

  // 期限なし（null）は切れない資格。期限切れだけを赤で出す（一覧と同じ判定）
  const hasExpiry = row.qualification?.has_expiry ?? true;
  const expired = hasExpiry && expiresOn !== "" && expiresOn < today;
  const dirty =
    number !== (row.number ?? "") ||
    issuedOn !== (row.issued_on ?? "") ||
    expiresOn !== (row.expires_on ?? "");

  return (
    <tr className="border-b border-slate-100 align-middle transition-all duration-150 ease-in-out hover:bg-slate-50">
      <td className="py-1.5 pr-2">
        <span
          className={[
            "t-badge rounded px-1.5 py-0.5",
            expired ? "bg-rose-100 text-rose-700 line-through" : "bg-indigo-50 text-indigo-700",
          ].join(" ")}
          title={row.qualification?.name}
        >
          {row.qualification?.short_label ?? "?"}
        </span>
        <span className="ml-1.5 text-slate-600">{row.qualification?.name}</span>
      </td>
      <td className="py-1.5 pr-2">
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className={CELL + " font-mono"}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          type="date"
          value={issuedOn}
          onChange={(e) => setIssuedOn(e.target.value)}
          className={CELL}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          type="date"
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
          disabled={!hasExpiry}
          title={hasExpiry ? undefined : "この資格に期限はありません"}
          className={
            CELL +
            (expired ? " border-rose-300 text-rose-700" : "") +
            (hasExpiry ? "" : " bg-slate-100 text-slate-400")
          }
        />
      </td>
      <td className="py-1.5">
        {asking ? (
          <div className="flex gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => removeGuardQualification({ id: row.id }))}
              className="rounded bg-rose-600 px-1.5 py-1 text-[12px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-rose-700 disabled:opacity-40"
            >
              外す
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[12px] text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
            >
              やめる
            </button>
          </div>
        ) : (
          <div className="flex gap-1">
            {/* 🔴 直したときだけ「保存」を出す。押す必要があるかを見た目で分からせる */}
            {dirty && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    saveGuardQualification({
                      guardId,
                      qualificationId: row.qualification_id,
                      number,
                      issuedOn,
                      expiresOn,
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
              onClick={() => setAsking(true)}
              className="rounded border border-rose-300 bg-white px-1.5 py-1 text-[12px] text-rose-700 transition-all duration-150 ease-in-out hover:bg-rose-50"
            >
              外す
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

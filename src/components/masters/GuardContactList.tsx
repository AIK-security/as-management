// 隊員の連絡先（2026-09-09）。
//
// 🔴 この画面の主役は `到達` のチェックボックス。
//   「LINE が繋がらない隊員が約4割」（8/27 管制ヒアリング）を扱うために持った列で、
//   一斉連絡（S-03）は LINE 可／不可で宛先を分けて出す（requirements.md §4-4）。
//   ここで倒せないなら、その列は永遠に true のままになる。
//
// 🔴 主連絡先は1件だけ。DB に制約が無いので Server Action 側で他を降ろしている。
"use client";

import { useState } from "react";
import { deleteGuardContact, saveGuardContact } from "@/app/masters/guards/actions";
import type { GuardContactRow } from "@/lib/masters";
import { Notice, Section } from "@/components/masters/FormBits";

const KINDS: { value: string; label: string }[] = [
  { value: "phone", label: "電話" },
  { value: "line", label: "LINE" },
  { value: "email", label: "メール" },
  { value: "other", label: "その他" },
];

const CELL = "h-8 w-full rounded border border-slate-300 px-1.5 text-[13px] text-slate-900";

export function GuardContactList({
  guardId,
  rows,
}: {
  guardId: string;
  rows: GuardContactRow[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newKind, setNewKind] = useState("phone");
  const [newValue, setNewValue] = useState("");
  const [newReachable, setNewReachable] = useState(true);

  async function run(fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setPending(true);
    setError(null);
    const r = await fn();
    setPending(false);
    if (!r.ok) setError(r.message);
    return r.ok;
  }

  return (
    <Section title="連絡先" hint="「到達」を外すと一斉連絡の宛先から電話リストへ回る">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase text-slate-500">
            <th className="w-24 py-1 pr-2 font-semibold">種別</th>
            <th className="py-1 pr-2 font-semibold">連絡先</th>
            <th className="w-16 py-1 pr-2 text-center font-semibold">到達</th>
            <th className="w-16 py-1 pr-2 text-center font-semibold">主</th>
            <th className="w-24 py-1" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2 text-slate-400">
                連絡先の登録はありません。
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <ContactRow key={r.id} guardId={guardId} row={r} pending={pending} run={run} />
          ))}

          <tr className="border-t border-slate-200 align-middle">
            <td className="py-1.5 pr-2">
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value)}
                className={CELL}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </td>
            <td className="py-1.5 pr-2">
              <input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="番号・ID・アドレス"
                className={CELL}
              />
            </td>
            <td className="py-1.5 pr-2 text-center">
              <input
                type="checkbox"
                checked={newReachable}
                onChange={(e) => setNewReachable(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
            </td>
            <td className="py-1.5 pr-2 text-center text-slate-300">—</td>
            <td className="py-1.5">
              <button
                type="button"
                disabled={pending || newValue.trim() === ""}
                onClick={async () => {
                  const ok = await run(() =>
                    saveGuardContact({
                      id: null,
                      guardId,
                      kind: newKind,
                      value: newValue,
                      reachable: newReachable,
                      // 🔴 追加時に「主」にはしない。既にある主を黙って降ろすことになる
                      isPrimary: false,
                    }),
                  );
                  if (ok) {
                    setNewValue("");
                    setNewReachable(true);
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

function ContactRow({
  guardId,
  row,
  pending,
  run,
}: {
  guardId: string;
  row: GuardContactRow;
  pending: boolean;
  run: (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => Promise<boolean>;
}) {
  const [kind, setKind] = useState(row.kind);
  const [value, setValue] = useState(row.value);
  const [reachable, setReachable] = useState(row.reachable);
  const [isPrimary, setIsPrimary] = useState(row.is_primary);
  const [asking, setAsking] = useState(false);

  const dirty =
    kind !== row.kind ||
    value !== row.value ||
    reachable !== row.reachable ||
    isPrimary !== row.is_primary;

  function save() {
    return run(() => saveGuardContact({ id: row.id, guardId, kind, value, reachable, isPrimary }));
  }

  return (
    <tr className="border-b border-slate-100 align-middle transition-all duration-150 ease-in-out hover:bg-slate-50">
      <td className="py-1.5 pr-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={CELL}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </td>
      <td className="py-1.5 pr-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={CELL + (reachable ? "" : " text-slate-400 line-through")}
        />
      </td>
      <td className="py-1.5 pr-2 text-center">
        <input
          type="checkbox"
          checked={reachable}
          onChange={(e) => setReachable(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
      </td>
      <td className="py-1.5 pr-2 text-center">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
      </td>
      <td className="py-1.5">
        {asking ? (
          <div className="flex gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteGuardContact({ id: row.id }))}
              className="rounded bg-rose-600 px-1.5 py-1 text-[12px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-rose-700 disabled:opacity-40"
            >
              削除
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
            {/* 直したときだけ「保存」を出す（資格の行と同じ） */}
            {dirty && (
              <button
                type="button"
                disabled={pending}
                onClick={save}
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
              削除
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

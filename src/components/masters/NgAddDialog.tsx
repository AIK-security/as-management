// NG の登録ダイアログ（2026-09-08）。
//
// 🔴 NG は「誰も仕様を持っていない」ところから貯め始める（screen-design.md §10-3）。
//   だから**入れる項目を増やさない**。増やすほど入力されなくなり、
//   貯まらないまま MTG を迎える。今日入れるのは
//   「誰が」「どこ／誰と」「なぜ」の3つだけ。
//
// 🔴 window.confirm / prompt は使わない（2026-09-04 決定）。
//   Chrome の「これ以上ダイアログを表示しない」が効くと無反応になる。
"use client";

import { useEffect, useState } from "react";
import { addNgEntry } from "@/app/masters/ng/actions";
import type { NgKind, NgReasonKind, NgSeverity } from "@/lib/masters";
import { callAction } from "@/lib/action-call";

const FIELD =
  "h-9 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export function NgAddDialog({
  guards,
  sites,
}: {
  guards: { id: string; name: string }[];
  sites: { id: string; name: string; guard_target_no: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<NgKind>("site_guard");
  const [guardId, setGuardId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [counterpartId, setCounterpartId] = useState("");
  const [reasonKind, setReasonKind] = useState<NgReasonKind>("supervisor_ng");
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState<NgSeverity>("warn");

  // Esc で閉じる。ダイアログの既定の作法に合わせる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setOpen(false);
    setGuardId("");
    setSiteId("");
    setCounterpartId("");
    setReason("");
    setError(null);
  }

  async function submit() {
    setPending(true);
    setError(null);
    const result = await callAction(() => addNgEntry({
      kind,
      guardId,
      siteId: siteId || undefined,
      counterpartGuardId: counterpartId || undefined,
      reasonKind,
      reason,
      severity,
    }));
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    reset();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 rounded-md bg-indigo-600 px-3 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700"
      >
        NG を登録
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[14px] font-semibold text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
      >
        閉じる（Esc）
      </button>

      <div className="absolute right-0 top-11 z-30 w-[520px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="text-[16px] font-semibold tracking-tight text-slate-900">
            NG を登録
          </span>
        </div>

        {/* 種類。どちらを選ぶかで下の欄が入れ替わる */}
        <div className="mt-2 flex overflow-hidden rounded-md border-2 border-slate-300">
          {(
            [
              { v: "site_guard", label: "この現場に、この隊員は出せない" },
              { v: "guard_guard", label: "この2人は組ませられない" },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setKind(o.v)}
              className={[
                "flex-1 px-3 py-1.5 text-[13px] font-semibold transition-all duration-150 ease-in-out",
                kind === o.v ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">隊員</span>
            <select
              value={guardId}
              onChange={(e) => setGuardId(e.target.value)}
              className={FIELD}
            >
              <option value="">（選ぶ）</option>
              {guards.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>

          {kind === "site_guard" ? (
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-slate-500">現場</span>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={FIELD}>
                <option value="">（選ぶ）</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-slate-500">相手の隊員</span>
              <select
                value={counterpartId}
                onChange={(e) => setCounterpartId(e.target.value)}
                className={FIELD}
              >
                <option value="">（選ぶ）</option>
                {guards.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">区分</span>
            <select
              value={reasonKind}
              onChange={(e) => setReasonKind(e.target.value as NgReasonKind)}
              className={FIELD}
            >
              <option value="supervisor_ng">監督NG</option>
              <option value="conflict">不仲</option>
              <option value="other">その他</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">強さ</span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as NgSeverity)}
              className={FIELD}
            >
              <option value="warn">なるべく避ける</option>
              <option value="block">絶対に出せない</option>
            </select>
          </label>
        </div>

        <label className="mt-2 flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-slate-500">
            理由（必須）
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例：現場監督から名指しで断られた（2026-08）"
            className={FIELD + " w-full"}
          />
        </label>

        {/* 🔴 期待を持たせない。いまは配置を止めない（screen-design.md §2-5） */}
        <p className="mt-2 text-[12px] leading-snug text-slate-500">
          登録すると配置ボードの「⚠要確認」に出ます。
          <span className="font-medium text-slate-600">配置そのものは止めません</span>
          （止めるのは同じ隊員の時間の重なりだけ）。
        </p>

        {error && (
          <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[13px] text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:opacity-50"
          >
            {pending ? "登録中…" : "登録する"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border-2 border-slate-300 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// 「別の日から複写」＝ 似た日の盤面を丸ごと写す（2026-10-05）
//
// 🔴 なぜ要るのか（処理側の理由は actions.ts の copyDay）
//   空の盤面に約55枠を1件ずつ作らせない。写してから直す。
//
// 🔴 結果は**閉じずに見せる**。置かなかった人の名前と理由が要点で、
//   すぐ閉じると「写したのに居ない」に見える（柴山・2026-10-05）。
//
// 🔴 window.confirm / prompt は使わない（2026-09-04 決定。AddShiftDialog と同じ）。
"use client";

import { useState } from "react";
import { copyDay, type CopyDayResult } from "@/app/board/actions";
import { addDays, formatBoardDate } from "@/lib/board-format";
import { callAction } from "@/lib/action-call";
import { HEADER_BTN } from "@/components/board/header-ui";

const FIELD =
  "h-9 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";
const CHIP =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100";

type Done = Extract<CopyDayResult, { ok: true }>;

export function CopyDayDialog({
  workDate,
  jurisdictionId,
  jurisdictionName,
}: {
  workDate: string;
  jurisdictionId: string;
  jurisdictionName: string;
}) {
  const [open, setOpen] = useState(false);
  // 🔴 null = まだ触っていない。表示している日から導く（AddShiftDialog と同じ理由）
  const [fromInput, setFrom] = useState<string | null>(null);
  const fromDate = fromInput ?? addDays(workDate, -7);
  const [withAssignments, setWithAssignments] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  function reset() {
    setOpen(false);
    setFrom(null);
    setWithAssignments(true);
    setError(null);
    setDone(null);
  }

  async function submit() {
    setPending(true);
    setError(null);
    const result = await callAction(() =>
      copyDay({ jurisdictionId, fromDate, toDate: workDate, withAssignments }),
    );
    setPending(false);
    if (!result.ok) {
      setError(result.message ?? "複写できませんでした。");
      return;
    }
    setDone(result);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          HEADER_BTN + " cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        }
      >
        別の日から複写
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        className={HEADER_BTN + " border-indigo-600 bg-indigo-600 text-white"}
      >
        別の日から複写
      </button>

      <div
        className="absolute right-0 top-full z-30 mt-1 w-[440px] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg"
        onKeyDown={(e) => {
          if (e.key === "Escape") reset();
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] font-semibold text-slate-900">別の日から複写</span>
          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            閉じる（Esc）
          </button>
        </div>

        {!done && (
          <>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[11px] font-medium text-slate-500">複写元</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFrom(e.target.value)}
                  className={FIELD}
                />
                <button type="button" className={CHIP} onClick={() => setFrom(addDays(workDate, -1))}>
                  前日
                </button>
                <button type="button" className={CHIP} onClick={() => setFrom(addDays(workDate, -7))}>
                  1週前
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="w-14 shrink-0 text-[11px] font-medium text-slate-500">複写先</span>
                <span className="text-[14px] font-semibold text-slate-900">
                  {formatBoardDate(workDate)}
                </span>
                <span className="text-[12px] text-slate-500">（{jurisdictionName}・日勤／夜勤とも）</span>
              </div>
            </div>

            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[14px] text-slate-800">
              <input
                type="checkbox"
                checked={withAssignments}
                onChange={(e) => setWithAssignments(e.target.checked)}
                className="h-4 w-4 accent-indigo-600"
              />
              配置した人も複写する
            </label>

            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12px] leading-snug text-slate-500">
              <li>枠はすべて「仮組み」で作ります。</li>
              <li>同じ現場・同じ区分の枠がこの日に既にあるぶんは作りません。中止の枠は写しません。</li>
              {withAssignments && (
                <li>休みの人・ほかの配置と時間が重なる人は置かず、名前と理由を出します。</li>
              )}
            </ul>

            {error && (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[13px] text-rose-700">
                {error}
              </div>
            )}

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={submit}
                disabled={pending || !fromDate || fromDate === workDate}
                className="rounded-md border-2 border-indigo-600 bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "複写中…" : `${formatBoardDate(fromDate)} から複写する`}
              </button>
            </div>
          </>
        )}

        {done && (
          <div className="space-y-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
              <dt className="text-slate-500">作った枠</dt>
              <dd className="font-semibold text-slate-900 tabular-nums">
                {done.created} 件
                {done.skippedShifts > 0 && (
                  <span className="ml-2 font-normal text-slate-500">
                    （既にあった {done.skippedShifts} 件は作らず）
                  </span>
                )}
              </dd>
              {withAssignments && (
                <>
                  <dt className="text-slate-500">置いた人</dt>
                  <dd className="font-semibold text-slate-900 tabular-nums">{done.placed} 名</dd>
                </>
              )}
            </dl>

            {done.skips.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50">
                <div className="border-b border-amber-200 px-2 py-1 text-[12px] font-semibold text-amber-800">
                  置かなかった人 {done.skips.length} 名（枠は空けてあります）
                </div>
                <ul className="max-h-56 divide-y divide-amber-100 overflow-y-auto">
                  {done.skips.map((s, i) => (
                    <li key={i} className="flex items-baseline gap-2 px-2 py-1 text-[13px]">
                      <span className="shrink-0 font-semibold text-slate-900">{s.guardName}</span>
                      <span className="truncate text-slate-500">{s.place}</span>
                      <span className="ml-auto shrink-0 text-amber-800">{s.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={reset}
                className="rounded-md border-2 border-slate-300 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

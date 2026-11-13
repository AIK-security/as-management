// 同じ現場に、時刻の違う同じ区分の枠を足すときの確認（2026-11-13）
//
// 🔴 なぜ要るのか
//   早出のように、同じ現場・同じ日・同じ区分に枠を2つ立てる運用がある
//   （赤尾さん・お試しの報告）。以前は作れず、夜勤で作って日勤に直す回避をしていた。
//   作れるようにすると、今度は「うっかり二重に作った」に気づけなくなる。
//   → 止めはしないが、作る前に既にある枠を見せて1回だけ確かめる。
//
// 🔴 盤面に「同じ現場あり」の印を出し続ける案は取らない。
//   早出のある現場では正しい状態なのに、毎日警告が出ることになる。
//
// 🔴 window.confirm は使わない（2026-09-04 決定。無反応になることがある）。
//   配置ボード（AddShiftDialog）と現場マスタ（AddShiftFromSite）の両方で使う。
"use client";

import type { SameSiteConflict } from "@/app/board/actions";
import { formatTime, formatWeekDay } from "@/lib/board-format";

/** 並べる行の上限。期間で作ると数十日になりうるので、残りは件数で言う */
const MAX_LINES = 5;

export function SameSiteConfirm({
  conflicts,
  newStart,
  newEnd,
  pending,
  onConfirm,
  onBack,
}: {
  conflicts: SameSiteConflict[];
  /** これから作る枠の時刻（「6:00〜8:00 の枠として」と言うため） */
  newStart: string;
  newEnd: string;
  pending: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const shown = conflicts.slice(0, MAX_LINES);
  const rest = conflicts.length - shown.length;

  return (
    <div
      role="alertdialog"
      aria-label="同じ現場の枠の確認"
      className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-[13px] text-amber-900"
    >
      <p className="font-semibold">この現場には、同じ日・同じ勤務区分の枠が既にあります。</p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((c, i) => (
          <li key={`${c.workDate}-${i}`} className="font-mono tabular-nums">
            {formatWeekDay(c.workDate)}　{formatTime(c.startH, c.startM)}〜
            {formatTime(c.endH, c.endM)}
            {c.cancelled && <span className="ml-1 font-sans text-amber-700">（中止）</span>}
          </li>
        ))}
        {rest > 0 && <li className="text-amber-700">ほか {rest} 件</li>}
      </ul>
      <p className="mt-1">
        早出などで別に立てる場合は、
        <span className="font-mono font-semibold tabular-nums">
          {newStart}〜{newEnd}
        </span>
        の別の枠として追加します。
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className="cursor-pointer rounded-md border-2 border-amber-600 bg-amber-600 px-3 py-1 text-[13px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-amber-700 disabled:opacity-50"
        >
          {pending ? "追加中…" : "別の枠として追加"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer rounded-md border-2 border-slate-300 bg-white px-3 py-1 text-[13px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          戻る
        </button>
      </div>
    </div>
  );
}

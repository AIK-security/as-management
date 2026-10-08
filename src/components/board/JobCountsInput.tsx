// 枠の「必要人数のうち 検定・列車見張・ドライバー」を入れる欄（2026-10-08）。
//
// 🔴 A表の人数欄の `K1R1` をそのまま入れる。**必要人数の内数**（管制・2026-10-08）。
//   合計が必要人数を超えたら DB が拒む（shifts_job_counts_within_headcount）。
//   ここでも先に赤くして、押す前に気づけるようにする。
// 🔴 ラベルは A表と同じ K・R・D。ツールチップで日本語を補う。
"use client";

import { JOB_TYPE_LABEL, JOB_TYPE_MARK, JOB_TYPES } from "@/lib/board-format";
import type { JobCounts } from "@/lib/types";

const FIELD =
  "h-9 w-12 rounded-md border px-2 text-right font-mono text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export function JobCountsInput({
  value,
  onChange,
  headcount,
}: {
  value: JobCounts;
  onChange: (next: JobCounts) => void;
  headcount: number;
}) {
  const total = JOB_TYPES.reduce((sum, j) => sum + value[j], 0);
  const over = total > headcount;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-slate-500">
        うち{" "}
        {over ? (
          <span className="text-rose-600">合計が人数を超えています</span>
        ) : (
          <span className="font-normal text-slate-400">A表の K・R・D</span>
        )}
      </span>
      <div className="flex gap-1">
        {JOB_TYPES.map((j) => (
          <label key={j} className="flex items-center gap-0.5" title={JOB_TYPE_LABEL[j]}>
            <span className="text-[12px] font-semibold text-slate-600">{JOB_TYPE_MARK[j]}</span>
            <input
              type="number"
              min={0}
              value={value[j]}
              onChange={(e) => onChange({ ...value, [j]: Math.max(0, Number(e.target.value) || 0) })}
              aria-label={`${JOB_TYPE_LABEL[j]}の人数`}
              className={FIELD + (over ? " border-rose-400" : " border-slate-300")}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

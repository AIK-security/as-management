// 枠を直すダイアログ（2026-09-09）。
//
// 🔴 なぜ要るのか（柴山・2026-09-09）
//   「案件の新規作成は必要な情報がもっとある。あの程度の情報しか入力できなくて、
//     わざわざマスターまで行かないと編集できないなら無い方がいい」。
//   実際そうなっていた ─ 枠は**作る・中止する・消す**しかできず、
//   時刻を5分ずらすだけでも枠を消して作り直すしかなかった。
//   当日変更は通常業務（screen-design.md §2-7）なので、これは使えない。
//
// 🔴 直せるのは「枠の中身」だけ。現場そのものは差し替えない。
//   差し替えを許すと、配置済みの隊員が黙って別現場へ移る。
//
// 🔴 window.confirm は使わない（2026-09-04 決定）。保存はその場で結果を出す。
"use client";

import { useEffect, useState } from "react";
import { TwoDigitInput } from "@/components/TwoDigitInput";
import { updateShift } from "@/app/board/actions";
import type { Shift, WorkKind } from "@/lib/types";
import { callAction } from "@/lib/action-call";

const FIELD =
  "h-9 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";
const BTN =
  "rounded-md border-2 px-3 py-1.5 text-[14px] font-semibold transition-all duration-150 ease-in-out";

export function ShiftEditDialog({
  shift,
  siteName,
  onClose,
}: {
  shift: Shift;
  siteName: string;
  onClose: () => void;
}) {
  const [workKind, setWorkKind] = useState<WorkKind>(shift.work_kind);
  const [startH, setStartH] = useState(shift.start_h);
  const [startM, setStartM] = useState(shift.start_m);
  const [endH, setEndH] = useState(shift.end_h);
  const [endM, setEndM] = useState(shift.end_m);
  const [breakMin, setBreakMin] = useState(shift.break_min);
  const [headcount, setHeadcount] = useState(shift.headcount);
  const [planComment, setPlanComment] = useState(shift.plan_comment ?? "");
  const [billingNote, setBillingNote] = useState(shift.billing_note ?? "");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc で閉じる（配置ボードは keyboard 操作が前提の画面）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setPending(true);
    setError(null);
    const r = await callAction(() => updateShift({
      shiftId: shift.id,
      workKind,
      headcount,
      startH,
      startM,
      endH,
      endM,
      breakMin,
      planComment,
      billingNote,
    }));
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-8"
      onClick={onClose}
    >
      <div
        className="w-[560px] rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-semibold tracking-tight text-slate-900">枠を直す</h2>
          <span className="text-[13px] text-slate-500">{siteName}</span>
          <span className="t-meta ml-auto font-mono text-slate-500">{shift.work_date}</span>
        </div>

        {shift.status === "confirmed" && (
          // 🔴 止めはしない。当日変更は通常業務。ただし確定し直しが要ることは言う
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[13px] text-amber-900">
            確定済みの枠です。直すと
            <span className="font-semibold">仮組みに戻ります</span>（確定し直しが要ります）。
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">勤務区分</span>
            <select
              value={workKind}
              onChange={(e) => setWorkKind(e.target.value as WorkKind)}
              className={FIELD + " w-24"}
            >
              <option value="day">日勤</option>
              <option value="nightA">夜A</option>
              <option value="nightB">夜B</option>
              <option value="dayCancel">日勤 現中</option>
              <option value="nightCancel">夜勤 現中</option>
            </select>
          </label>

            {/* 🔴 24時以降を入力できる（2026-09-16・管制の要望）。
                「16日 24:30 〜 翌 6:30」は**16日に実施した案件**として扱う。
                DB 側は元から日跨ぎを織り込んであり（assignments_fill_planned_times が
                work_date + 開始分 で timestamp を組む）、止めていたのはこの入力欄の上限だけだった。

                🔴 24:30 と 00:30 は**別の日を指す**。
                  ・24:30 → その日の深夜（＝翌日の 0:30）
                  ・00:30 → その日の未明（＝前の晩から続く勤務）
                上限は 29:59。終了が開始より前なら翌日と解釈されるので、
                終了は「06:30」と普通に書けばよい（30:30 と書く必要はない）。 */}
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">開始</span>
            <div className="flex items-center gap-1">
              <TwoDigitInput value={startH} onChange={setStartH} max={29} />
              <span className="text-slate-400">:</span>
              <TwoDigitInput value={startM} onChange={setStartM} max={59} />
            </div>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">終了</span>
            <div className="flex items-center gap-1">
              <TwoDigitInput value={endH} onChange={setEndH} max={29} />
              <span className="text-slate-400">:</span>
              <TwoDigitInput value={endM} onChange={setEndM} max={59} />
            </div>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">休憩</span>
            <input
              type="number"
              min={0}
              step={5}
              value={breakMin}
              onChange={(e) => setBreakMin(Number(e.target.value))}
              className={FIELD + " w-16 text-right font-mono"}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">人数</span>
            <input
              type="number"
              min={1}
              value={headcount}
              onChange={(e) => setHeadcount(Number(e.target.value))}
              className={FIELD + " w-16 text-right font-mono"}
            />
          </label>

        </div>

        <div className="mt-2 flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">
              予定コメント <span className="font-normal text-slate-400">集合場所など</span>
            </span>
            <input
              value={planComment}
              onChange={(e) => setPlanComment(e.target.value)}
              className={FIELD + " w-full"}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">
              請求備考 <span className="font-normal text-slate-400">第2弾で使う</span>
            </span>
            <input
              value={billingNote}
              onChange={(e) => setBillingNote(e.target.value)}
              className={FIELD + " w-full"}
            />
          </label>
        </div>

        {error && (
          <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[13px] text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className={
              BTN +
              " cursor-pointer border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            }
          >
            {pending ? "保存中…" : "保存する"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={BTN + " cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}
          >
            キャンセル
          </button>
          <span className="ml-auto text-[12px] text-slate-400">Esc で閉じる</span>
        </div>
      </div>
    </div>
  );
}

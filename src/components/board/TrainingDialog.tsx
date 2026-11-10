// 研修の現場と時刻を入れるダイアログ（2026-11-10）
//
// 🔴 なぜ要るか：研修は18列CSV に「勤務名＝研修をした現場名・時刻＝その現場の上下番時刻」で
//   出す（確認担当・美土路さん）。時刻は現場ごとに違う（芦花公園 8:00〜17:00、人形町 8:30〜17:30）。
//   現場と時刻が無いと給与側へ渡せない。
//
// 🔴 速さが仕様（「現場を追加」と同じ考え方）：
//   1. 開いたらすぐ打てる（検索欄にフォーカス）
//   2. 現場を選んだら時刻が入る ─ **その日のその現場の枠** → 無ければ現場マスタの予定
//   3. その日に枠がある現場を先に並べる（研修は現場で行う）
//
// 🔴 window.confirm / prompt は使わない（2026-09-04 決定）。
"use client";

import { useEffect, useRef, useState } from "react";
import {
  getTrainingSiteChoices,
  type ActionResult,
  type TrainingInput,
  type TrainingSiteChoice,
} from "@/app/board/actions";
import { TwoDigitInput } from "@/components/TwoDigitInput";
import { callAction } from "@/lib/action-call";
import { formatWeekDay } from "@/lib/board-format";
import type { TrainingDetail } from "@/lib/week-board";

const BTN =
  "rounded-md border-2 px-3 py-1.5 text-[14px] font-semibold transition-all duration-150 ease-in-out";
const FIELD =
  "h-9 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

/** 候補は8件まで（「現場を追加」と同じ） */
const MAX_SUGGESTIONS = 8;

export type TrainingDialogTarget = {
  guardName: string;
  workDate: string;
  /** すでに入っている現場・時刻（直すとき・日を移すとき） */
  initial: TrainingDetail | null;
  /** 保存の中身。新しく入れる／直す／日を移す で違うので呼び出し側が決める */
  save: (t: TrainingInput) => Promise<ActionResult>;
};

export function TrainingDialog({
  target,
  onClose,
}: {
  target: TrainingDialogTarget;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<TrainingSiteChoice[] | null>(null);
  const [query, setQuery] = useState(target.initial?.siteName ?? "");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    target.initial ? { id: target.initial.siteId, name: target.initial.siteName } : null,
  );
  const [timeNote, setTimeNote] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [startH, setStartH] = useState(target.initial?.startH ?? 8);
  const [startM, setStartM] = useState(target.initial?.startM ?? 0);
  const [endH, setEndH] = useState(target.initial?.endH ?? 17);
  const [endM, setEndM] = useState(target.initial?.endM ?? 0);
  const [breakMin, setBreakMin] = useState(target.initial?.breakMin ?? 60);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    searchRef.current?.focus();
    let alive = true;
    callAction(() => getTrainingSiteChoices({ workDate: target.workDate })).then((r) => {
      if (!alive) return;
      if (r.ok) setChoices(r.choices);
      else setError(r.message);
    });
    return () => {
      alive = false;
    };
  }, [target.workDate]);

  const q = query.trim();
  const matches = (choices ?? [])
    .filter((s) => !q || (s.name + s.short_name + (s.customerName ?? "")).includes(q))
    .slice(0, MAX_SUGGESTIONS);

  function choose(site: TrainingSiteChoice) {
    setPicked({ id: site.id, name: site.name });
    setQuery(site.name);
    // 🔴 時刻が分かるものだけ上書きする。分からない現場で 0 時に潰さない
    if (site.time) {
      setStartH(site.time.startH);
      setStartM(site.time.startM);
      setEndH(site.time.endH);
      setEndM(site.time.endM);
      setBreakMin(site.time.breakMin);
      setTimeNote(
        site.fromShift
          ? "時刻はこの日のこの現場の枠から入れました"
          : "この日は枠が無いため、時刻は現場の予定から入れました",
      );
    } else {
      setTimeNote("この現場は時刻が分かりません。上下番の時刻を入れてください");
    }
  }

  async function submit() {
    if (!picked) return;
    setPending(true);
    setError(null);
    const r = await callAction(() =>
      target.save({ siteId: picked.id, startH, startM, endH, endM, breakMin }),
    );
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onClose();
  }

  const canSubmit = picked !== null && !pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/20 pt-24"
      onPointerDown={(e) => {
        // 外側を押したら閉じる（中身を押したときは閉じない）
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="研修の現場と時刻"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.nativeEvent.isComposing) onClose();
        }}
        className="w-[420px] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] font-semibold tracking-tight text-slate-900">
            研修：{target.guardName}
            <span className="ml-2 text-[12px] font-medium text-slate-500">
              {formatWeekDay(target.workDate)}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-slate-500 transition-all duration-150 ease-in-out hover:text-slate-800"
          >
            閉じる（Esc）
          </button>
        </div>

        <span className="text-[11px] font-medium text-slate-500">研修をした現場</span>
        <input
          ref={searchRef}
          value={query}
          placeholder="現場名で検索"
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
            setTimeNote(null);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            // 🔴 IME の変換中はキーを拾わない（2026-09-04 決定）
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (!picked && matches[cursor]) choose(matches[cursor]);
              else if (canSubmit) void submit();
            }
          }}
          className={FIELD + " mt-0.5 w-full"}
        />

        {!picked && (
          <ul className="mt-1 max-h-52 overflow-y-auto rounded-md border border-slate-200">
            {choices === null && (
              <li className="px-2 py-1.5 text-[13px] text-slate-500">読み込み中…</li>
            )}
            {matches.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => choose(s)}
                  className={[
                    "flex w-full items-baseline gap-2 px-2 py-1.5 text-left transition-all duration-150 ease-in-out",
                    i === cursor ? "bg-indigo-50" : "bg-white hover:bg-slate-50",
                  ].join(" ")}
                >
                  <span className="truncate text-[13px] text-slate-900">{s.name}</span>
                  {s.fromShift && (
                    <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600">
                      この日に枠あり
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] font-medium text-slate-500">
                    {s.customerName ?? ""}
                  </span>
                </button>
              </li>
            ))}
            {choices !== null && matches.length === 0 && (
              <li className="px-2 py-1.5 text-[13px] text-slate-500">
                該当する現場がありません。現場マスタに無い現場は、先に「現場を追加」で作ってください
              </li>
            )}
          </ul>
        )}

        {picked && timeNote && (
          <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] text-slate-600">
            {timeNote}
          </div>
        )}

        {/* 🔴 24時以降も入れられる（「現場を追加」と同じ。上限 29:59） */}
        <div className="mt-2 flex flex-wrap items-end gap-2">
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
            <span className="text-[11px] font-medium text-slate-500">休憩（分）</span>
            <input
              type="number"
              min={0}
              step={5}
              value={breakMin}
              onChange={(e) => setBreakMin(Number(e.target.value))}
              className={FIELD + " w-16 text-right font-mono"}
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
            disabled={!canSubmit}
            onClick={submit}
            className={[
              BTN,
              canSubmit
                ? "cursor-pointer border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
                : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400",
            ].join(" ")}
          >
            {pending ? "保存中…" : "保存する"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={BTN + " cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}
          >
            やめる
          </button>
        </div>
      </div>
    </div>
  );
}

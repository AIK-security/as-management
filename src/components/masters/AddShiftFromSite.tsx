// 現場詳細から枠を作る（2026-09-09）。
//
// 🔴 なぜここにも要るのか（柴山の要望）
//   これまで枠を作れるのは配置ボードだけだった。現場を登録した直後に
//   「では稼働日を入れよう」となるのに、**いったん配置ボードへ移り、
//   日付を合わせ、現場を検索し直す**必要があった。現場が目の前にあるのに遠回り。
//
// 🔴 現場は固定。ここで別の現場の枠は作れない（迷いようがない）。
//   時刻・休憩の初期値は、この現場の「予定のひな形」から入る。
//
// ⚠️ 配置ボードの「現場を追加」と同じ Server Action（addShift）を使う。
//   入口が2つでも**作られるものは同じ**にする。
"use client";

import { useState } from "react";
import { addShift } from "@/app/board/actions";
import { addDays, todayInJst } from "@/lib/board-format";
import { TwoDigitInput } from "@/components/TwoDigitInput";
import type { SiteDetail } from "@/lib/masters";
import type { WorkKind } from "@/lib/types";
import { Notice, Section } from "@/components/masters/FormBits";
import { callAction } from "@/lib/action-call";

const FIELD =
  "h-9 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export function AddShiftFromSite({ site }: { site: SiteDetail }) {
  const today = todayInJst();

  const [open, setOpen] = useState(false);
  const [workKind, setWorkKind] = useState<WorkKind>("day");
  // 🔴 現場の「予定のひな形」を初期値にする。無ければ 08:00–17:00
  //   （ひな形が無い現場が実データに存在するため、null を素通りさせない）
  const [startH, setStartH] = useState(site.plan_start_h ?? 8);
  const [startM, setStartM] = useState(site.plan_start_m ?? 0);
  const [endH, setEndH] = useState(site.plan_end_h ?? 17);
  const [endM, setEndM] = useState(site.plan_end_m ?? 0);
  const [breakMin, setBreakMin] = useState(site.plan_break ?? 60);
  const [headcount, setHeadcount] = useState(1);
  const [bandName, setBandName] = useState(site.band_name ?? "");
  const [planComment, setPlanComment] = useState("");
  const [billingNote, setBillingNote] = useState("");

  const [range, setRange] = useState(false);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(addDays(today, 6));
  const [dows, setDows] = useState<boolean[]>([true, true, true, true, true, true, true]);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const targetDates = (() => {
    if (!range) return [dateFrom];
    if (dateTo < dateFrom) return [];
    const out: string[] = [];
    for (let d = dateFrom, i = 0; d <= dateTo && i < 200; d = addDays(d, 1), i++) {
      // 曜日は UTC で読む（"YYYY-MM-DD" は UTC 0時として解釈されるため）
      if (dows[new Date(d + "T00:00:00Z").getUTCDay()]) out.push(d);
    }
    return out;
  })();

  async function submit() {
    setPending(true);
    setError(null);
    setDone(null);
    const r = await callAction(() => addShift({
      siteId: site.id,
      jurisdictionId: site.jurisdiction_id,
      workDates: targetDates,
      workKind,
      startH,
      startM,
      endH,
      endM,
      breakMin,
      headcount,
      bandName,
      planComment,
      billingNote,
    }));
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    if (r.created === 0) {
      setError(
        r.skipped > 0
          ? `すでに同じ枠があるため、${r.skipped}件とも追加しませんでした。`
          : "追加する日がありません。期間と曜日を見直してください。",
      );
      return;
    }
    setDone(
      r.skipped > 0
        ? `${r.created}件を追加しました（${r.skipped}件はすでにあったので飛ばしました）。`
        : `${r.created}件を追加しました。`,
    );
    setOpen(false);
  }

  if (!open) {
    return (
      <Section title="枠を作る" hint="この現場の稼働日を立てる">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700"
          >
            ＋ この現場の枠を作る
          </button>
          {done && (
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[13px] text-emerald-700">
              {done}
            </span>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Section title="枠を作る" hint="この現場の稼働日を立てる">
      {/* ── 日付 ── */}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-500">日付</span>
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            {[
              { v: false, label: "1日だけ" },
              { v: true, label: "期間で作る" },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setRange(o.v)}
                className={[
                  "px-2.5 py-1 text-[13px] font-semibold transition-all duration-150 ease-in-out",
                  range === o.v
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={FIELD}
          />
          {range && (
            <>
              <span className="text-slate-400">〜</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={FIELD}
              />
            </>
          )}
        </div>

        {range && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              {["日", "月", "火", "水", "木", "金", "土"].map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDows(dows.map((d, j) => (i === j ? !d : d)))}
                  className={[
                    "w-8 py-1 text-[13px] font-semibold transition-all duration-150 ease-in-out",
                    dows[i]
                      ? "bg-slate-700 text-white"
                      : "bg-white text-slate-400 hover:bg-slate-100",
                    i === 0 && dows[i] ? "bg-rose-600" : "",
                    i === 6 && dows[i] ? "bg-sky-600" : "",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDows([false, true, true, true, true, true, false])}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
            >
              平日だけ
            </button>
            <span className="ml-auto text-[13px] font-semibold text-slate-700">
              {targetDates.length} 件ぶん
            </span>
          </div>
        )}
      </div>

      {/* ── 中身 ── */}
      <div className="mt-2 flex flex-wrap items-end gap-2">
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
          </select>
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-slate-500">開始</span>
          <div className="flex items-center gap-1">
            <TwoDigitInput value={startH} onChange={setStartH} max={23} />
            <span className="text-slate-400">:</span>
            <TwoDigitInput value={startM} onChange={setStartM} max={59} />
          </div>
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-slate-500">終了</span>
          <div className="flex items-center gap-1">
            <TwoDigitInput value={endH} onChange={setEndH} max={23} />
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

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-slate-500">班名</span>
          <input
            value={bandName}
            onChange={(e) => setBandName(e.target.value)}
            className={FIELD + " w-24"}
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
        <div className="mt-2">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={pending || targetDates.length === 0}
          onClick={submit}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending ? "追加中…" : range ? `${targetDates.length}件を追加する` : "追加する"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          やめる
        </button>
      </div>
    </Section>
  );
}

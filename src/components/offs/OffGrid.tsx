// S-08 休み管理のグリッド（2026-09-16）。
//
// 🔴 行＝隊員 / 列＝日 の月表。配置ボードは1日、A表は1週しか映さないため、
//   「来月のどこに休みが集まっているか」を見る場所がどこにも無かった。
//
// 🔴 入力は「塗る」形にした。
//   上で**入れるもの**を1つ選び、あとはセルを押していくだけ。
//   セルごとにメニューを開く形も考えたが、有給や公休は
//   「1人の何日分か」「同じ日に何人か」をまとめて入れる作業で、
//   1セルにつき2クリック増えるのは割に合わない。
//
// 🔴 楽観更新を入れない（A表・2026-09-15 の決定6と同じ）。
//   画面の更新規則が増えるほど1名体制では読めなくなる。
//   代わりに**押している間そのセルを沈める**ので、無反応には見えない。
//
// 🔴 色は増やさない（1色1意味）。休みはすべて slate 系で、区別は文字で付ける。
//   amber＝未完了・rose＝足りない/入れてはいけない、をここで使うと意味が濁る。
//   例外は**配置と休みが同じ日に立っている**とき ── これは事故なので rose を使う。
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { setOff } from "@/app/offs/actions";
import { callAction } from "@/lib/action-call";
import { dayOfWeek, dayTone } from "@/lib/board-format";
import type { OffEntry, OffMonthRow } from "@/lib/offs";
import type { OffKind, OffWorkKind } from "@/lib/types";

/** 休みの1文字表記。セルが 26px しかないため名前は入らない */
const OFF_MARK: Record<OffKind, string> = {
  paid_leave: "有",
  day_off: "休",
  training: "研",
  medical: "健",
  absent_self: "自",
  absent_company: "会",
  night_duty: "宿",
  substitute_holiday: "振",
  control: "管",
  office: "内",
  standby: "待",
};

const WORK_MARK: Record<OffWorkKind, string> = { day: "日", nightA: "A", nightB: "B" };

type Paint = {
  key: string;
  label: string;
  offKind: OffKind | null;
  offWorkKind: OffWorkKind | null;
};

// 🔴 第1弾はここに出す6つだけ。研修・内勤などの区分は DB にはあるが、
//   まず「休み」を入れられるようにするのが目的なので増やさない。
const PAINTS: Paint[] = [
  { key: "paid_leave", label: "有給", offKind: "paid_leave", offWorkKind: null },
  { key: "day_off", label: "休み", offKind: "day_off", offWorkKind: null },
  { key: "off_day", label: "日勤のみ休み", offKind: "day_off", offWorkKind: "day" },
  { key: "off_nightA", label: "夜Aのみ休み", offKind: "day_off", offWorkKind: "nightA" },
  { key: "off_nightB", label: "夜Bのみ休み", offKind: "day_off", offWorkKind: "nightB" },
  { key: "clear", label: "消す", offKind: null, offWorkKind: null },
];

const WEEK_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

/** セルに出す文字。終日は1文字、一部勤務可は休む区分を並べる */
function cellMark(entries: OffEntry[]): { text: string; full: boolean } {
  if (entries.length === 0) return { text: "", full: false };
  const full = entries.find((e) => e.offWorkKind === null);
  if (full) return { text: OFF_MARK[full.offKind], full: true };
  return {
    text: entries
      .map((e) => (e.offWorkKind ? WORK_MARK[e.offWorkKind] : ""))
      .filter(Boolean)
      .join(""),
    full: false,
  };
}

export function OffGrid({
  month,
  dates,
  rows,
  editable,
}: {
  month: string;
  dates: string[];
  rows: OffMonthRow[];
  editable: boolean;
}) {
  const [paint, setPaint] = useState<Paint>(PAINTS[0]);
  const [query, setQuery] = useState("");
  const [onlyOff, setOnlyOff] = useState(false);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 🔴 曜日と地色は board-format.ts の共通ヘルパを使う（2026-09-16）。
  //   週表（S-07）と同じ色でないと、同じ週を見ているのに別物に見える。
  const dows = useMemo(() => dates.map(dayOfWeek), [dates]);

  const visible = useMemo(() => {
    const q = query.trim();
    return rows.filter((r) => {
      if (q && !r.name.includes(q) && !r.shortName.includes(q)) return false;
      if (onlyOff && Object.keys(r.byDate).length === 0) return false;
      return true;
    });
  }, [rows, query, onlyOff]);

  async function paintCell(row: OffMonthRow, date: string) {
    if (!editable) return;
    const key = row.guardId + ":" + date;
    setBusyCell(key);
    setError(null);
    const r = await callAction(() =>
      setOff({
        guardId: row.guardId,
        workDate: date,
        offKind: paint.offKind,
        offWorkKind: paint.offWorkKind,
      }),
    );
    setBusyCell(null);
    if (!r.ok) setError(r.message);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── 入れるものを選ぶ ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-slate-200 bg-white px-4 py-2">
        {editable && (
          <>
            <span className="t-meta shrink-0 text-slate-500">入れるもの</span>
            <div className="flex shrink-0 flex-wrap gap-1">
              {PAINTS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPaint(p)}
                  className={[
                    "shrink-0 cursor-pointer rounded-md border px-2 py-1 text-[13px] font-semibold whitespace-nowrap",
                    "transition-all duration-150 ease-in-out",
                    paint.key === p.key
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100",
                  ].join(" ")}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="t-meta shrink-0 text-slate-400">選んでからマスを押す</span>
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="隊員を探す"
            className="h-9 w-40 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
          />
          <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[13px] text-slate-600">
            <input
              type="checkbox"
              checked={onlyOff}
              onChange={(e) => setOnlyOff(e.target.checked)}
            />
            休みのある人だけ
          </label>
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-[13px] text-rose-800">
          {error}
        </div>
      )}

      {/* ── 月表 ── */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 w-[150px] min-w-[150px] border-r border-b border-slate-200 bg-white px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                隊員 <span className="font-normal">（{visible.length}）</span>
              </th>
              {dates.map((d, i) => (
                <th
                  key={d}
                  className={[
                    "sticky top-0 z-20 w-[26px] min-w-[26px] border-r border-b border-slate-200 bg-white px-0 py-1 text-center text-[11px] font-semibold text-slate-500",
                  ].join(" ")}
                >
                  <div className="tabular-nums">{Number(d.slice(8, 10))}</div>
                  <div className="font-normal">{WEEK_LABEL[dows[i]]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const working = new Set(r.workingDates);
              return (
                <tr
                  key={r.guardId}
                  className="transition-all duration-150 ease-in-out hover:bg-slate-50"
                >
                  <th className="sticky left-0 z-10 w-[150px] min-w-[150px] border-r border-b border-slate-100 bg-white px-2 py-1 text-left">
                    <Link
                      href={`/masters/guards/${r.guardId}`}
                      className="block truncate text-[13px] font-medium text-slate-800 transition-all duration-150 ease-in-out hover:text-indigo-700 hover:underline"
                      title={r.name}
                    >
                      {r.name}
                    </Link>
                    {r.isPartner && <span className="t-meta text-slate-400">協力</span>}
                  </th>
                  {dates.map((d) => {
                    const entries = r.byDate[d] ?? [];
                    const { text, full } = cellMark(entries);
                    const key = r.guardId + ":" + d;
                    // 🔴 配置が入っている日に休みが立っている ── 事故なので目立たせる
                    const clash = entries.length > 0 && working.has(d);
                    const label = entries
                      .map(
                        (e) =>
                          OFF_MARK[e.offKind] +
                          (e.offWorkKind ? `（${WORK_MARK[e.offWorkKind]}）` : ""),
                      )
                      .join(" ");
                    return (
                      <td
                        key={d}
                        className={[
                          "w-[26px] min-w-[26px] border-r border-b border-slate-100 p-0 text-center",
                          dayTone(d),
                        ].join(" ")}
                      >
                        <button
                          type="button"
                          disabled={!editable || busyCell === key}
                          onClick={() => paintCell(r, d)}
                          title={
                            clash
                              ? `${d}：配置が入っている日に休みが立っています（${label}）`
                              : entries.length > 0
                                ? `${d}：${label}`
                                : working.has(d)
                                  ? `${d}：配置あり`
                                  : d
                          }
                          className={[
                            "h-[26px] w-full text-[12px] font-bold tabular-nums",
                            "transition-all duration-150 ease-in-out",
                            editable ? "cursor-pointer hover:bg-indigo-100" : "cursor-default",
                            busyCell === key ? "opacity-40" : "",
                            clash
                              ? "bg-rose-100 text-rose-700"
                              : full
                                ? "bg-slate-300 text-slate-800"
                                : text
                                  ? "bg-slate-100 text-slate-700"
                                  : "text-slate-300",
                          ].join(" ")}
                        >
                          {/* 休みが無く配置だけある日は、薄い点で「動いている日」と分かるようにする */}
                          {text || (working.has(d) ? "・" : "")}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={dates.length + 1} className="px-4 py-6 text-[14px] text-slate-500">
                  該当する隊員が居ません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── 凡例 ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 bg-white px-4 py-1.5">
        <span className="t-meta text-slate-500">{month} の休み</span>
        <span className="t-meta text-slate-500">有＝有給 ／ 休＝公休</span>
        <span className="t-meta text-slate-500">日・A・B＝その区分だけ休み（ほかは出られる）</span>
        <span className="t-meta text-slate-500">・＝配置あり</span>
        <span className="t-meta text-rose-600">赤＝配置と休みが同じ日に立っている</span>
      </div>
    </div>
  );
}

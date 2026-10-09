// 日付の見出しそのものを押すとカレンダーが開く（2026-10-09）。
//
// 🔴 なぜ：配置ボードの上に「大きい日付」と「日付の入力欄＋［表示］」の2つが並び、
//   同じ日付が2回出て邪魔・見栄えが悪い（柴山）。→ 見出しの日付を押してカレンダーを開く形にまとめた。
//   ［今日］ボタンも外し、カレンダーの下に置いた。
// 🔴 カレンダーは自前（ブラウザ標準の日付選択は見た目を変えられず、システムの雰囲気に合わない ─ 柴山）。
//   依存パッケージは増やさない（N-1）。月の表を出して、押した日へ移るだけ。
// 🔴 押すと開くことが見て分かるよう、枠付きのボタンにしてカレンダーの絵を付ける（柴山）。
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { todayInJst } from "@/lib/board-format";

/** YYYY-MM-DD の年月日。日付の計算は UTC で行う（JST の暦日をそのまま数として扱う） */
function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** その月の表（日曜はじまり）。前後の月の日は null で埋める */
function monthCells(y: number, m: number): (string | null)[] {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(iso(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function CalendarIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
    </svg>
  );
}

export function DatePickerLabel({
  action,
  name,
  value,
  label,
  keep = {},
}: {
  /** 飛び先のパス（/board など） */
  action: string;
  /** URL に載せる名前（date など） */
  name: string;
  /** いまの日付（YYYY-MM-DD） */
  value: string;
  /** 見出しに出す文字（2026/10/09（金） など） */
  label: string;
  /** 一緒に引き継ぐ条件（管轄・日勤夜勤 など） */
  keep?: Record<string, string>;
}) {
  const router = useRouter();
  const wrap = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const { y, m } = parts(value);
    return { y, m };
  });
  const today = todayInJst();

  // 外を押す・Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    // 開くたびに、いま見ている日の月から始める
    if (!open) setView({ y: parts(value).y, m: parts(value).m });
    setOpen(!open);
  }

  function go(d: string) {
    setOpen(false);
    if (d === value) return;
    router.push(`${action}?${new URLSearchParams({ ...keep, [name]: d }).toString()}`);
  }

  function shiftMonth(n: number) {
    const t = new Date(Date.UTC(view.y, view.m - 1 + n, 1));
    setView({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 });
  }

  const navBtn =
    "flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800";

  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="押すとカレンダーが開きます"
        className={[
          "flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[18px] font-bold tracking-tight whitespace-nowrap text-slate-900 tabular-nums transition-all duration-150 ease-in-out",
          open ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-slate-300 hover:bg-slate-50",
        ].join(" ")}
      >
        <CalendarIcon />
        {label}
        <span aria-hidden className="text-[11px] font-normal text-slate-400">
          ▼
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="日付を選ぶ"
          className="absolute top-full left-0 z-50 mt-1 w-[252px] rounded-lg border border-slate-200 bg-white p-2 shadow-md"
        >
          <div className="mb-1 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className={navBtn} aria-label="前の月">
              ‹
            </button>
            <span className="text-[14px] font-semibold tracking-tight text-slate-900 tabular-nums">
              {view.y}年{view.m}月
            </span>
            <button type="button" onClick={() => shiftMonth(1)} className={navBtn} aria-label="次の月">
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-[11px] font-medium">
            {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
              <span
                key={w}
                className={["py-1", i === 0 ? "text-rose-600" : i === 6 ? "text-indigo-600" : "text-slate-500"].join(" ")}
              >
                {w}
              </span>
            ))}
            {monthCells(view.y, view.m).map((d, i) => {
              if (!d) return <span key={`e${i}`} />;
              const dow = i % 7;
              const selected = d === value;
              const isToday = d === today;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => go(d)}
                  className={[
                    "mx-auto my-0.5 flex h-8 w-8 items-center justify-center rounded-md text-[13px] tabular-nums transition-all duration-150 ease-in-out",
                    selected
                      ? "bg-indigo-600 font-semibold text-white hover:bg-indigo-700"
                      : [
                          "hover:bg-slate-100",
                          dow === 0 ? "text-rose-600" : dow === 6 ? "text-indigo-600" : "text-slate-800",
                          isToday ? "font-semibold ring-1 ring-indigo-400 ring-inset" : "",
                        ].join(" "),
                  ].join(" ")}
                >
                  {parts(d).d}
                </button>
              );
            })}
          </div>

          <div className="mt-1 flex justify-end border-t border-slate-100 pt-1.5">
            <button
              type="button"
              onClick={() => go(today)}
              className="rounded-md px-2 py-1 text-[13px] font-medium text-indigo-700 transition-all duration-150 ease-in-out hover:bg-indigo-50"
            >
              今日
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

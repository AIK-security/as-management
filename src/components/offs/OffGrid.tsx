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
// 🔴 2026-10-01：半月ずつ表示・言葉で書く・あかさたなで飛ぶ、に変えた。
//   管制から「マス・文字が小さい」「目的の人が探しにくい」と言われたため。
//   1か月を 26px のマスに詰め、1文字の記号で書いていたのをやめた（半月の切り替えは page.tsx）。
//
// 🔴 色は増やさない（1色1意味）。休みはすべて slate 系で、区別は文字で付ける。
//   amber＝未完了・rose＝足りない/入れてはいけない、をここで使うと意味が濁る。
//   例外は**配置と休みが同じ日に立っている**とき ── これは事故なので rose を使う。
"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { setOff } from "@/app/offs/actions";
import { callAction } from "@/lib/action-call";
import { dayOfWeek } from "@/lib/board-format";
import type { OffEntry, OffMonthRow } from "@/lib/offs";
import type { OffKind, OffWorkKind } from "@/lib/types";

/** マスに書く休みの名前。マスが約 60px なので2文字に揃える */
const OFF_WORD: Record<OffKind, string> = {
  paid_leave: "有給",
  day_off: "休み",
  training: "研修",
  medical: "健診",
  absent_self: "自欠",
  absent_company: "会欠",
  night_duty: "宿直",
  substitute_holiday: "振休",
  control: "管制",
  office: "内勤",
  standby: "待機",
};

/** 一部勤務可で「休む区分」。1つなら言葉で、2つ以上なら1文字ずつ並べる */
const WORK_WORD: Record<OffWorkKind, string> = {
  day: "日勤",
  nightA: "夜A",
  nightB: "夜B",
};
const WORK_MARK: Record<OffWorkKind, string> = {
  day: "日",
  nightA: "A",
  nightB: "B",
};

/** あかさたなの見出し。フリガナの頭文字（カタカナ）の範囲で決める */
const KANA_ROWS: { label: string; to: number }[] = [
  { label: "あ", to: 0x30aa }, // ァ〜オ
  { label: "か", to: 0x30b4 }, // カ〜ゴ
  { label: "さ", to: 0x30be }, // サ〜ゾ
  { label: "た", to: 0x30c9 }, // タ〜ド
  { label: "な", to: 0x30ce }, // ナ〜ノ
  { label: "は", to: 0x30dd }, // ハ〜ポ
  { label: "ま", to: 0x30e2 }, // マ〜モ
  { label: "や", to: 0x30e8 }, // ャ〜ヨ
  { label: "ら", to: 0x30ed }, // ラ〜ロ
  { label: "わ", to: 0x30f4 }, // ヮ〜ン・ヴ
];
const KANA_OTHER = "他";

/** フリガナ → あかさたなの見出し。🔴 半角カナ・ひらがなでも同じ行に入るよう揃えてから見る */
function kanaRow(kana: string | null): string {
  const head = kana?.normalize("NFKC").charAt(0);
  if (!head) return KANA_OTHER;
  let code = head.charCodeAt(0);
  if (code >= 0x3041 && code <= 0x3096) code += 0x60; // ひらがな → カタカナ
  if (code < 0x30a1) return KANA_OTHER;
  return KANA_ROWS.find((r) => code <= r.to)?.label ?? KANA_OTHER;
}

type Paint = {
  key: string;
  label: string;
  offKind: OffKind | null;
  offWorkKind: OffWorkKind | null;
};

// 🔴 第1弾はまず「休み」を入れられるようにした（9/16）。
//   10/8：A表の下段の4つ（研修・健康診断・管制・振替休日）も入れられるようにした。
//   A表にいつも欄があるのに、入れる手段が無かった（柴山）。並びは「休み」の後ろに「業務外」でまとめる
const PAINTS: Paint[] = [
  {
    key: "paid_leave",
    label: "有給",
    offKind: "paid_leave",
    offWorkKind: null,
  },
  { key: "day_off", label: "休み", offKind: "day_off", offWorkKind: null },
  {
    key: "off_day",
    label: "日勤のみ休み",
    offKind: "day_off",
    offWorkKind: "day",
  },
  {
    key: "off_nightA",
    label: "夜Aのみ休み",
    offKind: "day_off",
    offWorkKind: "nightA",
  },
  {
    key: "off_nightB",
    label: "夜Bのみ休み",
    offKind: "day_off",
    offWorkKind: "nightB",
  },
  { key: "training", label: "研修", offKind: "training", offWorkKind: null },
  { key: "medical", label: "健康診断", offKind: "medical", offWorkKind: null },
  { key: "control", label: "管制", offKind: "control", offWorkKind: null },
  { key: "substitute_holiday", label: "振替休日", offKind: "substitute_holiday", offWorkKind: null },
  { key: "clear", label: "消す", offKind: null, offWorkKind: null },
];

/** ここから先が「業務外」（見出しを挟んで分ける） */
const FIRST_NON_LEAVE = "training";

const WEEK_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

// 🔴 列の地色は土日だけ（2026-10-01・柴山の選択）。
//   週表と同じ dayTone（1日おきの縞）を使っていたが、縞は曜日で決まるため
//   週をまたいで日付が続くこの画面では**日曜と月曜が同じ色で並ぶ**。
//   休みは曜日で見ることが多いので、縞をやめて暦に意味を持たせた。
//   日曜の薄い赤は面積の大きい地色にだけ使い、「配置と重なり」の赤（濃い地・白文字）とは濃さで分ける。
const DOW_TONE: Record<number, string> = { 0: "bg-rose-50", 6: "bg-sky-50" };
const DOW_TEXT: Record<number, string> = {
  0: "text-rose-600",
  6: "text-sky-700",
};

/** セルに出す文字。終日は休みの名前、一部勤務可は「休む区分＋休」 */
function cellMark(entries: OffEntry[]): { text: string; full: boolean } {
  if (entries.length === 0) return { text: "", full: false };
  const full = entries.find((e) => e.offWorkKind === null);
  if (full) return { text: OFF_WORD[full.offKind], full: true };
  const kinds = entries.flatMap((e) => (e.offWorkKind ? [e.offWorkKind] : []));
  return {
    text:
      kinds.length === 1
        ? WORK_WORD[kinds[0]] + "休"
        : kinds.map((k) => WORK_MARK[k]).join("") + "休",
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);

  // 曜日は board-format.ts の共通ヘルパで出す。
  // 🔴 地色は 2026-10-01 に週表（dayTone の縞）と分けた ─ 理由は DOW_TONE の注記
  const dows = useMemo(() => dates.map(dayOfWeek), [dates]);

  const visible = useMemo(() => {
    const q = query.trim();
    return rows.filter((r) => {
      if (q && !r.name.includes(q) && !r.shortName.includes(q)) return false;
      if (onlyOff && Object.keys(r.byDate).length === 0) return false;
      return true;
    });
  }, [rows, query, onlyOff]);

  // あかさたなの各行で、表示中の最初の隊員。無い行のボタンは押せなくする
  const firstOfRow = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of visible) {
      const k = kanaRow(r.nameKana);
      if (!m.has(k)) m.set(k, r.guardId);
    }
    return m;
  }, [visible]);

  /** 🔴 scrollIntoView は使わない ─ 上に貼りついた日付の行の下に隠れてしまう */
  function jumpTo(label: string) {
    const guardId = firstOfRow.get(label);
    const box = scrollRef.current;
    const row = guardId
      ? box?.querySelector(`[data-guard="${guardId}"]`)
      : null;
    if (!box || !row) return;
    const headH = headRef.current?.getBoundingClientRect().height ?? 0;
    box.scrollTop +=
      row.getBoundingClientRect().top - box.getBoundingClientRect().top - headH;
  }

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
                <Fragment key={p.key}>
                {p.key === FIRST_NON_LEAVE && (
                  <span className="t-meta ml-2 self-center text-slate-400">業務外</span>
                )}
                {p.key === "clear" && <span className="ml-2" />}
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
                </Fragment>
              ))}
            </div>
            <span className="t-meta shrink-0 text-slate-400">
              選んでからマスを押す
            </span>
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

      <div className="flex min-h-0 flex-1">
        {/* ── あかさたなで飛ぶ ──
            🔴 表の左に縦に置く（2026-10-01・柴山の指摘）。上に横帯で置くと
            操作の帯が2段になり、表が下に押される。辞書の索引と同じ位置に置く */}
        <nav
          aria-label="フリガナで飛ぶ"
          className="flex shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-slate-200 bg-white px-1 py-1"
        >
          {[...KANA_ROWS.map((r) => r.label), KANA_OTHER].map((label) => {
            const has = firstOfRow.has(label);
            return (
              <button
                key={label}
                type="button"
                disabled={!has}
                onClick={() => jumpTo(label)}
                title={
                  has ? `「${label}」行へ` : `「${label}」行の隊員はいません`
                }
                className={[
                  "h-7 w-7 shrink-0 rounded-md text-[14px] font-semibold",
                  "transition-all duration-150 ease-in-out",
                  has
                    ? "cursor-pointer text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                    : "cursor-default text-slate-300",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {/* ── 半月の表 ──
            表は画面幅いっぱいに広げ、余りは日付の列に配る（最小 60px）。
            幅を固定すると広い画面で右側が空く（2026-10-01 の指摘） */}
        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead ref={headRef}>
              <tr>
                <th className="sticky top-0 left-0 z-30 w-[150px] min-w-[150px] border-r border-b border-slate-200 bg-white px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  隊員 <span className="font-normal">（{visible.length}）</span>
                </th>
                {dates.map((d, i) => (
                  <th
                    key={d}
                    className={[
                      "sticky top-0 z-20 min-w-[60px] border-r border-b border-slate-200 px-0 py-1 text-center text-[13px] font-semibold",
                      // 見出しは地色を不透明にする（下の行が透けないように）
                      dows[i] === 0
                        ? "bg-rose-50"
                        : dows[i] === 6
                          ? "bg-sky-50"
                          : "bg-white",
                      DOW_TEXT[dows[i]] ?? "text-slate-600",
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
                    data-guard={r.guardId}
                    className="transition-all duration-150 ease-in-out hover:bg-slate-50"
                  >
                    <th className="sticky left-0 z-10 w-[150px] min-w-[150px] border-r border-b border-slate-100 bg-white px-2 py-1 text-left">
                      <Link
                        href={`/masters/guards/${r.guardId}`}
                        className="block truncate text-[14px] font-medium text-slate-800 transition-all duration-150 ease-in-out hover:text-indigo-700 hover:underline"
                        title={r.name}
                      >
                        {r.name}
                      </Link>
                      {r.isPartner && (
                        <span className="t-meta text-slate-400">協力</span>
                      )}
                    </th>
                    {dates.map((d, i) => {
                      const entries = r.byDate[d] ?? [];
                      const { text, full } = cellMark(entries);
                      const key = r.guardId + ":" + d;
                      // 🔴 配置が入っている日に休みが立っている ── 事故なので目立たせる
                      const clash = entries.length > 0 && working.has(d);
                      const label = entries
                        .map(
                          (e) =>
                            OFF_WORD[e.offKind] +
                            (e.offWorkKind
                              ? `（${WORK_WORD[e.offWorkKind]}のみ）`
                              : ""),
                        )
                        .join(" ");
                      return (
                        <td
                          key={d}
                          className={[
                            "min-w-[60px] border-r border-b border-slate-100 p-0 text-center",
                            DOW_TONE[dows[i]] ?? "",
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
                              "h-9 w-full text-[14px] font-bold whitespace-nowrap",
                              "transition-all duration-150 ease-in-out",
                              // 🔴 濃い地のマスに薄い indigo を重ねると白文字が読めなくなるため、
                              //   ホバーは空きマスだけ色を変え、埋まったマスは少し薄くするだけにする
                              !editable
                                ? "cursor-default"
                                : text
                                  ? "cursor-pointer hover:opacity-80"
                                  : "cursor-pointer hover:bg-indigo-100",
                              busyCell === key ? "opacity-40" : "",
                              // 🔴 濃淡を強めた（2026-10-01・柴山の選択）。色の意味は増やさず灰のまま
                              clash
                                ? "bg-rose-600 text-white"
                                : full
                                  ? "bg-slate-600 text-white"
                                  : text
                                    ? "bg-slate-300 text-slate-900"
                                    : "text-slate-300",
                            ].join(" ")}
                          >
                            {/* 休みが無く配置だけある日は、薄い文字で「動いている日」と分かるようにする */}
                            {text ||
                              (working.has(d) ? (
                                <span className="text-[12px] font-normal text-slate-400">
                                  配置
                                </span>
                              ) : (
                                ""
                              ))}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={dates.length + 1}
                    className="px-4 py-6 text-[14px] text-slate-500"
                  >
                    該当する隊員が居ません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 凡例 ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 bg-white px-4 py-1.5">
        <span className="t-meta text-slate-500">{month} の休み</span>
        <span className="t-meta text-slate-500">
          濃い灰＝終日休み ／ 薄い灰＝一部だけ休み
        </span>
        <span className="t-meta text-slate-500">
          日勤休・夜A休・夜B休＝その区分だけ休み（ほかは出られる）
        </span>
        <span className="t-meta text-slate-500">配置＝配置が入っている日</span>
        <span className="t-meta text-rose-600">
          赤＝配置と休みが同じ日に立っている
        </span>
      </div>
    </div>
  );
}

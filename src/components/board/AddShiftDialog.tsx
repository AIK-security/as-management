// 「現場を追加」＝ その日の盤面に枠を1つ足す（2026-09-07）
//
// 🔴 ここは第1弾でいちばん効く導線。
//   AIK assign が使われなくなった大きな原因が
//   「忙しい中、案件をいちいち作るのが面倒」だった（2026-09-07・管制）。
//   したがって**速さが仕様**。設計は3点に絞ってある。
//
//   1. 開いたら**すぐ打てる**（検索欄にフォーカス。押す場所を探させない）
//   2. 現場を選んだら**時刻・休憩が自動で入る**（sites の plan_* がひな形）
//   3. 見つからないときだけ「新しい現場として追加」になる
//
// 🔴 window.confirm / prompt は使わない（2026-09-04 決定）。
//   Chrome の「これ以上ダイアログを表示しない」が効くと**無反応**になる。
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addShift } from "@/app/board/actions";
import { TwoDigitInput } from "@/components/TwoDigitInput";
import { addDays } from "@/lib/board-format";
import type { BoardShiftGroup, SitePick } from "@/lib/board";
import type { WorkKind } from "@/lib/types";
import { callAction } from "@/lib/action-call";

const BTN =
  "rounded-md border-2 px-3 py-1.5 text-[14px] font-semibold transition-all duration-150 ease-in-out";
const FIELD =
  "h-9 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

/** 候補は8件まで。全件出すとスクロールが要る＝速さが落ちる */
const MAX_SUGGESTIONS = 8;


export function AddShiftDialog({
  workDate,
  jurisdictionId,
  group,
  sitePicks,
  customerPicks,
}: {
  workDate: string;
  jurisdictionId: string;
  group: BoardShiftGroup;
  sitePicks: SitePick[];
  customerPicks: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<SitePick | null>(null);
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 勤務区分の既定は**いま見ているペイン**に合わせる。
  // 日勤を見ているのに夜勤の枠ができると、作った直後に画面から消える。
  const [workKind, setWorkKind] = useState<WorkKind>(group === "day" ? "day" : "nightA");
  const [startH, setStartH] = useState(8);
  const [startM, setStartM] = useState(0);
  const [endH, setEndH] = useState(17);
  const [endM, setEndM] = useState(0);
  const [breakMin, setBreakMin] = useState(60);
  const [headcount, setHeadcount] = useState(1);
  // 🔴 2026-09-09 追加。現行の入力UI（`管制雛形` D〜U列）にあって無かった項目。
  //   これが無いと、作った枠を直すのにマスタまで行くしかなかった。
  const [bandName, setBandName] = useState("");
  const [planComment, setPlanComment] = useState("");
  const [billingNote, setBillingNote] = useState("");

  // 🔴 日付は「この日だけ」と「期間」を選べる（2026-09-09・柴山の指摘）。
  //   毎日ある現場を1か月ぶん立てるのに、同じ入力を30回くり返していた。
  //   A表が週表であることからも、枠は期間で立つほうが業務に近い。
  const [range, setRange] = useState(false);
  // 🔴 null = まだ触っていない。**表示している日から導く**。
  //   state に初期値を焼き付けると、日付を送ってから開いたときに前の日が残る
  //   （effect で上書きする手もあるが、描画のたびに state を書くことになる）。
  const [dateFromInput, setDateFrom] = useState<string | null>(null);
  const [dateToInput, setDateTo] = useState<string | null>(null);
  const dateFrom = dateFromInput ?? workDate;
  const dateTo = dateToInput ?? addDays(workDate, 6);
  // 曜日の絞り込み。0=日 … 6=土。既定は全部
  const [dows, setDows] = useState<boolean[]>([true, true, true, true, true, true, true]);

  // 実際に作る日付。期間なら曜日で絞る
  const targetDates = (() => {
    if (!range) return [workDate];
    if (dateTo < dateFrom) return [];
    const out: string[] = [];
    // 上限を切る。指定ミスで何百件も作らせない
    for (let d = dateFrom, i = 0; d <= dateTo && i < 200; d = addDays(d, 1), i++) {
      // 🔴 曜日は UTC で読む。`new Date("2026-09-09")` は UTC 0時なので、
      //   getDay() だと JST では前日扱いになりうる（board 側と同じ落とし穴）。
      if (dows[new Date(d + "T00:00:00Z").getUTCDay()]) out.push(d);
    }
    return out;
  })();
  // 新規現場のときだけ使う。既存現場は現場マスタ側が得意先を持っている
  const [customerId, setCustomerId] = useState("");

  const searchRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const matches = query.trim()
    ? sitePicks
        .filter((s) => (s.name + s.short_name + (s.customerName ?? "")).includes(query.trim()))
        .slice(0, MAX_SUGGESTIONS)
    : sitePicks.slice(0, MAX_SUGGESTIONS);

  function choose(site: SitePick) {
    setPicked(site);
    setQuery(site.name);
    // 🔴 ひな形があるものだけ上書きする。無い現場で 0 時に潰さない
    if (site.plan_start_h !== null) setStartH(site.plan_start_h);
    if (site.plan_start_m !== null) setStartM(site.plan_start_m);
    if (site.plan_end_h !== null) setEndH(site.plan_end_h);
    if (site.plan_end_m !== null) setEndM(site.plan_end_m);
    if (site.plan_break !== null) setBreakMin(site.plan_break);
    // 班名も現場マスタの既定値を入れる（現行の入力UIと同じ挙動）
    setBandName(site.band_name ?? "");
  }

  function reset() {
    setOpen(false);
    setQuery("");
    setPicked(null);
    setCursor(0);
    setCustomerId("");
    setError(null);
    setDateFrom(null);
    setDateTo(null);
  }

  async function submit() {
    setPending(true);
    setError(null);
    const result = await callAction(() => addShift({
      siteId: picked?.id,
      newSiteName: picked ? undefined : query.trim(),
      newSiteCustomerId: picked ? undefined : customerId || undefined,
      jurisdictionId,
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
    if (!result.ok) {
      setError(result.message ?? "追加できませんでした。");
      return;
    }
    // 🔴 1件も作られなかったときは画面を動かさずに理由を出す。
    //   黙って閉じると「押したのに増えない」に見える。
    if (result.created === 0) {
      setError(
        result.skipped > 0
          ? `すでに同じ枠があるため、${result.skipped}件とも追加しませんでした。`
          : "追加する日がありません。期間と曜日を見直してください。",
      );
      return;
    }

    // 🔴 追加した枠が**必ず見える**ところへ画面を動かす（2026-09-07）。
    //   得意先タブで絞っていると、別の得意先（新規現場なら得意先なし）の枠は
    //   絞り込みの外に落ちて**画面に出ない**。作ったのに出てこないと
    //   「壊れている」と読まれる ─ 実際そう見えた。
    //   ・得意先の絞り込み（c）は外す
    //   ・日勤／夜勤のペインは、いま作った勤務区分のほうへ合わせる
    const q = new URLSearchParams(searchParams.toString());
    q.delete("c");
    q.set("group", workKind === "day" ? "day" : "night");
    reset();
    router.push(pathname + "?" + q.toString());
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={BTN + " cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}
      >
        ＋ 現場を追加
      </button>
    );
  }

  // 🔴 作る日が0件のときは押させない（期間の指定ミス・全曜日オフ）
  const canSubmit =
    (picked !== null || query.trim().length > 0) && !pending && targetDates.length > 0;

  return (
    <div className="relative">
      <button type="button" className={BTN + " border-indigo-600 bg-indigo-600 text-white"}>
        ＋ 現場を追加
      </button>

      {/* 🔴 画面の中に出す。ブラウザのダイアログは使わない */}
      <div className="absolute right-0 top-full z-30 mt-1 w-[420px] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] font-semibold text-slate-900">現場を追加</span>
          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            閉じる（Esc）
          </button>
        </div>

        <input
          ref={searchRef}
          value={query}
          placeholder="現場名で検索。無ければそのまま新規に作れます"
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            // 🔴 IME の変換中はキーを拾わない（2026-09-04 決定）。
            //   現場名は日本語で打つので、変換の Enter で確定してしまう
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") {
              e.preventDefault();
              reset();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (matches[cursor]) choose(matches[cursor]);
            }
          }}
          className={FIELD + " w-full"}
        />

        {!picked && (
          <ul className="mt-1 max-h-44 overflow-y-auto rounded-md border border-slate-200">
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
                  <span className="ml-auto shrink-0 text-[11px] font-medium text-slate-500">
                    {s.customerName ?? "（得意先が未設定）"}
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-2 py-1.5 text-[13px] text-slate-500">
                該当なし。
                <span className="font-semibold text-slate-800">「{query}」</span>
                を新しい現場として追加します
              </li>
            )}
          </ul>
        )}

        {picked && (
          <div className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[12px] text-emerald-800">
            既存の現場：{picked.name}（時刻はこの現場の予定から入れました）
          </div>
        )}

        {/* 🔴 得意先は**新規現場のときだけ**聞く（2026-09-07）。
            既存現場は現場マスタが得意先を持っているので、ここで聞くと
            「どちらが本当か」が二重になる。
            🔴 得意先そのものの新規作成はしない ─ ShiftMax 由来のマスタで、
            請求（第2弾）の突き合わせに使うため、勝手に増やすと合わなくなる。 */}
        {!picked && (
          <label className="mt-2 flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">
              得意先（新しい現場に設定します）
            </span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={FIELD + " w-full"}
            >
              <option value="">（あとで設定する）</option>
              {customerPicks.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* ── 日付（2026-09-09 追加） ────────────────────────
            🔴 これまで「表示している日」に1件だけ作る作りだった。
               毎日ある現場を月ぶん立てるのに同じ入力を30回くり返すことになる。 */}
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-500">日付</span>
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              {[
                { v: false, label: "この日だけ" },
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
            {!range && (
              <span className="font-mono text-[14px] tabular-nums text-slate-700">{workDate}</span>
            )}
          </div>

          {range && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={FIELD}
              />
              <span className="text-slate-400">〜</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={FIELD}
              />

              {/* 曜日。休工日を外して立てるのに要る */}
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

              {/* 🔴 何件できるのかを押す前に出す。数百件を黙って作らせない */}
              <span className="ml-auto text-[13px] font-semibold text-slate-700">
                {targetDates.length} 件ぶん
              </span>
            </div>
          )}
        </div>

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

        {/* 🔴 予定コメントと請求備考は手入力（現場マスタには無い）。
            予定コメントは集合場所など、請求備考は第2弾（請求）で使う。
            どちらも投入CSV 18列に含まれる（14・18列目）。 */}
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
            disabled={!canSubmit}
            onClick={submit}
            className={[
              BTN,
              canSubmit
                ? "cursor-pointer border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
                : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400",
            ].join(" ")}
          >
            {pending
              ? "追加中…"
              : range
                ? `${targetDates.length}件を追加する`
                : "追加する"}
          </button>
          <button
            type="button"
            onClick={reset}
            className={BTN + " cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}
          >
            キャンセル
          </button>
          <span className="ml-auto text-[11px] text-slate-500">仮組みとして追加されます</span>
        </div>
      </div>
    </div>
  );
}

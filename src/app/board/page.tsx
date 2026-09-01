// S-01 配置ボード（段1：表示のみ）
//
// 設計は docs/screen-design.md §2。
// **1画面 = 1日 × 1管轄 × 日勤/夜勤。** ShiftMax（べんり君）の入力単位と揃えてある。
//
// 🔴 段1 では D&D も確定操作も入れない。**まず人に見せて方向性を確かめる**のが目的
//    （screen-design.md §9 段1／schedule-plan.md §5 定着施策0）。
//    AIK assign は完成させてから不一致に気づいた。同じ轍を踏まない。

import { ShiftRowCard } from "@/components/board/ShiftRowCard";
import { PoolPlate } from "@/components/board/Plate";
import { COMPANIES } from "@/lib/fixtures/board";
import { formatBoardDate, getBoardData, type BoardShiftGroup } from "@/lib/board";

const partnerCompanyIds = new Set(
  COMPANIES.filter((c) => c.kind === "partner").map((c) => c.id),
);

/** ヘッダの件数表示。数字を大きく、ラベルを小さくして役割の差をつける */
function CountChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "draft" | "confirmed" | "shortage";
}) {
  const toneClass = {
    draft: "border-amber-400 bg-amber-50 text-amber-800",
    confirmed: "border-emerald-400 bg-emerald-50 text-emerald-800",
    shortage:
      value > 0
        ? "border-rose-400 bg-rose-50 text-rose-700"
        : "border-slate-300 bg-white text-slate-500",
  }[tone];

  return (
    <div className={`flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 ${toneClass}`}>
      <span className="t-meta">{label}</span>
      <span className="text-[18px] font-bold tabular-nums">{value}</span>
    </div>
  );
}

/** 右ペインのセクション見出し。帯にして区切りをはっきりさせる */
function PaneHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-baseline justify-between border-b-2 border-slate-300 bg-slate-100 px-3 py-1.5">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-800">{title}</h2>
      <span className="t-meta text-slate-600">{sub}</span>
    </div>
  );
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group } = await searchParams;
  const shiftGroup: BoardShiftGroup = group === "night" ? "night" : "day";
  const board = getBoardData(shiftGroup);

  const offTotal = board.offGroups.reduce((n, g) => n + g.guards.length, 0);
  const lentTotal = board.lentGroups.reduce((n, g) => n + g.guards.length, 0);

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* ══ ヘッダ ═══════════════════════════════════════════ */}
      <header className="flex shrink-0 items-center gap-3 border-b-2 border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800"
            aria-label="前日"
          >
            ◀
          </button>
          <span className="px-1 text-[20px] font-bold tracking-tight text-slate-900 tabular-nums">
            {formatBoardDate(board.date)}
          </span>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800"
            aria-label="翌日"
          >
            ▶
          </button>
        </div>

        <span className="rounded-md border-2 border-slate-300 bg-slate-50 px-2.5 py-1 text-[15px] font-semibold text-slate-800">
          {board.jurisdictionName}
        </span>

        {/* 日勤 / 夜勤 */}
        <div className="flex overflow-hidden rounded-md border-2 border-slate-300">
          {(["day", "night"] as const).map((g) => (
            <a
              key={g}
              href={`/board?group=${g}`}
              className={[
                "px-4 py-1 text-[15px] font-semibold transition-all duration-150 ease-in-out",
                shiftGroup === g
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              {g === "day" ? "日勤" : "夜勤"}
            </a>
          ))}
        </div>

        <div className="ml-3 flex items-center gap-2">
          <CountChip label="仮組み" value={board.counts.draft} tone="draft" />
          <CountChip label="確定" value={board.counts.confirmed} tone="confirmed" />
          <CountChip label="未充足" value={board.counts.shortage} tone="shortage" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border-2 border-slate-300 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
          >
            一括確定
          </button>
          <button
            type="button"
            className="rounded-md border-2 border-slate-300 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
          >
            連絡作成
          </button>
          <button
            type="button"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700"
          >
            べんり君へ引き渡し
          </button>
        </div>
      </header>

      {/* ══ 本体 ═════════════════════════════════════════════ */}
      <div className="flex min-h-0 flex-1">
        {/* ── 左：配置（現場 × 枠） ── */}
        <main className="thin-scroll min-w-0 flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <h1 className="text-[15px] font-semibold tracking-tight text-slate-700">配置</h1>
            <span className="t-meta text-slate-500">
              現場 {board.rows.length} 件 ／ 配置 {board.rows.reduce((n, r) => n + r.plates.length, 0)} 名
            </span>
          </div>

          <div className="space-y-2.5">
            {board.rows.map((row) => (
              <ShiftRowCard key={row.shift.id} row={row} />
            ))}
          </div>

          <button
            type="button"
            className="mt-2.5 w-full rounded-lg border-2 border-dashed border-slate-300 py-3 text-[14px] font-semibold text-slate-400 transition-all duration-150 ease-in-out hover:border-slate-400 hover:bg-white hover:text-slate-600"
          >
            ＋ 現場を追加
          </button>
        </main>

        {/* ── 右：隊員プール ── */}
        <aside className="thin-scroll flex w-[420px] shrink-0 flex-col overflow-y-auto border-l-2 border-slate-300 bg-white">
          <PaneHeading title="隊員プール" sub={`未配置 ${board.pool.length} 名`} />

          <div className="px-3 py-2">
            <input
              type="search"
              placeholder="氏名で検索"
              className="h-10 w-full rounded-md border-2 border-slate-300 px-2.5 text-[14px] transition-all duration-150 ease-in-out outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["自社", "協力会社", "他管轄", "資格あり"].map((f) => (
                <button
                  key={f}
                  type="button"
                  className="t-meta rounded-md border-2 border-slate-300 bg-white px-2 py-1 text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 px-3 pb-3">
            {board.pool.map((guard) => (
              <PoolPlate
                key={guard.id}
                guard={guard}
                isPartner={partnerCompanyIds.has(guard.companyId)}
              />
            ))}
          </div>

          {/* 非現場ステータス */}
          <PaneHeading title="非現場" sub={`${offTotal} 名`} />
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2">
            {board.offGroups.map((g) => (
              <div
                key={g.label}
                className="flex items-baseline justify-between border-b border-slate-200 pb-1"
              >
                <span className="text-[14px] text-slate-700">{g.label}</span>
                <span className="text-[15px] font-bold tabular-nums text-slate-800">
                  {g.guards.length}
                </span>
              </div>
            ))}
          </div>

          {/* 協力会社への貸出。🔴 請求に効くため第1弾から持つ（data-model.md §4-2） */}
          <PaneHeading title="貸出中（協力会社へ）" sub={`${lentTotal} 名`} />
          <div className="px-3 py-2">
            {board.lentGroups.map((g) => (
              <div
                key={`${g.companyName}:${g.siteName}`}
                className="flex items-baseline gap-2 border-b border-slate-200 py-1"
              >
                <span className="text-[14px] font-semibold text-slate-800">{g.companyName}</span>
                <span className="t-meta truncate text-slate-500">{g.siteName}</span>
                <span className="ml-auto text-[15px] font-bold tabular-nums text-slate-800">
                  {g.guards.length}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* ══ 警告 ═════════════════════════════════════════════ */}
      <footer className="thin-scroll max-h-[140px] shrink-0 overflow-y-auto border-t-2 border-slate-300 bg-white px-4 py-2">
        <div className="flex items-baseline gap-3">
          <span className="text-[15px] font-bold text-slate-800">
            ⚠ 要確認 <span className="tabular-nums text-rose-600">{board.warnings.length}</span> 件
          </span>
          <span className="t-meta text-slate-500">
            止めるのは時間帯の重複だけ。NG・資格不足は警告のみで配置できます
          </span>
        </div>
        <ul className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-0.5">
          {board.warnings.map((w, i) => (
            <li key={i} className="flex items-baseline gap-1.5 text-[13px]">
              <span
                className={[
                  "t-badge shrink-0 rounded px-1.5 leading-5",
                  w.kind === "ng"
                    ? "bg-rose-100 text-rose-700"
                    : w.kind === "shortage"
                      ? "bg-slate-200 text-slate-700"
                      : "bg-amber-100 text-amber-800",
                ].join(" ")}
              >
                {w.kind === "ng" ? "NG" : w.kind === "shortage" ? "不足" : "資格"}
              </span>
              <span className="truncate text-slate-700">{w.message}</span>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}

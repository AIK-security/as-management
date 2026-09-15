// S-07 A表（週表）の表そのもの。設計は docs/screen-design.md §7-2-3。
//
// 🔴 第1段階は**表示だけ**。D&D はこの次（§7-2-9 の2）。
//   いまはクライアント JS を一切使わないので、サーバコンポーネントのまま置く。
//
// 🔴 縦の罫線を入れる（ワークスペース共通ルールの「セル間の縦線は入れない」から外れる）。
//   あちらは1行が1件の一覧を想定した規則で、週表は**縦も横も意味を持つ格子**である。
//   縦線が無いと「どの日の列か」を目で追えない。A表の実物も罫線の表。
//
// 🔴 左端の現場列と上端の日付行は sticky で固定する。
//   現場が縦に長く、7日が横に伸びるため、どちらかを見失うと読めなくなる。
import { Fragment } from "react";
import Link from "next/link";
import { formatTime, formatWeekDay } from "@/lib/board-format";
import type { WeekBoardData, WeekCell } from "@/lib/week-board";

/**
 * A表の書式に合わせた丸囲み数字（①②③…）。
 * 21以上は Unicode に無いので括弧で出す（実データで出る見込みは薄いが、落とさない）。
 */
function circled(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
}

const TH_BASE =
  "border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[11px] font-semibold text-slate-500";

function Cell({ cell, dayHref }: { cell: WeekCell; dayHref: string }) {
  const shortage = cell.shifts.length > 0 ? cell.headcount - cell.placed : 0;

  if (cell.shifts.length === 0) {
    // 🔴 空欄は「—」で埋める。何も置かないと、その日に枠が無いのか
    //   画面が壊れているのか区別がつかない
    return (
      <td className="border border-slate-200 px-1.5 py-1 align-top text-center text-[13px] text-slate-300">
        —
      </td>
    );
  }

  return (
    <td className="border border-slate-200 px-1.5 py-1 align-top">
      {cell.shifts.map((s) => (
        <div key={s.shift.id} className="mb-1 last:mb-0">
          <Link
            href={dayHref}
            title="この日の配置ボードを開く"
            className={[
              "inline-flex items-baseline gap-1 rounded px-1 py-0.5 text-[12px] font-semibold tabular-nums",
              "transition-all duration-150 ease-in-out hover:bg-slate-100",
              // amber＝まだ終わっていない（1色1意味・§2-4b）
              s.shift.status === "draft" ? "bg-amber-50 text-amber-800" : "text-slate-600",
            ].join(" ")}
          >
            <span>{circled(s.shift.headcount)}</span>
            <span>{formatTime(s.shift.start_h, s.shift.start_m)}</span>
            {s.shift.cancelled_at !== null && (
              <span className="font-normal text-rose-600">中止</span>
            )}
          </Link>

          {s.plates.map((p) => (
            <div
              key={p.assignmentId}
              className={[
                "mt-0.5 truncate rounded px-1 text-[13px] leading-snug",
                // 薄灰＝協力会社（プレートと同じ約束・§2-4b）
                p.isPartner ? "bg-slate-100 text-slate-700" : "text-slate-900",
              ].join(" ")}
              title={p.guard.name}
            >
              {p.role === "leader" && (
                <span className="mr-0.5 rounded bg-slate-700 px-1 text-[10px] font-bold text-white">
                  L
                </span>
              )}
              {p.guard.short_name || p.guard.name}
            </div>
          ))}
        </div>
      ))}

      {shortage > 0 && (
        <div className="mt-0.5 text-[11px] font-semibold text-rose-600">⚠ {shortage}名不足</div>
      )}
    </td>
  );
}

export function WeekGrid({
  data,
  baseHrefs,
  dayHrefs,
}: {
  data: WeekBoardData;
  /** 列ヘッダのクリック＝基準日の移動（§7-2-4） */
  baseHrefs: string[];
  /** セルのクリック＝その日の配置ボードへ */
  dayHrefs: string[];
}) {
  const hasRows = data.groups.length > 0 || data.offRows.length > 0;

  if (!hasRows) {
    return (
      <div className="p-8 text-center text-[14px] text-slate-500">
        この週・この管轄・この時間帯には枠がありません。
      </div>
    );
  }

  return (
    // 🔴 min-w-0 が要る（2026-09-15）。
    //   flex アイテムの既定は min-width:auto ＝「中身より小さくならない」。
    //   表が大きいと**この div 自体が画面より広くなり**、中の w-full が
    //   その広がった幅を指すため、table-fixed でも列が縮まない。
    //   min-w-0 で初めて「親の幅に収める」が成立する。
    <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      {/*
        🔴 table-fixed が要る（2026-09-15）。
          既定の table-layout:auto は**中身に合わせて列を広げる**ため、
          隊員名や得意先名が長いと w-[150px] の指定を押しのけて横に伸び、
          7日が1画面に入らなくなる。`truncate` も効かない
          （幅が確定していない列では省略記号にする基準が無い）。
        🔴 min-w を付けない。付けた瞬間に「画面に収まる」保証が消える。
          w-full と組み合わせることで、**余った幅は列へ配分され**、
          1920px なら1列あたり 200px 前後まで自然に広がる。
      */}
      <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {/* 左上の角。縦横どちらの固定にも属するので z を一段高くする */}
            <th className={`${TH_BASE} sticky top-0 left-0 z-30 w-[176px]`}>現場</th>
            {data.dates.map((d, i) => (
              <th
                key={d}
                className={[
                  TH_BASE,
                  "sticky top-0 z-20 w-[150px] text-center",
                  d === data.baseDate ? "bg-indigo-50 text-indigo-700" : "",
                ].join(" ")}
              >
                <Link
                  href={baseHrefs[i]}
                  title="この日を基準日にする（右の隊員プールが切り替わります）"
                  className="block rounded px-1 py-0.5 text-[12px] transition-all duration-150 ease-in-out hover:bg-slate-200/60"
                >
                  {formatWeekDay(d)}
                  {d === data.baseDate && <span className="ml-1 text-[10px]">◉基準日</span>}
                </Link>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {data.groups.map((g) => (
            <Fragment key={g.customer?.id ?? "__none__"}>
              {/* 得意先の見出し。A表の実物が得意先で束ねている */}
              <tr>
                <th
                  colSpan={8}
                  className="sticky left-0 border border-slate-200 bg-slate-100 px-2 py-1 text-left text-[12px] font-semibold text-slate-700"
                >
                  {g.customer?.name ?? "（得意先が未設定）"}
                </th>
              </tr>
              {g.rows.map((row) => (
                <tr key={row.site.id} className="transition-all duration-150 ease-in-out hover:bg-slate-50">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-left align-top text-[13px] font-medium text-slate-900"
                  >
                    <span className="line-clamp-2" title={row.site.name}>
                      {row.site.name}
                    </span>
                  </th>
                  {row.cells.map((cell, i) => (
                    <Cell key={cell.date} cell={cell} dayHref={dayHrefs[i]} />
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}

          {/* ── 業務外（研修・有給 など）─────────────────────
              A表の実物にも下部にこの区画がある（2026-09-09 実物解析） */}
          {data.offRows.length > 0 && (
            <>
              <tr>
                <th
                  colSpan={8}
                  className="sticky left-0 border border-slate-200 bg-slate-100 px-2 py-1 text-left text-[12px] font-semibold text-slate-700"
                >
                  業務外
                </th>
              </tr>
              {data.offRows.map((row) => (
                <tr key={row.offKind} className="transition-all duration-150 ease-in-out hover:bg-slate-50">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-left align-top text-[13px] font-medium text-slate-600"
                  >
                    {row.label}
                  </th>
                  {row.cells.map((c) => (
                    <td
                      key={c.date}
                      className="border border-slate-200 px-1.5 py-1 align-top text-[13px]"
                    >
                      {c.guards.length === 0 ? (
                        <span className="block text-center text-slate-300">—</span>
                      ) : (
                        c.guards.map((g) => (
                          <div key={g.id} className="truncate leading-snug text-slate-700" title={g.name}>
                            {g.short_name || g.name}
                          </div>
                        ))
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

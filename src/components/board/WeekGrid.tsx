// S-07 A表（週表）の表そのもの。設計は docs/screen-design.md §7-2-3。
//
// 🔴 縦の罫線を入れる（ワークスペース共通ルールの「セル間の縦線は入れない」から外れる）。
//   あちらは1行が1件の一覧を想定した規則で、週表は**縦も横も意味を持つ格子**である。
//   縦線が無いと「どの日の列か」を目で追えない。A表の実物も罫線の表。
//
// 🔴 左端の現場列と上端の日付行は sticky で固定する。
//   現場が縦に長く、7日が横に伸びるため、どちらかを見失うと読めなくなる。
//
// 🔴 D&D の受け口はここだが、DndContext は親（WeekDnd）が持つ。
//   表とプールを**同じ context** に入れないと、プールからセルへ落とせない。
//
// 🔴 印刷（2026-09-24・screen-design.md §7-2-8）。**同じ表を紙用にもう1つ作らない。**
//   別に作ると、画面を直したときに紙だけ古い形で残る（写しがずれるのと同じ）。
//   紙の都合は `print:` の上書きだけで表す：
//   ・A3 縦（297mm − 余白16mm ≒ 281mm）に 現場36mm ＋ 7日×34.5mm で収める
//   ・sticky は紙では外す（ページをまたぐと見出しが本文に重なる）
//   ・セルに最低 12mm の高さ ─ 紙は**手で書き込んで記録として残す**（柴山）
//   ・背景色は紙に出ない前提で、仮組みは文字「仮」で示す
"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { dayTone, formatTime, formatWeekDay, plateName } from "@/lib/board-format";
import type { WeekBoardData, WeekCell, WeekCellShift, WeekPlate } from "@/lib/week-board";

/**
 * A表の書式に合わせた丸囲み数字（①②③…）。
 * 21以上は Unicode に無いので括弧で出す（実データで出る見込みは薄いが、落とさない）。
 */
function circled(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
}

const TH_BASE =
  "border border-slate-200 px-2 py-1.5 text-left text-[11px] font-semibold text-slate-500";

// ─────────────────────────────────────────────────────────
// 配置された隊員1名（つかんで動かせる）
// ─────────────────────────────────────────────────────────
function PlateChip({ plate, editable }: { plate: WeekPlate; editable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: plate.assignmentId,
    data: { type: "plate", plate },
    disabled: !editable,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={
        plate.overlapping
          ? `${plate.guard.name}：同じ時間帯の別の枠にも入っています（このままでは確定できません）`
          : plate.guard.name
      }
      className={[
        "mt-0.5 truncate rounded px-1 text-[13px] leading-snug",
        editable ? "cursor-grab active:cursor-grabbing" : "",
        // 🔴 つかんでいる間は薄くする。DragOverlay 側に実体が出ているので、
        //   ここに濃いまま残すと同じ人が2人いるように見える
        isDragging ? "opacity-30" : "",
        // 🔴 rose＝足りない／入れてはいけない（1色1意味・§2-4b）。
        //   重なりは警告の中で唯一「確定を丸ごと止める」条件なので、
        //   他の警告より強く出す（overlap.ts の冒頭コメント）
        plate.overlapping
          ? "bg-rose-50 font-semibold text-rose-700"
          : plate.isPartner
            ? "bg-slate-100 text-slate-700"
            : "text-slate-900",
      ].join(" ")}
    >
      {plate.overlapping && <span className="mr-0.5 text-[10px] font-bold">重複</span>}
      {plate.role === "leader" && (
        <span className="mr-0.5 rounded bg-slate-700 px-1 text-[10px] font-bold text-white">L</span>
      )}
      {plateName(plate.guard)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// セルの中の枠1つ（ここが落とし先）
// ─────────────────────────────────────────────────────────
function ShiftBlock({
  cellShift,
  dayHref,
  editable,
}: {
  cellShift: WeekCellShift;
  dayHref: string;
  editable: boolean;
}) {
  const { shift, plates } = cellShift;
  const { setNodeRef, isOver } = useDroppable({
    id: shift.id,
    data: { type: "shift", shiftId: shift.id, plateCount: plates.length },
    disabled: !editable,
  });

  const short = shift.headcount - plates.length;

  return (
    <div
      ref={setNodeRef}
      className={[
        "mb-1 rounded last:mb-0",
        // 🔴 落とせる場所であることを、落とす前に見せる
        isOver ? "outline outline-2 outline-indigo-500 outline-offset-1" : "",
      ].join(" ")}
    >
      <Link
        href={dayHref}
        title="この日の配置ボードを開く"
        className={[
          "inline-flex items-baseline gap-1 rounded px-1 py-0.5 text-[12px] font-semibold tabular-nums",
          "transition-all duration-150 ease-in-out hover:bg-slate-100",
          // amber＝まだ終わっていない（1色1意味・§2-4b）
          shift.status === "draft" ? "bg-amber-50 text-amber-800" : "text-slate-600",
        ].join(" ")}
      >
        {shift.status === "draft" && <span className="hidden print:inline">仮</span>}
        <span>{circled(shift.headcount)}</span>
        <span>{formatTime(shift.start_h, shift.start_m)}</span>
        {shift.cancelled_at !== null && <span className="font-normal text-rose-600">中止</span>}
      </Link>

      {/* 🔴 予定コメント（2026-10-07）。A表では集合場所・時間を付箋で貼っている。
          読み込んでいたのに出していなかった。表記は日別（ShiftRowCard）に揃える */}
      {shift.plan_comment && (
        <div
          className="mt-0.5 line-clamp-2 break-all px-1 text-[11px] leading-tight text-slate-500"
          title={shift.plan_comment}
        >
          📝 {shift.plan_comment}
        </div>
      )}

      {plates.map((p) => (
        <PlateChip key={p.assignmentId} plate={p} editable={editable} />
      ))}

      {short > 0 && (
        <div className="mt-0.5 text-[11px] font-semibold text-rose-600">⚠ {short}名不足</div>
      )}
    </div>
  );
}

function Cell({
  cell,
  dayHref,
  editable,
}: {
  cell: WeekCell;
  dayHref: string;
  editable: boolean;
}) {
  // 🔴 土日は地色を変える（2026-09-16）。7列が同じ白のままだと、
  //   横に目を走らせたときに何曜日の列を見ているのか分からなくなる。
  const tone = dayTone(cell.date);

  if (cell.shifts.length === 0) {
    // 🔴 空欄は「—」で埋める。何も置かないと、その日に枠が無いのか
    //   画面が壊れているのか区別がつかない。
    // 🟠 枠が無い日は落とし先にしない。枠を作る操作はまだ無い（§7-2-10）
    return (
      <td
        className={`border border-slate-200 px-1.5 py-1 text-center align-top text-[13px] text-slate-300 print:h-[12mm] ${tone}`}
      >
        —
      </td>
    );
  }

  return (
    <td className={`border border-slate-200 px-1.5 py-1 align-top print:h-[12mm] ${tone}`}>
      {cell.shifts.map((s) => (
        <ShiftBlock key={s.shift.id} cellShift={s} dayHref={dayHref} editable={editable} />
      ))}
    </td>
  );
}

export function WeekGrid({
  data,
  baseHrefs,
  dayHrefs,
  editable,
  printHeading,
}: {
  data: WeekBoardData;
  /** 紙にだけ出す見出し（画面には出ない） */
  printHeading: { title: string; asOf: string };
  /** 列ヘッダのクリック＝基準日の移動（§7-2-4） */
  baseHrefs: string[];
  /** セルのクリック＝その日の配置ボードへ */
  dayHrefs: string[];
  editable: boolean;
}) {
  const hasRows = data.groups.length > 0 || data.offRows.length > 0;

  // 🔴 日ごとの合計人数（2026-10-07）。A表の実物は日付の下にその日の合計を手書きしている。
  //   中止の枠は数えない（人を出さない枠を足すと、出す人数が実際より多く見える）。
  //   🟠 A表の「37+1」の「+1」が何かは未確認（as-genjo-kansei.md §2 A表の実物）
  const dayTotals = data.dates.map((_, i) => {
    let placed = 0;
    let required = 0;
    for (const g of data.groups) {
      for (const row of g.rows) {
        for (const s of row.cells[i].shifts) {
          if (s.shift.cancelled_at !== null) continue;
          placed += s.plates.length;
          required += s.shift.headcount;
        }
      }
    }
    return { placed, required };
  });

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
    // 🔴 data-print-area：紙に出すのはこの中だけ（globals.css の @media print）
    <div data-print-area className="min-h-0 min-w-0 flex-1 overflow-auto print:overflow-visible">
      <div className="mb-1.5 hidden items-baseline justify-between print:flex">
        <h1 className="text-[16px] font-semibold tracking-tight text-slate-900">{printHeading.title}</h1>
        <span className="text-[11px] text-slate-500">{printHeading.asOf}</span>
      </div>
      {/*
        🔴 table-fixed が要る（2026-09-15）。
          既定の table-layout:auto は**中身に合わせて列を広げる**ため、
          隊員名や得意先名が長いと w-[150px] の指定を押しのけて横に伸び、
          7日が1画面に入らなくなる。`truncate` も効かない
          （幅が確定していない列では省略記号にする基準が無い）。
      */}
      <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {/* 左上の角。縦横どちらの固定にも属するので z を一段高くする */}
            <th className={`${TH_BASE} sticky top-0 left-0 z-30 w-[176px] bg-white print:static print:w-[36mm]`}>
              現場
            </th>
            {data.dates.map((d, i) => (
              <th
                key={d}
                className={[
                  TH_BASE,
                  "sticky top-0 z-20 w-[150px] text-center print:static print:w-[34.5mm]",
                  // 🔴 基準日の藍を優先する。曜日は毎週同じだが、基準日は
                  //   いま選んでいる列＝右のプールが何日ぶんかを示すため
                  // 🔴 見出しは曜日で変えない。色が付くのは基準日（いま選んでいる列）だけ
                  d === data.baseDate ? "bg-indigo-100 text-indigo-800" : "bg-white",
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
                  className="sticky left-0 border border-slate-200 bg-slate-100 px-2 py-1 text-left text-[12px] font-semibold text-slate-700 print:static"
                >
                  {g.customer?.name ?? "（得意先が未設定）"}
                </th>
              </tr>
              {g.rows.map((row) => (
                <tr key={row.site.id} className="print:break-inside-avoid">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-left align-top text-[13px] font-medium text-slate-900 print:static"
                  >
                    <span className="line-clamp-2" title={row.site.name}>
                      {row.site.name}
                    </span>
                  </th>
                  {row.cells.map((cell, i) => (
                    <Cell key={cell.date} cell={cell} dayHref={dayHrefs[i]} editable={editable} />
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}

          {/* ── 業務外（研修・有給 など）─────────────────────
              A表の実物にも下部にこの区画がある（2026-09-09 実物解析）。
              🟠 ここは D&D の対象にしない（有給の付け外しは別の操作） */}
          {data.offRows.length > 0 && (
            <>
              <tr>
                <th
                  colSpan={8}
                  className="sticky left-0 border border-slate-200 bg-slate-100 px-2 py-1 text-left text-[12px] font-semibold text-slate-700 print:static"
                >
                  業務外
                </th>
              </tr>
              {data.offRows.map((row) => (
                // 🔴 key は label。offKind だけだと、一部勤務可を入れた 2026-09-16 以降
                //   「有給」と「有給（夜A）」が同じ key になって行が入れ替わる
                <tr key={row.label} className="print:break-inside-avoid">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-left align-top text-[13px] font-medium text-slate-600 print:static"
                  >
                    {row.label}
                  </th>
                  {row.cells.map((c) => (
                    <td
                      key={c.date}
                      className={`border border-slate-200 px-1.5 py-1 align-top text-[13px] ${dayTone(c.date)}`}
                    >
                      {c.guards.length === 0 ? (
                        <span className="block text-center text-slate-300">—</span>
                      ) : (
                        c.guards.map((g) => (
                          <div
                            key={g.id}
                            className="break-all leading-tight text-slate-700"
                            title={g.name}
                          >
                            {plateName(g)}
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

        <tfoot>
          <tr className="print:break-inside-avoid">
            <th
              scope="row"
              className="sticky bottom-0 left-0 z-20 border border-slate-200 bg-slate-100 px-2 py-1 text-left text-[12px] font-semibold text-slate-700 print:static"
            >
              合計（配置／必要）
            </th>
            {dayTotals.map((t, i) => (
              <td
                key={data.dates[i]}
                className={[
                  "sticky bottom-0 z-10 border border-slate-200 bg-slate-100 px-1.5 py-1 text-center text-[13px] font-semibold tabular-nums print:static",
                  // rose＝足りない（1色1意味・§2-4b）
                  t.placed < t.required ? "text-rose-700" : "text-slate-800",
                ].join(" ")}
              >
                {t.required === 0 ? "—" : `${t.placed}／${t.required}名`}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

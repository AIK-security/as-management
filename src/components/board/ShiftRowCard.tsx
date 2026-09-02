// 配置ボードの1枠（現場 × 枠）＝ A表の1行。
//
// 仮組み（draft）と確定（confirmed）は **status 1列**で表す（data-model.md §4-1）。
// 🔴 確定後の編集は禁止しない。当日変更は通常業務（screen-design.md §2-7）。
//
// 🔴 2026-09-02：横幅いっぱいの帯 → **箱を並べる形**に変更した。
//   日勤は 40現場超・68名＝**平均 1.7名/現場**。1名の現場が相当数ある。
//   帯だと1名の枠が横幅を丸ごと使い、右側がほぼ空白になっていた。
//
//   ただし AIK assign（自社の外販システム）のような**固定幅の箱にはしない**。
//   固定幅に収めるために情報を削ることになるため。
//   → **人数に応じて箱が横に伸びる**（幅を決めるのはプレートの枚数）。
//     並べるのは page.tsx 側のグリッド。
//
// 見た目の方針：
//   ・**左端の色帯**で仮組み/確定を一目で分ける（バッジだけだと流し見で拾えない）
//   ・見出し（現場名）→ 補足（得意先・班）→ 数値（時間・人数）の3段。
//     狭い箱でも**縦に積めば情報は落ちない**
//   ・注意帯は必要なときだけ出す（常時出すと見なくなる）

import { EmptySlot, Plate } from "@/components/board/Plate";
import { WORK_KIND_LABEL, formatTime } from "@/lib/board";
import type { ShiftRow } from "@/lib/types";

/**
 * 箱の幅は「プレートが何枚入るか」で決める。
 * 🔴 必要人数ではなく **max(必要人数, 配置済み)** を見る。
 *   確定後に増員されて headcount を超えている枠があり、
 *   必要人数だけで測るとプレートがはみ出して折り返す。
 */
function widthSpan(headcount: number, placed: number): 1 | 2 | 3 {
  const slots = Math.max(headcount, placed);
  if (slots <= 2) return 1;
  if (slots <= 6) return 2;
  return 3;
}

export function ShiftRowCard({ row }: { row: ShiftRow }) {
  const { shift, site, customer, plates, missingQualifications } = row;
  const isDraft = shift.status === "draft";
  const shortage = Math.max(0, shift.headcount - plates.length);
  const span = widthSpan(shift.headcount, plates.length);

  // 🔴 コンテナクエリで測る。ビューポートではなく**配置エリアの幅**が基準。
  //   隊員プールを開いているかどうかで使える幅が 420px 変わるため。
  //   狭いときは伸ばさない（伸ばすと1列に1枚しか置けなくなる）。
  const spanClass =
    span === 1
      ? ""
      : span === 2
        ? "@[600px]:col-span-2"
        : "@[600px]:col-span-2 @[900px]:col-span-3";

  return (
    <section
      className={[
        "flex h-full flex-col overflow-hidden rounded-lg border-2 bg-white shadow-sm",
        // 左端の色帯：確定＝緑／仮組み＝橙
        isDraft
          ? "border-slate-300 border-l-[6px] border-l-amber-400"
          : "border-slate-300 border-l-[6px] border-l-emerald-500",
        spanClass,
      ].join(" ")}
    >
      {/* ── 見出し ── */}
      <header
        className={[
          "border-b border-slate-200 px-2.5 py-1.5",
          isDraft ? "bg-amber-50/60" : "bg-slate-50",
        ].join(" ")}
      >
        <div className="flex items-start gap-1.5">
          {/* 現場名は主役。狭い箱では2行まで折り返す（省略すると別現場と見分けがつかない） */}
          <span className="t-site line-clamp-2 min-w-0 flex-1 text-slate-900">{site.name}</span>
          {shift.status === "confirmed" ? (
            <span className="t-badge shrink-0 rounded border border-emerald-400 bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
              確定
            </span>
          ) : (
            <span className="t-badge shrink-0 rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-amber-800">
              仮組み
            </span>
          )}
          <button
            type="button"
            className="-mr-1 shrink-0 rounded px-1 leading-5 text-slate-400 transition-all duration-150 ease-in-out hover:bg-slate-200 hover:text-slate-700"
            aria-label="この枠の操作"
          >
            ⋯
          </button>
        </div>

        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="t-customer min-w-0 truncate text-slate-500">
            {customer?.name ?? ""}
          </span>
          {shift.band_name && (
            <span className="t-meta shrink-0 rounded border border-slate-300 bg-white px-1 text-slate-600">
              {shift.band_name}
            </span>
          )}
        </div>

        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="t-time shrink-0 text-slate-800">
            {formatTime(shift.start_h, shift.start_m)}–{formatTime(shift.end_h, shift.end_m)}
          </span>
          <span className="t-badge shrink-0 rounded border border-slate-300 bg-white px-1 text-slate-700">
            {WORK_KIND_LABEL[shift.work_kind]}
          </span>
          <span className="t-meta shrink-0 text-slate-500">休{shift.break_min}</span>

          <span
            className={
              shortage > 0 ? "t-count ml-auto text-rose-600" : "t-count ml-auto text-slate-700"
            }
          >
            {plates.length}
            <span className="t-meta text-slate-400"> / </span>
            {shift.headcount}
            <span className="t-meta ml-0.5 text-slate-500">名</span>
          </span>
        </div>
      </header>

      {/* ── 注意帯（必要なときだけ出す。常時出すと見なくなる） ── */}
      {(shift.changed_after_confirm || missingQualifications.length > 0 || shift.plan_comment) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-2.5 py-1">
          {shift.changed_after_confirm && (
            <span
              className="t-badge rounded border border-indigo-400 bg-indigo-50 px-1.5 text-indigo-800"
              title="確定後に変更あり。べんり君へ再度引き渡す必要があります"
            >
              要 再引き渡し
            </span>
          )}
          {missingQualifications.length > 0 && (
            <span className="t-badge rounded border border-amber-400 bg-amber-50 px-1.5 text-amber-800">
              資格不足：{missingQualifications.map((q) => q.short_label).join("・")}
            </span>
          )}
          {shift.plan_comment && (
            <span className="t-meta min-w-0 truncate text-slate-500" title={shift.plan_comment}>
              📝 {shift.plan_comment}
            </span>
          )}
        </div>
      )}

      {/* ── プレート置き場 ──
          🔴 mt-auto で下端に寄せる。同じ行の箱は高さが揃うため、
             プレートの位置が箱ごとにばらつくと目で追えなくなる */}
      <div className="mt-auto flex flex-wrap content-end gap-1.5 bg-slate-50/70 px-2.5 py-2">
        {plates.map((plate) => (
          <Plate key={plate.assignmentId} plate={plate} />
        ))}
        {Array.from({ length: shortage }, (_, i) => (
          <EmptySlot key={`empty-${shift.id}-${i}`} />
        ))}
      </div>
    </section>
  );
}

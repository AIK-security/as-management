// 配置ボードの1行（現場 × 枠）＝ A表の1行。
//
// 仮組み（draft）と確定（confirmed）は **status 1列**で表す（data-model.md §4-1）。
// 🔴 確定後の編集は禁止しない。当日変更は通常業務（screen-design.md §2-7）。
//
// 見た目の方針：
//   ・**左端の色帯**で仮組み/確定を一目で分ける（バッジだけだと流し見で拾えない）
//   ・**見出し帯**（現場名・時間）と**プレート置き場**を背景色で分離する
//   ・現場名 16px / 時間 16px / 得意先・補足 12〜13px と、役割ごとに大きさを変える

import { EmptySlot, Plate } from "@/components/board/Plate";
import { WORK_KIND_LABEL, formatTime } from "@/lib/board";
import type { ShiftRow } from "@/lib/types";

export function ShiftRowCard({ row }: { row: ShiftRow }) {
  const { shift, site, customer, plates, missingQualifications } = row;
  const isDraft = shift.status === "draft";
  const shortage = Math.max(0, shift.headcount - plates.length);

  return (
    <section
      className={[
        "overflow-hidden rounded-lg border-2 bg-white shadow-sm",
        // 左端の色帯：確定＝緑／仮組み＝橙
        isDraft ? "border-slate-300 border-l-[6px] border-l-amber-400" : "border-slate-300 border-l-[6px] border-l-emerald-500",
      ].join(" ")}
    >
      {/* ── 見出し帯 ── */}
      <header
        className={[
          "flex items-center gap-2 border-b border-slate-200 px-3 py-2",
          isDraft ? "bg-amber-50/60" : "bg-slate-50",
        ].join(" ")}
      >
        <span className="t-site truncate text-slate-900">{site.name}</span>
        <span className="t-customer truncate text-slate-500">{customer.name}</span>

        <span className="t-meta shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-600">
          {shift.bandName}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="t-time text-slate-800">
            {formatTime(shift.startH, shift.startM)}–{formatTime(shift.endH, shift.endM)}
          </span>
          <span className="t-badge rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-700">
            {WORK_KIND_LABEL[shift.workKind]}
          </span>
          <span className="t-meta text-slate-500">休 {shift.breakMin}分</span>

          <span className="mx-1 h-5 w-px bg-slate-300" />

          <span className={shortage > 0 ? "t-count text-rose-600" : "t-count text-slate-700"}>
            {plates.length}
            <span className="t-meta text-slate-400"> / </span>
            {shift.headcount}
            <span className="t-meta ml-0.5 text-slate-500">名</span>
          </span>

          {shift.status === "confirmed" ? (
            <span className="t-badge rounded border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-emerald-800">
              確定
            </span>
          ) : (
            <span className="t-badge rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-amber-800">
              仮組み
            </span>
          )}

          <button
            type="button"
            className="rounded px-2 py-0.5 text-slate-400 transition-all duration-150 ease-in-out hover:bg-slate-200 hover:text-slate-700"
            aria-label="この枠の操作"
          >
            ⋯
          </button>
        </div>
      </header>

      {/* ── 注意帯（必要なときだけ出す。常時出すと見なくなる） ── */}
      {(shift.changedAfterConfirm || missingQualifications.length > 0 || shift.planComment) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5">
          {shift.changedAfterConfirm && (
            <span
              className="t-badge rounded border border-indigo-400 bg-indigo-50 px-2 py-0.5 text-indigo-800"
              title="確定後に変更あり。べんり君へ再度引き渡す必要があります"
            >
              要 再引き渡し
            </span>
          )}
          {missingQualifications.length > 0 && (
            <span className="t-badge rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-amber-800">
              資格不足：{missingQualifications.map((q) => q.shortLabel).join("・")}
            </span>
          )}
          {shift.planComment && (
            <span className="t-meta truncate text-slate-500">📝 {shift.planComment}</span>
          )}
        </div>
      )}

      {/* ── プレート置き場 ── */}
      <div className="flex flex-wrap gap-2 bg-slate-50/70 px-3 py-2.5">
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

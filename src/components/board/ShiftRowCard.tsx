// 配置ボードの1枠（現場 × 枠）＝ A表の1行。
//
// 仮組み（draft）と確定（confirmed）は **status 1列**で表す（data-model.md §4-1）。
// 🔴 確定後の編集は禁止しない。当日変更は通常業務（screen-design.md §2-7）。
//
// 🔴 2026-09-02：横幅いっぱいの帯 → **箱を並べる形**に変更した。
//   日勤は 40現場超・68名＝**平均 1.7名/現場**。1名の現場が相当数ある。
//   帯だと1名の枠が横幅を丸ごと使い、右側がほぼ空白になっていた。
//
//   🔴 箱の大きさは**全枠で統一する**（2026-09-02 判断）。
//   人数に応じて幅を伸ばす案は試したが、大小が混ざると視線が引っかかり
//   一覧として読みにくかった。**幅を揃えたうえで、情報は削らない**。
//   狭い箱に収めるために情報を落とさず、横並びだった項目を縦に積んで解く。
//   並べるのは page.tsx 側のグリッド。
//
// 🔴 得意先名はカード内に出す／出さないを切り替える（2026-09-02）。
//   ・「すべて」表示 … **出す**。会社をまたいで詰めて並べるため、
//     カード自身が所属を持っていないと、どの会社の現場か分からない
//   ・得意先タブで1社に絞っているとき … **出さない**。
//     全カードに同じ会社名が並んでも1件も見分けがつかず、1行ぶん無駄になる
//
// 🔴 色の役割（2026-09-02・1色1意味に統一）
//   amber   … まだ終わっていない（仮組み）
//   rose    … 足りない／入れてはいけない（人数不足・資格不足・NG）
//   emerald … 資格あり（プレート側だけ）
//   emerald … 資格あり（プレート側）／ **確定（左の色帯だけ）**
//   slate   … それ以外すべて
//
//   🔴 確定の緑は**左の色帯だけに残す**（2026-09-02 再調整）。
//     バッジ・地色・件数チップまで緑にすると資格バッジの緑と competing になり、
//     画面のどこを見ればよいか分からなくなる。
//     一方で「進んだぶんが見える」ことには価値があるため、
//     **面積の小さい帯1本だけ**に留める。
//
// 見た目の方針：
//   ・**左端の色帯**で仮組みを拾う（バッジだけだと流し見で拾えない）
//   ・見出し（現場名）→ 数値（時間・区分・班・休憩・人数）の2段。
//     狭い箱でも**縦に積めば情報は落ちない**
//   ・注意帯は必要なときだけ出す（常時出すと見なくなる）

// 🔴 段2-③（2026-09-03）でクライアントコンポーネントになった。
//   カード＝ドロップ先であり、確定トグルの押し先でもある。
//
// 🔴 import 元が `@/lib/board` → `@/lib/board-format` に変わっている。
//   `board.ts` は server-only（取得処理が混ざるのを防ぐ壁）なので、
//   クライアントから読むと**ビルドが落ちる**。表示の整形だけを切り出してある。
"use client";

import { useDroppable } from "@dnd-kit/core";
import { DraggablePlate, EmptySlot } from "@/components/board/Plate";
import { WORK_KIND_LABEL, formatTime } from "@/lib/board-format";
import type { ShiftRow } from "@/lib/types";

export function ShiftRowCard({
  row,
  showCustomer = false,
  editable = false,
  onToggleStatus,
}: {
  row: ShiftRow;
  showCustomer?: boolean;
  /** 事務ロールは閲覧のみ。掴めず・押せない（requirements.md §3 決定 #2） */
  editable?: boolean;
  onToggleStatus?: (shiftId: string, next: "draft" | "confirmed") => void;
}) {
  const { shift, site, customer, plates, missingQualifications } = row;
  const isDraft = shift.status === "draft";
  const shortage = Math.max(0, shift.headcount - plates.length);

  // 🔴 カード**全体**をドロップ先にする。プレート置き場だけにすると、
  //   1名の枠では的が 84×46px しかなく、40枚並んだ画面では狙えない。
  const { setNodeRef, isOver } = useDroppable({
    id: `shift:${shift.id}`,
    data: { type: "shift", shiftId: shift.id, plateCount: plates.length },
    disabled: !editable,
  });

  return (
    <section
      ref={setNodeRef}
      className={[
        "flex h-full flex-col overflow-hidden rounded-lg border-2 bg-white shadow-sm",
        // 🔴 ドロップ先は**藍**で示す（1色1意味：藍＝操作）。
        //   状態を表す橙・赤・緑と混ぜない。掴んでいる間だけ出るので
        //   「今ここに置ける」以外の意味に読まれる余地がない
        isOver ? "ring-2 ring-indigo-500 ring-offset-1" : "",
        // 左端の色帯：仮組み＝橙／確定＝緑。**色を使うのはこの帯だけ**
        isDraft
          ? "border-slate-300 border-l-[6px] border-l-amber-400"
          : "border-slate-300 border-l-[6px] border-l-emerald-500",
      ].join(" ")}
    >
      {/* ── 見出し ── */}
      <header
        // 🔴 仮組みの地色（bg-amber-50）をやめた。カード1枚ぶんの面積が
        //    色で塗られると、画面全体では最も目立つ要素になってしまう。
        //    状態は左の色帯とバッジで足りる。
        className="border-b border-slate-200 bg-slate-50 px-3 py-2"
      >
        {/* 得意先は現場名の**上**に小さく置く。
            会社 → 現場 の順で読め、主役（現場名）の大きさを譲らずに済む */}
        {showCustomer && (
          <div className="t-meta truncate text-slate-500" title={customer?.name ?? ""}>
            {customer?.name ?? "（得意先が未設定）"}
          </div>
        )}

        <div className="flex items-start gap-1.5">
          {/* 現場名は主役。狭い箱では2行まで折り返す（省略すると別現場と見分けがつかない） */}
          <span className="t-site line-clamp-2 min-w-0 flex-1 text-slate-900">{site.name}</span>
          {/* 🔴 状態バッジをそのまま押せるようにした（2026-09-03）。
              別にボタンを足すと、状態を見る場所と変える場所が離れる。
              確定は取り消せる（差し戻し・screen-design.md §2-6）。
              一方通行にすると押し間違いを直す手段が無くなる */}
          {editable && onToggleStatus ? (
            <button
              type="button"
              onClick={() => onToggleStatus(shift.id, isDraft ? "confirmed" : "draft")}
              title={isDraft ? "この枠を確定する" : "仮組みに戻す"}
              className={[
                "t-badge shrink-0 cursor-pointer rounded border px-1.5 py-0.5",
                "transition-all duration-150 ease-in-out",
                isDraft
                  ? "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              {isDraft ? "仮組み" : "確定"}
            </button>
          ) : (
            <span
              className={[
                "t-badge shrink-0 rounded border px-1.5 py-0.5",
                isDraft
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-slate-300 bg-white text-slate-600",
              ].join(" ")}
            >
              {isDraft ? "仮組み" : "確定"}
            </span>
          )}
          {/* 🟠 枠の操作メニュー（中止・時刻変更）は未実装。段2-③ の範囲外。
              押せるのに何も起きないボタンは残さない ─ 壊れていると読まれる */}
        </div>

        {/* 🔴 狭い箱では折り返しを許す。切り捨てると休憩や人数が消えるため */}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="t-time shrink-0 text-slate-800">
            {formatTime(shift.start_h, shift.start_m)}–{formatTime(shift.end_h, shift.end_m)}
          </span>
          <span className="t-badge shrink-0 rounded border border-slate-300 bg-white px-1 text-slate-700">
            {WORK_KIND_LABEL[shift.work_kind]}
          </span>
          {shift.band_name && (
            <span className="t-meta shrink-0 rounded border border-slate-300 bg-white px-1 text-slate-600">
              {shift.band_name}
            </span>
          )}
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
      {/* 🔴 「要 再引き渡し」バッジは廃止した（2026-09-03・柴山判断）。
          まだ一度も引き渡していないのに「再度渡せ」と言っており、意味が取れなかった。
          確定後に配置が変われば、その枠は DB のトリガーで**仮組みに戻る**。
          状態そのもので言えることに、バッジを足す必要が無い。 */}
      {(missingQualifications.length > 0 || shift.plan_comment) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5">
          {missingQualifications.length > 0 && (
            <span className="t-badge rounded border border-rose-300 bg-rose-50 px-1.5 text-rose-700">
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
      <div className="mt-auto flex flex-wrap content-end gap-1.5 bg-slate-50/70 px-3 py-2.5">
        {plates.map((plate) => (
          <DraggablePlate key={plate.assignmentId} plate={plate} disabled={!editable} />
        ))}
        {Array.from({ length: shortage }, (_, i) => (
          <EmptySlot key={`empty-${shift.id}-${i}`} />
        ))}
      </div>
    </section>
  );
}

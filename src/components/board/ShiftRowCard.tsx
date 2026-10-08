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
// 🔴 2026-09-04：キーボード操作のために「選択」を持つようになった（§2-8）。
//   選択は D&D と**別の状態**。掴んでいる最中と、いま操作対象にしている枠は違う。
//   色も分ける ── ドロップ先は ring（掴んでいる間だけ）、選択は outline（居座る）。
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { DraggablePlate, EmptySlot } from "@/components/board/Plate";
import {
  JOB_TYPE_LABEL,
  JOB_TYPE_MARK,
  JOB_TYPES,
  WORK_KIND_LABEL,
  formatTime,
  jobCountsMark,
  jobShortages,
  plateName,
} from "@/lib/board-format";
import type { AssignmentRole, JobType, PlateView, ShiftRow } from "@/lib/types";

export function ShiftRowCard({
  row,
  showCustomer = false,
  editable = false,
  selected = false,
  selectedPlateId = null,
  onToggleStatus,
  onToggleCancel,
  onDelete,
  onEdit,
  onSelect,
  onSetRole,
  onSetJobType,
  onSetOnsiteCancelled,
}: {
  row: ShiftRow;
  showCustomer?: boolean;
  /** 事務ロールは閲覧のみ。掴めず・押せない（requirements.md §3 決定 #2） */
  editable?: boolean;
  /** キーボード操作でいま選ばれている枠か */
  selected?: boolean;
  /** その枠の中で選ばれているプレート（assignmentId） */
  selectedPlateId?: string | null;
  onToggleStatus?: (shiftId: string, next: "draft" | "confirmed") => void;
  /** 枠の中止／中止の取り消し（2026-09-07） */
  onToggleCancel?: (shiftId: string, cancelled: boolean) => void;
  /** 枠そのものを消す（2026-09-07）。中止とは別 ─ 間違えて作った枠を片づけるため */
  onDelete?: (shiftId: string) => void;
  /** 🔴 枠の中身を直す（2026-09-09）。時刻・人数・コメントをここから開く。
      これが無いと、5分ずらすだけでも枠を消して作り直すことになっていた */
  onEdit?: (shiftId: string) => void;
  /** クリックでも選べるようにする。assignmentId が null なら枠だけの選択 */
  onSelect?: (shiftId: string, assignmentId: string | null) => void;
  onSetRole?: (assignmentId: string, role: AssignmentRole) => void;
  /** 職種（K・R・D）の付け外し（2026-10-08） */
  onSetJobType?: (assignmentId: string, jobType: JobType | null) => void;
  /** その人だけ現着中止（2026-10-08） */
  onSetOnsiteCancelled?: (assignmentId: string, cancelled: boolean) => void;
}) {
  const { shift, site, customer, plates, missingQualifications } = row;
  const isDraft = shift.status === "draft";
  // 🔴 中止（行く前の中止）。枠も配置も残したまま状態だけが変わる。
  //   現着中止（work_kind の「現中」）とは別物 ─ あちらは稼働が立つ。
  const cancelled = shift.cancelled_at !== null;
  // 🔴 削除の確認は**カードの中**に出す。window.confirm は使わない（2026-09-04 決定）
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 🔴 中止の枠では人数不足を数えない。誰も行かないので「足りない」に意味が無い。
  const shortage = cancelled ? 0 : Math.max(0, shift.headcount - plates.length);
  // 🔴 A表の `K1R1`（2026-10-08）。必要数に対し、その職種を付けた人が足りないか
  const jobMark = jobCountsMark(shift);
  const jobShort = cancelled ? [] : jobShortages(shift, plates);
  const pickedPlate = plates.find((p) => p.assignmentId === selectedPlateId) ?? null;

  // 🔴 カード**全体**をドロップ先にする。プレート置き場だけにすると、
  //   1名の枠では的が 84×46px しかなく、40枚並んだ画面では狙えない。
  const { setNodeRef, isOver } = useDroppable({
    id: `shift:${shift.id}`,
    data: { type: "shift", shiftId: shift.id, plateCount: plates.length },
    disabled: !editable,
  });

  // 🔴 ↑↓ で選んだ枠が画面の外にあると、押しても何も起きていないように見える。
  //   block:"nearest" にして、見えているときは動かさない（勝手に飛ぶと目で追えない）。
  const boxRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (selected) boxRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <section
      ref={(el) => {
        boxRef.current = el;
        setNodeRef(el);
      }}
      onClick={() => onSelect?.(shift.id, null)}
      className={[
        "flex h-full flex-col rounded-lg border-2 bg-white shadow-sm",
        // 🔴 名札の上に操作の吹き出しを出している間だけ、はみ出しを許して手前に出す（2026-10-08）。
        //   普段は角丸の外へ中身が出ないよう切る
        pickedPlate && editable ? "relative z-20 overflow-visible" : "overflow-hidden",
        // 🔴 ドロップ先は**藍**で示す（1色1意味：藍＝操作）。
        //   状態を表す橙・赤・緑と混ぜない。掴んでいる間だけ出るので
        //   「今ここに置ける」以外の意味に読まれる余地がない
        isOver ? "ring-2 ring-indigo-500 ring-offset-1" : "",
        // 🔴 選択は outline で出す。ring はドロップ先に使っているので、
        //   同じ形にすると「掴んでいる先」と「選んでいる枠」が見分けられない
        selected ? "outline-2 outline-offset-2 outline-indigo-600" : "",
        // 左端の色帯：仮組み＝橙／確定＝緑。**色を使うのはこの帯だけ**
        // 🔴 中止は灰へ倒す（1色1意味：slate＝それ以外）。
        //   仮組み／確定の色を残すと「まだ動く枠」に見えてしまう。
        cancelled
          ? "border-slate-300 border-l-[6px] border-l-slate-400 bg-slate-50"
          : isDraft
            ? "border-slate-300 border-l-[6px] border-l-amber-400"
            : "border-slate-300 border-l-[6px] border-l-emerald-500",
      ].join(" ")}
    >
      {/* ── 見出し ── */}
      <header
        // 🔴 仮組みの地色（bg-amber-50）をやめた。カード1枚ぶんの面積が
        //    色で塗られると、画面全体では最も目立つ要素になってしまう。
        //    状態は左の色帯とバッジで足りる。
        className="rounded-tr-md border-b border-slate-200 bg-slate-50 px-3 py-2"
      >
        {/* 得意先は現場名の**上**に小さく置く。
            会社 → 現場 の順で読め、主役（現場名）の大きさを譲らずに済む */}
        {/* 🔴 枠からマスタ詳細へ飛べるようにする（2026-09-09・柴山の要望）。
            配置中に「この現場の必要資格は？」「この得意先の請求番号は？」が出たとき、
            一覧まで戻って探し直すことになっていた。 */}
        {showCustomer && (
          <div className="t-meta truncate text-slate-500" title={customer?.name ?? ""}>
            {customer ? (
              <Link
                href={`/masters/customers/${customer.id}`}
                className="transition-all duration-150 ease-in-out hover:text-indigo-700 hover:underline"
              >
                {customer.name}
              </Link>
            ) : (
              "（得意先が未設定）"
            )}
          </div>
        )}

        {/* 🔴 現場名は**行を丸ごと使う**（2026-09-16・柴山の要望）。
            それまで現場名とボタン4つを同じ行に並べていたため、
            ボタン群が約186px を固定で占有し、現場名に残る幅は全角10文字弱だった。
            結果、ほぼ全ての現場名が2行に折り返していた（「アルファ 上下／水道」）。
            ボタンを下の行へ落とすと折り返しは消え、**高さはほぼ変わらない** ──
            「名前2行」が「名前1行＋ボタン1行」に置き換わるだけだから。

            🔴 line-clamp-2 は残す。極端に長い現場名を省略で消すと、
               別の現場と見分けがつかなくなる（幅が広がった今も同じ）。
            🔴 中止は現場名に取り消し線を引く。バッジだけだと流し見で拾えず、
               40枚並んだ画面では「中止なのに人を探し続ける」が起きる */}
        <Link
          href={`/masters/sites/${site.id}`}
          title="現場マスタを開く"
          className={[
            "t-site line-clamp-2 block",
            "transition-all duration-150 ease-in-out hover:text-indigo-700 hover:underline",
            cancelled ? "text-slate-400 line-through" : "text-slate-900",
          ].join(" ")}
        >
          {site.name}
        </Link>

        {/* ── 2行目：状態（左）と操作（右） ──
            🔴 「今どうなっているか」と「何をするか」を左右に分ける（2026-09-16）。
               同じ列に混ぜて並べると、状態を読みに行った目が操作を押しに行く。
               色の 1色1意味（状態＝橙/緑・操作＝藍）と同じ切り分け。 */}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {/* 🔴 状態バッジをそのまま押せるようにした（2026-09-03）。
              別にボタンを足すと、状態を見る場所と変える場所が離れる。
              確定は取り消せる（差し戻し・screen-design.md §2-6）。
              一方通行にすると押し間違いを直す手段が無くなる */}
          {cancelled ? null : editable && onToggleStatus ? (
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
          {/* 🔴 中止のときは仮組み／確定のバッジを**隠す**（2026-09-07）。
              「中止」と「仮組み」が並ぶと、どちらが今の状態か読めない。
              閲覧だけの事務ロールにも状態は見せる必要があるため、
              押せないバッジをここに置く */}
          {!editable && cancelled && (
            <span className="t-badge shrink-0 rounded border border-slate-500 bg-slate-600 px-1.5 py-0.5 text-white">
              中止
            </span>
          )}

          {/* 操作は右端へ寄せる。ml-auto は**まとめた箱**に付ける ──
              個々のボタンに付けると、中止で状態バッジが消えたとき
              寄せ先を失って操作が左に飛ぶ */}
          {editable && (onToggleCancel || onEdit || onDelete) && (
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {/* ── 中止（2026-09-07） ──
                  🔴 「取り消す」ではなく「中止になったと分かる表示に変わる」。
                     枠も配置も残す。空いた隊員をどこへ回すかの判断材料になるため。 */}
              {onToggleCancel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCancel(shift.id, !cancelled);
                  }}
                  title={cancelled ? "中止をやめて元に戻す" : "この枠を中止にする"}
                  className={[
                    "t-badge shrink-0 cursor-pointer rounded border px-1.5 py-0.5",
                    "transition-all duration-150 ease-in-out",
                    cancelled
                      ? "border-slate-500 bg-slate-600 text-white hover:bg-slate-700"
                      : "border-slate-300 bg-white text-slate-500 hover:bg-slate-100",
                  ].join(" ")}
                >
                  中止
                </button>
              )}
              {onEdit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(shift.id);
                  }}
                  title="この枠の時刻・人数・コメントを直す"
                  className="t-badge shrink-0 cursor-pointer rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-500 transition-all duration-150 ease-in-out hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  編集
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmingDelete(true);
                  }}
                  title="この枠を削除する（配置も消えます）"
                  className="t-badge shrink-0 cursor-pointer rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-500 transition-all duration-150 ease-in-out hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                >
                  削除
                </button>
              )}
            </div>
          )}
        </div>

        {/* 🔴 狭い箱では折り返しを許す。切り捨てると休憩や人数が消えるため */}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="t-time shrink-0 text-slate-800">
            {formatTime(shift.start_h, shift.start_m)}–{formatTime(shift.end_h, shift.end_m)}
          </span>
          <span className="t-badge shrink-0 rounded border border-slate-300 bg-white px-1 text-slate-700">
            {WORK_KIND_LABEL[shift.work_kind]}
          </span>
          <span className="t-meta shrink-0 text-slate-500">休{shift.break_min}</span>
          {jobMark && (
            <span
              title={
                jobShort.length > 0
                  ? jobShort.map((j) => `${j.label} 必要${j.need}に対し${j.have}名`).join(" / ")
                  : "必要人数のうち 検定(K)・列車見張(R)・ドライバー(D)"
              }
              className={[
                "t-badge shrink-0 font-mono",
                jobShort.length > 0 ? "text-rose-600" : "text-slate-600",
              ].join(" ")}
            >
              {jobMark}
            </span>
          )}

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

      {/* ── 削除の確認（2026-09-07） ──
          🔴 何名ぶん消えるのかを**押す前に**見せる。
             assignments は `on delete cascade` で一緒に消えるため、
             件数を出さずに押させると、消えたことに後で気づく作りになる。 */}
      {confirmingDelete && (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-rose-200 bg-rose-50 px-3 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="t-badge text-rose-800">
            この枠を削除します
            {plates.length > 0 ? `（配置ずみ ${plates.length}名も消えます）` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              setConfirmingDelete(false);
              onDelete?.(shift.id);
            }}
            className="t-badge cursor-pointer rounded border border-rose-600 bg-rose-600 px-2 py-0.5 text-white transition-all duration-150 ease-in-out hover:bg-rose-700"
          >
            削除する
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="t-badge cursor-pointer rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
          >
            やめる
          </button>
        </div>
      )}

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
      <div className="mt-auto flex flex-wrap content-end gap-1.5 rounded-br-md bg-slate-50/70 px-3 py-2.5">
        {plates.map((plate, index) => {
          const picked = plate.assignmentId === selectedPlateId;
          return (
            // 🔴 選択の枠線と隊長ボタンは、ドラッグの取っ手の**外側**に置く。
            //   DraggablePlate の中に入れると、ボタンを押した指がドラッグ開始と
            //   取り合いになる（Plate.tsx の「外側に1枚かぶせる」と同じ理由）。
            <div
              key={plate.assignmentId}
              className="relative"
              onClick={(e) => {
                e.stopPropagation(); // 枠だけの選択に上書きさせない
                onSelect?.(shift.id, plate.assignmentId);
              }}
            >
              <div className={picked ? "rounded-lg outline-2 outline-offset-1 outline-indigo-600" : ""}>
                <DraggablePlate plate={plate} disabled={!editable} />
              </div>

              {/* ── 選んだ名札の操作（2026-10-08） ──
                  🔴 名札の角にボタンを重ねていた（左上 職・右上 L・右下 中）のをやめ、
                     名札の**真上に吹き出し**で出す（柴山「ごちゃごちゃする」→ 案2）。
                     角のボタンは1文字で意味が読めず、職種は押すたびに順に変わっていた。
                     ここでは**言葉で書き**、職種は4つ並べて**押したものが今の値**にする。
                  選んでいないときは何も出ない。キーボード（L・K・R・D）は今のまま */}
              {picked && editable && (
                <PlateActions
                  plate={plate}
                  // 名札は1行に3枚並ぶ（Plate.tsx の 84px の根拠）。端の名札では吹き出しを内側へ寄せる
                  align={index % 3 === 0 ? "left" : index % 3 === 2 ? "right" : "center"}
                  onSetRole={onSetRole}
                  onSetJobType={onSetJobType}
                  onSetOnsiteCancelled={onSetOnsiteCancelled}
                />
              )}

            </div>
          );
        })}
        {Array.from({ length: shortage }, (_, i) => (
          <EmptySlot key={`empty-${shift.id}-${i}`} />
        ))}
      </div>

    </section>
  );
}

// ─────────────────────────────────────────────────────────
// 選んだ名札の操作の吹き出し（2026-10-08）
// ─────────────────────────────────────────────────────────
const ACTION_BTN =
  "cursor-pointer rounded border px-2 py-0.5 text-[12px] font-medium transition-all duration-150 ease-in-out";
/** 吹き出しの中は狭いので短く（A表の言い方：R＝列車） */
const JOB_SHORT: Record<JobType, string> = { kentei: "検定", train: "列車", driver: "ドライバー" };
// 🔴 押してある状態は藍（1色1意味：藍＝操作）。灰だけだと、どれが押してあるか読みにくかった（柴山）
const ON = "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700";
const OFF = "border-slate-300 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50";

const ALIGN = {
  left: { box: "left-0", tail: "left-8" },
  center: { box: "left-1/2 -translate-x-1/2", tail: "left-1/2 -translate-x-1/2" },
  right: { box: "right-0", tail: "right-8" },
} as const;

function PlateActions({
  plate,
  align,
  onSetRole,
  onSetJobType,
  onSetOnsiteCancelled,
}: {
  plate: PlateView;
  align: keyof typeof ALIGN;
  onSetRole?: (assignmentId: string, role: AssignmentRole) => void;
  onSetJobType?: (assignmentId: string, jobType: JobType | null) => void;
  onSetOnsiteCancelled?: (assignmentId: string, cancelled: boolean) => void;
}) {
  const id = plate.assignmentId;
  // 🔴 帯の中のクリックで枠の選択が動かないようにする（カード全体がクリックで選択になる）
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className={[
        "absolute bottom-full z-30 mb-2.5 w-max rounded-md border border-slate-300 bg-white p-2 shadow-md",
        ALIGN[align].box,
      ].join(" ")}
      onClick={stop}
      // 🔴 吹き出しの上でつかんでもドラッグを始めない（名札の取っ手の外側に置いてある）
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 吹き出しの尾。どの名札の操作かを指す */}
      <span
        className={[
          "absolute -bottom-1.5 h-3 w-3 rotate-45 border-r border-b border-slate-300 bg-white",
          ALIGN[align].tail,
        ].join(" ")}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-semibold text-slate-800">{plateName(plate.guard)}</span>
        <span className="flex gap-1">
          {onSetRole && (
            <button
              type="button"
              onClick={() => onSetRole(id, plate.role === "leader" ? "member" : "leader")}
              title="キーボードでは L"
              className={[ACTION_BTN, plate.role === "leader" ? ON : OFF].join(" ")}
            >
              隊長
            </button>
          )}
          {onSetOnsiteCancelled && (
            <button
              type="button"
              onClick={() => onSetOnsiteCancelled(id, !plate.onsiteCancelled)}
              className={[ACTION_BTN, plate.onsiteCancelled ? ON : OFF].join(" ")}
            >
              現着中止
            </button>
          )}
        </span>
      </div>

      {onSetJobType && (
        // 🔴 1行に収める（折り返すと「ドライバー」だけ次の行に落ちた）。幅は中身に合わせる（w-max）
        <span className="mt-1.5 flex items-center gap-1 whitespace-nowrap">
          <span className="text-[11px] font-medium text-slate-500">職種</span>
          {([null, ...JOB_TYPES] as (JobType | null)[]).map((j) => (
            <button
              key={j ?? "none"}
              type="button"
              onClick={() => onSetJobType(id, j)}
              title={j ? `${JOB_TYPE_LABEL[j]}（キーボードでは ${JOB_TYPE_MARK[j]}）` : "交通誘導（印なし）"}
              className={[ACTION_BTN, plate.jobType === j ? ON : OFF].join(" ")}
            >
              {j ? `${JOB_TYPE_MARK[j]} ${JOB_SHORT[j]}` : "なし"}
            </button>
          ))}
        </span>
      )}

    </div>
  );
}


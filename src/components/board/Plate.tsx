// 隊員プレート。
//
// 🔴 **載せる情報は「配置の判断基準」に限る**（as-genjo-kansei.md §4-6 / screen-design.md §2-4）。
//    1. 資格   … 優先順位1位。「資格持ちがすぐ分かるようにしてほしい」＝現場からの直接の要望
//    2. ★経験 … 優先順位2位。「行ったことがある人で埋める」
//    3. ⚠NG   … 監督NG・不仲。**入れられない制約**
//    距離・交通費は載せない（判断基準として挙がらなかった。常時表示はノイズになる）。
//
// 🔴 色の役割は1色1意味に統一する（2026-09-02）。
//   emerald＝資格あり ／ rose＝入れてはいけない（NG）／ slate＝それ以外。
//   以前は 協力会社=橙・他管轄=空色・役割=藍 と色を配っていたが、
//   **1枚のプレートに4色**乗って画面全体がやかましくなっていた。
//   所属や役割は**文字（協・他・L・S）で読める**ので色を足す必要が無い。
//   色を残すのは「資格」だけ ─ 現場からの直接の要望であり、
//   数ある中から探す対象だから。

// 🔴 段2-③（2026-09-03）でクライアントコンポーネントになった。
//   つかんで動かす対象そのものなので、ここはブラウザ側で動く必要がある。
//   見た目のコードは一切変えていない ─ **ドラッグの取っ手を外側に足しただけ**。
"use client";

import { useRouter } from "next/navigation";
// 🔴 資格ラベルは board.ts で畳んである（qualLabels）。
//   プレートを描くたびにマスタを引かせない（1日 約150枚 描く画面のため）。
import { useDraggable } from "@dnd-kit/core";
import type { GuardView, PlateView } from "@/lib/types";
import { TRAIN_PREFIX } from "@/lib/qual-labels";
import { plateName } from "@/lib/board-format";

// 🔴 隊長だけバッジを出す。「それ以外」は何も出さない（2026-09-02）。
//   全員に何かを出すと、出ていること自体が情報でなくなる。
//
// 🔴 表記は「L」。漢字1文字（長）も試したが、**濃い地に白抜きの L のほうが
//   遠目に拾いやすい**という判断（2026-09-02・柴山）。
//   意味はツールチップと記号一覧（screen-design.md §2-4b）で補う。
const ROLE_LABEL = { leader: "L", member: "" } as const;

// 🔴 プレート幅 84px の根拠（2026-09-02・112px から変更）
//   日勤は毎日40現場ほどある。2枚並びだと5名の枠で3段になり、
//   **同じ行のカードが全部その高さに引き上げられる**（グリッドの行は高さが揃う）。
//   1画面に8件しか入らなかった原因はここ。
//   → **3枚並び**にする。列幅300px のとき
//     300 −（内側の余白24 ＋ 枠線8）= 268 ≧ 84×3 ＋ 隙間8×2 = 268。
//
// 🔴 役割（L/S）を氏名の行から**バッジの行へ移した**。
//   84px では氏名とバッジが同居できず、氏名が削れる。
//   **氏名は削らない** ─ 誰が入っているか読めないプレートは意味が無い。
const PLATE_BOX = "w-[84px] shrink-0 rounded-lg border-2 px-1.5 py-1";

/** 所属のバッジ。色を持たせず、枠線と文字で読ませる */
const NEUTRAL_BADGE =
  "t-badge shrink-0 rounded border border-slate-300 bg-white px-0.5 leading-4 text-slate-600";

/** 資格バッジ。緑・細字ではなく、はっきり読める大きさにする */
function QualBadge({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      className="t-badge shrink-0 rounded border border-emerald-200 bg-emerald-50 px-0.5 leading-4 text-emerald-700"
    >
      {label}
    </span>
  );
}

export function Plate({ plate }: { plate: PlateView }) {
  const router = useRouter();
  const hasNg = plate.ngReasons.length > 0;
  const quals = plate.qualLabels;

  return (
    <div
      // 🔴 隊員マスタへはダブルクリックで飛ぶ（2026-09-09・柴山の要望）。
      //   プレートは掴んで動かすものなので、<Link> やシングルクリックにすると
      //   ドラッグの開始と取り合いになる。一覧のダブルクリックとも作法が揃う。
      onDoubleClick={() => router.push(`/masters/guards/${plate.guard.id}`)}
      title={
        hasNg
          ? plate.ngReasons.join(" / ") + "／ダブルクリックで隊員マスタ"
          : "ダブルクリックで隊員マスタを開く"
      }
      className={[
        PLATE_BOX,
        "cursor-grab select-none transition-all duration-150 ease-in-out hover:shadow-md",
        hasNg
          ? "border-rose-400 bg-rose-50"
          : plate.isPartner
            ? // 協力会社は色ではなく**地の濃さ**で分ける（給与対象外・請求が別のため区別は要る）
              "border-slate-300 bg-slate-100"
            : "border-slate-300 bg-white",
      ].join(" ")}
    >
      {/* 氏名の行。**ここには何も同居させない**（幅を氏名に全部使う） */}
      <div className="t-plate break-all leading-tight text-slate-900" title={plate.guard.name}>
        {plateName(plate.guard)}
      </div>

      {/* バッジの行。重要な順に置く。
          🔴 入り切らない分は**切らずに折り返す**（2026-10-05・柴山）。
          以前は overflow-hidden で切っており、列車見張・日勤済が増えて情報が消えていた。
          折り返した名札だけ背が伸びる（カードの行の高さが揃う）が、見えないよりよい */}
      <div className="mt-0.5 flex min-h-[16px] flex-wrap items-center gap-0.5">
        {hasNg && (
          <span
            className="t-badge shrink-0 leading-4 font-bold text-rose-600"
            title={plate.ngReasons.join(" / ")}
          >
            NG
          </span>
        )}
        {ROLE_LABEL[plate.role] && (
          <span
            className="t-badge shrink-0 rounded bg-slate-700 px-1 leading-4 text-white"
            title="隊長"
          >
            {ROLE_LABEL[plate.role]}
          </span>
        )}
        {quals.map((q) => (
          <QualBadge key={q} label={q} />
        ))}
        {plate.experienced && (
          // 🔴 ★ から「経」へ（2026-09-02）。記号は意味を覚えないと読めない。
          //   協・他と同じく**文字で読ませる**（色だけに頼らない方針と同じ理由）。
          <span className={NEUTRAL_BADGE} title="この現場に入った経験あり">
            経
          </span>
        )}
        {plate.isPartner && (
          <span className={NEUTRAL_BADGE} title="協力会社の隊員">
            協
          </span>
        )}
        {/* 🔴 「他管轄からの応援」バッジは出さない（2026-09-02・柴山判断）。
            バッジを増やすほど1枚あたりの読み取り量が減る。
            判定自体（PlateView.isOtherJurisdiction）は残してあるので、
            必要になれば1行戻すだけで出せる。プールの絞り込みでも使う。 */}
      </div>
    </div>
  );
}

/** プール（未配置）に並べる版 */
export function PoolPlate({ view, fill = false }: { view: GuardView; fill?: boolean }) {
  const { guard, isPartner, qualLabels: quals, doneLabel, trainLabels } = view;
  // 🔴 「列5」の中身（会社名）は乗せると出す（qual-labels.ts）
  const trainTitle =
    trainLabels && trainLabels.length > 0 ? `列車見張：${trainLabels.join("・")}` : undefined;
  return (
    <div
      className={[
        // 🔴 プールでは列の幅いっぱいに広げる（fill・2026-10-05）。
        //   4列 × 84px だと名前とバッジが入りきらず縦に伸びた。3列にして1枚を広げる（柴山）。
        //   ドラッグ中の影（DragOverlay）は枠の中の名札と同じ 84px のまま
        fill ? PLATE_BOX.replace("w-[84px]", "w-full") : PLATE_BOX,
        "cursor-grab select-none transition-all duration-150 ease-in-out hover:shadow-md",
        isPartner ? "border-slate-300 bg-slate-100" : "border-slate-300 bg-white",
      ].join(" ")}
    >
      <div className="t-plate break-all leading-tight text-slate-900" title={guard.name}>
        {plateName(guard)}
      </div>
      {/* 🔴 切らずに折り返す（上の Plate と同じ理由） */}
      <div className="mt-0.5 flex min-h-[16px] flex-wrap items-center gap-0.5">
        {quals.map((q) => (
          <QualBadge key={q} label={q} title={q.startsWith(TRAIN_PREFIX) ? trainTitle : undefined} />
        ))}
        {isPartner && (
          <span className={NEUTRAL_BADGE} title="協力会社の隊員">
            協
          </span>
        )}
        {/* 🔴 今日もう1回出ている人（2026-10-05）。amber＝「まだ気にすること」の色 */}
        {doneLabel && (
          <span
            className="t-badge shrink-0 rounded border border-amber-400 bg-amber-50 px-0.5 leading-4 text-amber-800"
            title={`この日はすでに${doneLabel.replace("済", "")}に入っています`}
          >
            {doneLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/** 未充足の空き枠。**赤で欠員だと分かるようにする**（見落とすと当日に事故る） */
export function EmptySlot() {
  return (
    <div className="flex h-[46px] w-[84px] shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-rose-300 bg-rose-50/50 text-rose-500">
      <span className="t-meta">空き ＋</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// D&D の取っ手（段2-③・2026-09-03）
//
// 🔴 プレートの中身には手を入れず、**外側に1枚かぶせる**形にした。
//   見た目の調整（幅・バッジ・色）と、動かす仕組みが同じ場所にあると、
//   どちらを直しても両方を壊しうる。分けておけば片方だけ触れる。
//
// 🔴 ラッパは幅を持たない（shrink-0 のみ）。プレート側が w-[84px] を
//   持っているので、flex の並びは1枚かぶせても変わらない。
//
// 🔴 touch-none を付ける。付けないとタブレットで
//   「ドラッグしたつもりが画面がスクロールする」になる。
// ─────────────────────────────────────────────────────────

/** ドラッグ中の元プレートは薄くする。掴んだものが2つ見えている状態を避ける */
const DRAGGING = "opacity-30";

export function DraggablePlate({
  plate,
  disabled,
}: {
  plate: PlateView;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `plate:${plate.assignmentId}`,
    data: { type: "plate", plate },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`shrink-0 touch-none ${isDragging ? DRAGGING : ""}`}
    >
      <Plate plate={plate} />
    </div>
  );
}

export function DraggablePoolPlate({
  view,
  disabled,
}: {
  view: GuardView;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pool:${view.guard.id}`,
    data: { type: "pool", view },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`touch-none ${isDragging ? DRAGGING : ""}`}
    >
      <PoolPlate view={view} fill />
    </div>
  );
}

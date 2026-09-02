// 隊員プレート。
//
// 🔴 **載せる情報は「配置の判断基準」に限る**（as-genjo-kansei.md §4-6 / screen-design.md §2-4）。
//    1. 資格   … 優先順位1位。「資格持ちがすぐ分かるようにしてほしい」＝現場からの直接の要望
//    2. ★経験 … 優先順位2位。「行ったことがある人で埋める」
//    3. ⚠NG   … 監督NG・不仲。**入れられない制約**
//    距離・交通費は載せない（判断基準として挙がらなかった。常時表示はノイズになる）。
//
// 見た目：**氏名を最も大きく**し、バッジは1段下げる。
//   所属は「枠線の色」で区別する（自社=灰／協力会社=橙／NG=赤）。
//   色だけに頼らず文字（協・他・⚠）も併記する。

// 🔴 資格ラベルは board.ts で畳んである（qualLabels）。
//   プレートを描くたびにマスタを引かせない（1日 約150枚 描く画面のため）。
import type { GuardView, PlateView } from "@/lib/types";

const ROLE_LABEL = { leader: "L", sub: "S", member: "" } as const;

// 🔴 プレート幅 112px の根拠（2026-09-02）
//   配置カードを箱組みにしたため、いちばん狭い箱（272px）の中に
//   **2枚並ぶ**ことが条件になった。
//   272 −（内側の余白20 ＋ 枠線10）= 242 ≧ 112×2 ＋ 隙間6 = 230。
//   これより広げると1名現場の箱でプレートが1枚しか入らず、縦に伸びる。
const PLATE_BOX = "w-[112px] shrink-0 rounded-lg border-2 px-1.5 py-1";

/** 資格バッジ。緑・細字ではなく、はっきり読める大きさにする */
function QualBadge({ label }: { label: string }) {
  return (
    <span className="t-badge shrink-0 rounded border border-emerald-300 bg-emerald-50 px-1.5 leading-5 text-emerald-800">
      {label}
    </span>
  );
}

export function Plate({ plate }: { plate: PlateView }) {
  const hasNg = plate.ngReasons.length > 0;
  const quals = plate.qualLabels;

  return (
    <div
      title={hasNg ? plate.ngReasons.join(" / ") : undefined}
      className={[
        PLATE_BOX,
        "cursor-grab select-none transition-all duration-150 ease-in-out hover:shadow-md",
        hasNg
          ? "border-rose-400 bg-rose-50"
          : plate.isPartner
            ? "border-amber-400 bg-amber-50"
            : "border-slate-300 bg-white",
      ].join(" ")}
    >
      <div className="flex items-center gap-1">
        <span className="t-plate truncate text-slate-900">{plate.guard.short_name}</span>
        {ROLE_LABEL[plate.role] && (
          <span className="t-badge ml-auto shrink-0 rounded bg-indigo-600 px-1.5 leading-5 text-white">
            {ROLE_LABEL[plate.role]}
          </span>
        )}
      </div>

      <div className="mt-1 flex min-h-[20px] items-center gap-1 overflow-hidden">
        {quals.map((q) => (
          <QualBadge key={q} label={q} />
        ))}
        {plate.experienced && (
          <span className="t-badge shrink-0 leading-5 text-amber-500" title="この現場の経験あり">
            ★
          </span>
        )}
        {plate.isPartner && (
          <span
            className="t-badge shrink-0 rounded border border-amber-400 px-1 leading-5 text-amber-800"
            title="協力会社の隊員"
          >
            協
          </span>
        )}
        {plate.isOtherJurisdiction && (
          <span
            className="t-badge shrink-0 rounded border border-sky-400 px-1 leading-5 text-sky-700"
            title="他管轄からの応援"
          >
            他
          </span>
        )}
        {hasNg && (
          <span className="t-badge ml-auto shrink-0 leading-5 text-rose-600" title={plate.ngReasons.join(" / ")}>
            ⚠ NG
          </span>
        )}
      </div>
    </div>
  );
}

/** プール（未配置）に並べる版 */
export function PoolPlate({ view }: { view: GuardView }) {
  const { guard, isPartner, qualLabels: quals } = view;
  return (
    <div
      className={[
        PLATE_BOX,
        "cursor-grab select-none transition-all duration-150 ease-in-out hover:shadow-md",
        isPartner ? "border-amber-400 bg-amber-50" : "border-slate-300 bg-white",
      ].join(" ")}
    >
      <div className="t-plate truncate text-slate-900">{guard.short_name}</div>
      <div className="mt-1 flex min-h-[20px] items-center gap-1 overflow-hidden">
        {quals.map((q) => (
          <QualBadge key={q} label={q} />
        ))}
        {isPartner && (
          <span className="t-badge shrink-0 rounded border border-amber-400 px-1 leading-5 text-amber-800">
            協
          </span>
        )}
      </div>
    </div>
  );
}

/** 未充足の空き枠。**赤で欠員だと分かるようにする**（見落とすと当日に事故る） */
export function EmptySlot() {
  return (
    <div className="flex h-[52px] w-[112px] shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-rose-300 bg-rose-50/50 text-rose-500">
      <span className="t-meta">空き ＋</span>
    </div>
  );
}

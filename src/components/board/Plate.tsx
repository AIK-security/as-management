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

// 🔴 資格ラベルは board.ts で畳んである（qualLabels）。
//   プレートを描くたびにマスタを引かせない（1日 約150枚 描く画面のため）。
import type { GuardView, PlateView } from "@/lib/types";

const ROLE_LABEL = { leader: "L", sub: "S", member: "" } as const;

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
function QualBadge({ label }: { label: string }) {
  return (
    <span className="t-badge shrink-0 rounded border border-emerald-200 bg-emerald-50 px-0.5 leading-4 text-emerald-700">
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
            ? // 協力会社は色ではなく**地の濃さ**で分ける（給与対象外・請求が別のため区別は要る）
              "border-slate-300 bg-slate-100"
            : "border-slate-300 bg-white",
      ].join(" ")}
    >
      {/* 氏名の行。**ここには何も同居させない**（幅を氏名に全部使う） */}
      <div className="t-plate truncate text-slate-900" title={plate.guard.name}>
        {plate.guard.short_name}
      </div>

      {/* バッジの行。入り切らない分は切れるので、**重要な順に置く**。
          NG は枠線と地色でも出ているため、切れても気づけないことは無い */}
      <div className="mt-0.5 flex min-h-[16px] items-center gap-0.5 overflow-hidden">
        {hasNg && (
          <span
            className="t-badge shrink-0 leading-4 font-bold text-rose-600"
            title={plate.ngReasons.join(" / ")}
          >
            NG
          </span>
        )}
        {ROLE_LABEL[plate.role] && (
          <span className="t-badge shrink-0 rounded bg-slate-700 px-1 leading-4 text-white">
            {ROLE_LABEL[plate.role]}
          </span>
        )}
        {quals.map((q) => (
          <QualBadge key={q} label={q} />
        ))}
        {plate.experienced && (
          <span className="t-badge shrink-0 leading-4 text-slate-500" title="この現場の経験あり">
            ★
          </span>
        )}
        {plate.isPartner && (
          <span className={NEUTRAL_BADGE} title="協力会社の隊員">
            協
          </span>
        )}
        {plate.isOtherJurisdiction && (
          <span className={NEUTRAL_BADGE} title="他管轄からの応援">
            他
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
        isPartner ? "border-slate-300 bg-slate-100" : "border-slate-300 bg-white",
      ].join(" ")}
    >
      <div className="t-plate truncate text-slate-900" title={guard.name}>
        {guard.short_name}
      </div>
      <div className="mt-0.5 flex min-h-[16px] items-center gap-0.5 overflow-hidden">
        {quals.map((q) => (
          <QualBadge key={q} label={q} />
        ))}
        {isPartner && (
          <span className={NEUTRAL_BADGE} title="協力会社の隊員">
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
    <div className="flex h-[46px] w-[84px] shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-rose-300 bg-rose-50/50 text-rose-500">
      <span className="t-meta">空き ＋</span>
    </div>
  );
}

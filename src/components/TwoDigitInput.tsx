// 時刻（時・分）の2桁入力。配置ボードの「現場を追加」と、
// マスタの現場編集（予定のひな形）の両方で使う。
//
// 🔴 共有する理由：同じ「時刻の2桁入力」を2か所で別々に持つと、
//   片方だけ直したときに挙動が食い違う。1名体制では気づけない。
"use client";

import { useState } from "react";

const FIELD =
  "h-9 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

/** 時刻（時・分）の入力。`0` を「00」と2桁で見せる（2026-09-08・管制の要望）。
 *
 * 🔴 `type="number"` は使えない。
 *   ブラウザが値を数値として正規化するため、"00" を渡しても "0" に戻る
 *   （2026-09-08 に実機で確認済み。仕様上は妥当な数値文字列だが、表示は保たれない）。
 *   → `type="text"` ＋ `inputMode="numeric"`（スマホで数字キーパッドが出る）にする。
 *   ⚠️ 代償として**上下の増減ボタンが消える**。ゼロ埋め表示とは両立しない。
 *
 * 🔴 入力中はゼロ埋めしない。
 *   打っている最中もゼロ埋めすると「00」で Backspace を押した瞬間に "00" へ戻り、
 *   打ち直せなくなる。→ **フォーカス中は打った文字のまま／外れたらゼロ埋め**。
 *
 * 🔴 数字以外と桁あふれは自分で弾く。
 *   `type="number"` をやめた時点で、ブラウザ側の入力制限が無くなるため。
 *   上限の丸めは**確定時（blur）だけ**行う ─ 打っている途中に丸めると
 *   「2」→「5」で 25 を打とうとした手が、23 に書き換えられて止まる。
 *
 * 親が持つ状態は今までどおり数値。呼び出し側の型は変えていない。
 */
export function TwoDigitInput({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  /** 時なら 23、分なら 59 */
  max: number;
}) {
  // null = 非編集中（＝ゼロ埋めして見せる）
  const [typing, setTyping] = useState<string | null>(null);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={typing ?? String(value).padStart(2, "0")}
      onFocus={() => setTyping(String(value))}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
        setTyping(digits);
        onChange(digits === "" ? 0 : Number(digits));
      }}
      onBlur={() => {
        onChange(Math.min(Math.max(value, 0), max));
        setTyping(null);
      }}
      className={FIELD + " w-14 text-right font-mono"}
    />
  );
}

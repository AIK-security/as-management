// 一括確定（ヘッダ）。
//
// 🔴 何を確定するのか＝**いま画面に出ている仮組みの枠**（得意先タブで絞っていれば
//   その範囲）。「画面の外のものが一緒に変わる」のがいちばん怖いので、
//   対象件数をボタンの文字に出す。押す前に範囲が分かる。
//
// 🔴 確認を挟む。40枠が一度に確定し、確定は EXCLUDE 制約を効かせ始める
//   （仮組み中に重ねてあった配置がここで初めて弾かれる）。
//   D&D と違って**押し間違いを目で戻せない**種類の操作なので、ここだけ一手増やす。
//
// 🔴 その確認に window.confirm を使わない（2026-09-04 変更）。
//   Chrome には「このページでこれ以上ダイアログを表示しない」がある。
//   一度これが効くと、以後 `confirm()` は**何も表示せず false を返す**。
//   ＝ボタンを押しても無反応になり、サーバには何も届かず、ログにも残らない。
//   利用者から見れば「壊れている」、こちらから見れば「何も起きていない」で、
//   いちばん追いにくい壊れ方をする。
//   → **確認は画面の中に出す。** ブラウザの設定で消えうるものに、
//     業務の関門を預けない。
"use client";

import { useState, useTransition } from "react";
import { confirmShifts } from "@/app/board/actions";

const BTN = "rounded-md border-2 px-3 py-1.5 text-[14px] font-semibold transition-all duration-150 ease-in-out";

export function ConfirmAllButton({ shiftIds }: { shiftIds: string[] }) {
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const none = shiftIds.length === 0;

  function handleConfirm() {
    setAsking(false);
    startTransition(async () => {
      const result = await confirmShifts({ shiftIds });
      setError(result.ok ? null : result.message);
    });
  }

  return (
    <>
      {asking ? (
        // 🔴 確認は「押した場所」に出す。別の場所に出すと、何に対する
        //   確認なのかが離れる。件数をもう一度書いて範囲を示す
        <div className="flex items-center gap-2 rounded-md border-2 border-amber-400 bg-amber-50 px-2.5 py-1">
          <span className="text-[14px] font-semibold text-amber-900">
            表示中の仮組み {shiftIds.length} 件を確定します
          </span>
          <button
            type="button"
            onClick={handleConfirm}
            className={`${BTN} cursor-pointer border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`}
          >
            確定する
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            className={`${BTN} cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
          >
            やめる
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          disabled={none || pending}
          title={
            none ? "確定できる仮組みの枠がありません" : `仮組み ${shiftIds.length} 件を確定`
          }
          className={[
            BTN,
            none || pending
              ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
              : "cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
          ].join(" ")}
        >
          {pending ? "確定中…" : `一括確定${none ? "" : `（${shiftIds.length}）`}`}
        </button>
      )}

      {/* 🔴 一括確定が落ちる原因はほぼ「時間帯の重複」。
          どこかで1件でも当たれば全部確定していない（actions.ts の判断）。
          何も言わずに閉じると「確定したつもり」になる */}
      {error && (
        <div
          role="alert"
          className="fixed top-16 left-1/2 z-50 flex max-w-[560px] -translate-x-1/2 items-start gap-3 rounded-lg border-2 border-rose-400 bg-white px-4 py-2.5 shadow-lg"
        >
          <span className="t-badge shrink-0 rounded bg-rose-100 px-1.5 py-0.5 leading-5 text-rose-700">
            確定できません
          </span>
          <span className="text-[14px] leading-snug text-slate-800">
            {error}
            <span className="mt-0.5 block text-slate-500">
              1件も確定していません。重なっている配置を直してからやり直してください。
            </span>
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-1 shrink-0 cursor-pointer rounded px-1.5 text-[13px] text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800"
          >
            閉じる
          </button>
        </div>
      )}
    </>
  );
}

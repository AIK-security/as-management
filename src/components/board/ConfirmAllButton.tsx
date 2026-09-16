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
//
// 🔴 その確認を**画面中央のダイアログにする**（2026-09-15 変更）。
//   以前はヘッダの「押した場所」に展開していた（何に対する確認かが離れないように）。
//   ところがヘッダは横一列に詰めてあるため、確認の文と2つのボタンが割り込むと
//   **日付と 東京/千葉 のタブが押し出されて一瞬崩れる**。
//   一括確定は毎日押すものなので、そのたびに画面が動くのは不自然に見える。
//   → **ヘッダのボタンは出したまま動かさず、確認は中央に重ねる。**
//     作法は `ShiftEditDialog` に合わせる（画面ごとに違うと 1名体制では覚えていられない）。
"use client";

import { useState, useTransition } from "react";
import { confirmShifts } from "@/app/board/actions";
import { callAction } from "@/lib/action-call";
import { HEADER_BTN } from "@/components/board/header-ui";

const BTN = "rounded-md border-2 px-3 py-1.5 text-[14px] font-semibold transition-all duration-150 ease-in-out";

export function ConfirmAllButton({ shiftIds }: { shiftIds: string[] }) {
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const none = shiftIds.length === 0;

  function handleConfirm() {
    setAsking(false);
    startTransition(async () => {
      const result = await callAction(() => confirmShifts({ shiftIds }));
      // 🔴 通信断のときは callAction が details を持たない失敗を返す（`in` で見る）
      setError(
        result.ok
          ? null
          : { message: result.message, details: "details" in result ? (result.details ?? []) : [] },
      );
    });
  }

  return (
    <>
      {/* 🔴 ボタンはダイアログを開いても**差し替えない**。
          ここが入れ替わるとヘッダの横幅の取り合いが起き、隣の日付とタブが動く */}
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={none || pending}
        title={none ? "確定できる仮組みの枠がありません" : `仮組み ${shiftIds.length} 件を確定`}
        className={[
          HEADER_BTN,
          none || pending
            ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
            : "cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
        ].join(" ")}
      >
        {pending ? "確定中…" : `一括確定${none ? "" : `（${shiftIds.length}）`}`}
      </button>

      {asking && (
        // 作法は ShiftEditDialog に合わせる。あちらは背が高いので上寄せだが、
        // これは短いので中央に置く
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-all-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-8"
          onClick={() => setAsking(false)}
        >
          <div
            className="w-[420px] rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="confirm-all-title"
              className="text-[16px] font-semibold tracking-tight text-slate-900"
            >
              仮組みを確定します
            </h2>

            {/* 🔴 件数をここでもう一度言う。押す前に範囲が分かるようにするのが確認の目的 */}
            <p className="mt-2 text-[14px] leading-snug text-slate-700">
              表示中の
              <span className="font-semibold">仮組み {shiftIds.length} 件</span>
              を確定します。
            </p>
            <p className="mt-1 text-[13px] leading-snug text-slate-500">
              画面に出ていない枠は変わりません。
              <br />
              確定すると時間帯の重複が弾かれるようになります。
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAsking(false)}
                className={`${BTN} cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
              >
                やめる
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className={`${BTN} cursor-pointer border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`}
              >
                確定する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔴 一括確定が落ちる原因はほぼ「時間帯の重複」。
          どこかで1件でも当たれば全部確定していない（actions.ts の判断）。
          何も言わずに閉じると「確定したつもり」になる */}
      {error && (
        <div
          role="alert"
          className="fixed top-16 left-1/2 z-50 flex max-w-[720px] -translate-x-1/2 items-start gap-3 rounded-lg border-2 border-rose-400 bg-white px-4 py-2.5 text-left shadow-lg"
        >
          <span className="t-badge mt-0.5 shrink-0 rounded bg-rose-100 px-1.5 py-0.5 leading-5 text-rose-700">
            確定できません
          </span>
          <div className="min-w-0 text-[14px] leading-snug text-slate-800">
            {error.message}
            <span className="mt-0.5 block text-slate-500">
              1件も確定していません。重なっている配置を直してからやり直してください。
            </span>

            {/* 🔴 誰が・どことどこで重なっているかを名前で出す（2026-09-04）。
                これが無いと、40枠のどこを直せばよいのか画面から分からない。
                多いときは全部は出さない ─ 読み切れない一覧は結局読まれない */}
            {error.details.length > 0 && (
              <ul className="mt-1.5 max-h-[40vh] space-y-0.5 overflow-y-auto border-t border-slate-200 pt-1.5">
                {error.details.slice(0, 8).map((d) => (
                  <li key={d} className="text-[13px] text-slate-700">
                    ・{d}
                  </li>
                ))}
                {error.details.length > 8 && (
                  <li className="t-meta text-slate-500">
                    ほか {error.details.length - 8} 件
                  </li>
                )}
              </ul>
            )}
          </div>
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

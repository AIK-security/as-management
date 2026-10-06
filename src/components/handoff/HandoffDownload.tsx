// べんり君へ渡す 18列CSV のダウンロード（S-02・2026-10-06）。
//
// 🔴 中身はサーバで組み立て済み（src/lib/handoff.ts）。ここはファイルにして渡すだけ。
// 🔴 UTF-8 の BOM を付ける（Excel で開いて確かめられるように・2026-09-08 の決定と同じ）。
//   読み込む側（べんり君のコピーに足す fncImportAndSend）は、先頭の BOM を外してから送ること。
"use client";

import { HEADER_BTN } from "@/components/board/header-ui";

export function HandoffDownload({
  csv,
  fileName,
  blockedReason,
}: {
  csv: string;
  fileName: string;
  /** 出してはいけない理由。あればボタンを押せなくする */
  blockedReason: string | null;
}) {
  function download() {
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (blockedReason) {
    return (
      <button
        type="button"
        disabled
        title={blockedReason}
        className={`${HEADER_BTN} cursor-not-allowed border-dashed border-slate-300 bg-slate-50 text-slate-400`}
      >
        CSV をダウンロード
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={download}
      className={`${HEADER_BTN} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`}
    >
      CSV をダウンロード
    </button>
  );
}

"use client";

// 選んだ瞬間にフォームを送るプルダウン（マスタ一覧の絞り込み・2026-10-02）。
//
// 🔴 ここだけクライアント側にする。MasterFrame は JS 無しで動く方針（hydration が止まっても動く）。
//   JS が効かなければ、隣の「検索」ボタンで同じ条件を送れる。
// 🔴 送るときに page は付かない（フォームに page の入力が無い）＝ 1ページ目へ戻る。
import type { ComponentProps } from "react";

export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

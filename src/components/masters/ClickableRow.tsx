// 行のダブルクリックで詳細を開く（2026-09-09）。
//
// 🔴 なぜ「開く」ボタンを残したままダブルクリックを足すのか（柴山の要望）
//   ・ダブルクリック … 一覧を見ながら次々に開く**慣れた手つき**（Excel と同じ）
//   ・「開く」リンク … **新しいタブで開ける**／JS が動く前でも押せる
//   どちらか一方だと片方の使い方が消える。両方置く。
//
// 🔴 シングルクリックでは飛ばさない。
//   一覧はセルの値をなぞって読む場所でもあり、1クリックで画面が変わると
//   読んでいる最中に飛ぶ。Excel の作法（ダブルクリックで開く）に合わせる。
"use client";

import { useRouter } from "next/navigation";

export function ClickableRow({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <tr
      className={className}
      onDoubleClick={() => router.push(href)}
      title="ダブルクリックで詳細を開く"
    >
      {children}
    </tr>
  );
}

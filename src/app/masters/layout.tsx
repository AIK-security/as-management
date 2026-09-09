// マスタ画面（S-10〜）の共通枠。
//
// 🔴 なぜマスタ画面が要るのか（2026-09-08）
//   9/7 に「現場を追加」を作ったが、**追加したものを見に行く場所が無い**。
//   さらに NG リストは「運用開始後に貯める」前提で設計してあり
//   （screen-design.md §10-3）、**貯める入口が無ければその前提が成立しない**。
//
// 🔴 2026-09-09：ヘッダのタブをやめ、行き先は左サイドバー（AppShell）へ移した。
//   ここは本体の余白を持つだけになる。
import { AppShell } from "@/components/AppShell";

export default function MastersLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">{children}</main>
    </AppShell>
  );
}

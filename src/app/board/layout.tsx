// 配置ボードの枠（2026-09-09）。
//
// 🔴 マスタと同じ外枠（左サイドバー）を使う。
//   これまで board/page.tsx が自分で h-screen の箱を持ち、ヘッダに
//   行き先（マスタ）・氏名・ログアウトまで並べていた。行き先はサイドバーへ移し、
//   ヘッダには**その画面の操作だけ**を残す。
import { AppShell } from "@/components/AppShell";

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

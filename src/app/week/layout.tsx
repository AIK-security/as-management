// A表（週表）の枠。配置ボード・マスタと同じ外枠（左サイドバー）を使う。
import { AppShell } from "@/components/AppShell";

export default function WeekLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

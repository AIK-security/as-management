// 一斉連絡（S-03）の枠。配置ボード・マスタと同じ外枠を使う。
import { AppShell } from "@/components/AppShell";

export default function NoticesLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

// 出力（S-20）の枠。配置ボードと同じ外枠を使う。
import { AppShell } from "@/components/AppShell";

export default function ExportLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

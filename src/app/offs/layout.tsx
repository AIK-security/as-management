// 休み管理の枠（2026-09-16）。配置ボード・A表と同じ外枠を使う。
import { AppShell } from "@/components/AppShell";

export default function OffsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

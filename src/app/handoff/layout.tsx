// べんり君への引き渡し（S-02）の枠。配置ボードと同じ外枠を使う。
import { AppShell } from "@/components/AppShell";

export default function HandoffLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

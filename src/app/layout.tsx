import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "配置管理 | AS 管制",
  description: "And Security 管制業務システム（第1弾：配置管理）",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

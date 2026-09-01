import type { NextConfig } from "next";

// 公開前セキュリティチェック（共通指針の必須関門）に対応するセキュリティヘッダー。
//
// 【警備番頭との違い】
// 警備番頭はレガシー HTML（インラインの onclick 116箇所）を抱えているため
// script-src に 'unsafe-inline' を残さざるを得ないが、**本プロジェクトはスクラッチであり
// レガシーが無い**。したがって最初から 'unsafe-inline' を入れない。
// 🔴 後から外すのは困難なので、最初から締めておく（設計原則4：放置しない仕組み）。
//
// 【Supabase をワイルドカードで書く理由】
// 接続先を .env から読まずに済ませるため。プロジェクト固有の URL を設定ファイルに
// 持たせない（環境変数はビルド時にしか参照できず、値の二重管理も避けたい）。

// `next dev` の React は、コールスタック復元などのデバッグ機能で eval() を使う。
// CSP で塞ぐとコンソールにエラーが出続け、本物のエラーを埋もれさせる。
// React は本番モードでは eval() を使わないため、開発時だけ許可する。
const unsafeEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  // 🔴 'unsafe-inline' を入れない。Next.js は自動で nonce を付与する。
  `script-src 'self'${unsafeEval}`,
  // Tailwind v4 はビルド済み CSS を出すが、Next.js が style タグを挿入するため 'unsafe-inline' が要る。
  // スタイルの inline はスクリプト実行に繋がらないため、リスクは script-src とは桁が違う。
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "upgrade-insecure-requests",
].join("; ");

// Strict-Transport-Security は Vercel が既に送出しているため指定しない（二重指定を避ける）。
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // `X-Powered-By: Next.js` を出さない。攻撃者に手がかりを渡さない方針。
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// 公開前セキュリティチェック（共通指針の必須関門）に対応するセキュリティヘッダー。
//
// 🔴 Content-Security-Policy はここに書かない（2026-09-02 に移動）。
//   headers() は**全リクエストで同じ値**しか返せないため nonce を載せられず、
//   `script-src 'self'`（'unsafe-inline' なし）を静的に送ると
//   Next.js のインラインスクリプトがブロックされ、**hydration が止まる**。
//   → src/lib/security-headers.ts ＋ src/proxy.ts でリクエストごとに発行する。
//   経緯と判断は security-headers.ts のコメントに全部書いてある。
//
// ここに残すのは「リクエストによって変わらないヘッダー」だけ。
//
// Strict-Transport-Security は Vercel が既に送出しているため指定しない（二重指定を避ける）。
const securityHeaders = [
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

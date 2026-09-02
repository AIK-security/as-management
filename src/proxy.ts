// Next.js 16 の Proxy（旧 middleware）。
// 役割は ① Supabase セッションの更新 ② 未認証リダイレクト ③ CSP の付与。
//
// 🔴 ランタイムは Node.js 固定。Proxy では runtime を指定するとエラーになる
//    （next/dist/docs .../file-conventions/proxy.md「Runtime」）。
//
// 🔴 CSP をここで作る理由（2026-09-02）
//    nonce は**リクエストごとに変わる**ため next.config.ts の headers() では出せない。
//    詳しい経緯は src/lib/security-headers.ts のコメント。
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security-headers";

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce);

  // 🔴 リクエスト側にも載せる。Next.js はレンダリング時に**リクエストの**
  //    Content-Security-Policy を読んで nonce を取り出し、自分が出す
  //    script タグに付ける。ここを忘れると nonce 無しのまま出力され、
  //    「見た目は出るが hydration しない」状態に戻る。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = await updateSession(request, requestHeaders);

  // レスポンス側（ブラウザが実際に従うのはこちら）。
  // リダイレクトを返す場合も含め、必ず付ける。
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // matcher を書かないと _next/static や画像まで Proxy を通り、
  // 認証チェックが CSS/JS の読み込みごと止めてしまう（公式ドキュメントの注意）。
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

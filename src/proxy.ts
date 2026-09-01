// Next.js 16 の Proxy（旧 middleware）。
// 役割は Supabase セッションの更新と未認証リダイレクトのみ（src/lib/supabase/proxy.ts）。
//
// 🔴 ランタイムは Node.js 固定。Proxy では runtime を指定するとエラーになる
//    （next/dist/docs .../file-conventions/proxy.md「Runtime」）。
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // matcher を書かないと _next/static や画像まで Proxy を通り、
  // 認証チェックが CSS/JS の読み込みごと止めてしまう（公式ドキュメントの注意）。
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

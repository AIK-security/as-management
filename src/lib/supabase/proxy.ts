// 全リクエストで Supabase セッション（Cookie）を更新し、
// 未認証アクセスをログインへ誘導するヘルパー。src/proxy.ts から呼ぶ。
//
// 🔴 Next.js 16 の規約変更
//   `middleware.ts` は非推奨になり `proxy.ts` にリネームされた
//   （node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md）。
//   警備番頭はまだ middleware.ts のままなので、**流用時にここだけ形が違う**。
//
// 🔴 これは認可の境界ではない。
//   公式ドキュメントも Proxy への依存を最小にするよう促している。
//   ここでやるのは「セッション更新」と「ログイン画面へ送る導線」だけ。
//   実際に守るのは (1) DB の RLS (2) 各ページの requireRole() の2つ。
//   Proxy だけに頼ると、パスの書き漏れがそのまま情報漏えいになる。
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

/** 未認証でも通すパス。ここに無いものは全てログインへ送る（既定は拒否）。 */
function isPublicPath(path: string) {
  return path === "/login" || path.startsWith("/auth");
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { url: supabaseUrl, anonKey } = supabaseEnv();
  const supabase = createServerClient(
    supabaseUrl,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() はトークンを検証・更新する（公式推奨）。
  // 🔴 getSession() は Cookie の中身をそのまま信じるため使わない。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && !isPublicPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // ログイン後に元のページへ戻すため、行き先を残す。
    // 🔴 パス（+クエリ）だけを渡す。外部URLを入れられるとオープンリダイレクトになる。
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  // ログイン済みでログイン画面を開いたらトップへ戻す。
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

// サーバ（Server Component / Route Handler / Server Action）用の Supabase クライアント。
// @supabase/ssr の createServerClient を使い、Next.js の Cookie と連携して
// セッションを復元・更新する。Next.js 16 では cookies() が非同期のため本関数も async。
//
// 流用元：keibi-bantou-cloud/src/lib/supabase/server.ts（同一スタックのため素直に移植）
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();

  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server Component から呼ばれた場合 Cookie は読み取り専用のため書けない。
          // セッションの更新は proxy.ts 側で行うので、ここは握りつぶしてよい。
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component からの呼び出し時は無視してよい。
          }
        },
      },
    },
  );
}

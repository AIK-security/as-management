// ブラウザ（Client Component）用の Supabase クライアント。
// Cookie 経由でサーバ側とセッションを共有する。
//
// 🔴 ここで使うのは anon key だけ。service_role key は**絶対にブラウザへ出さない**
//    （requirements.md §6 S-3）。service_role が要る処理はサーバ側に置く。
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}

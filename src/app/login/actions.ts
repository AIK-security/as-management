"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** 遷移先が自サイト内のパスかを確かめる。オープンリダイレクト対策。 */
function safeNext(next: string | null): string {
  if (!next) return "/board";
  // "//example.com" や "https://…" を弾く。先頭が "/" かつ2文字目が "/" でないもののみ許す。
  if (!next.startsWith("/") || next.startsWith("//")) return "/board";
  return next;
}

/**
 * Email/Password でログインする Server Action。招待制のため新規登録は無い。
 *
 * 🔴 失敗理由を画面に出さない。
 *   Supabase の生メッセージを返すと「そのメールは存在する／しない」が判別でき、
 *   利用者の総当たり（アカウント列挙）を助けてしまう。原因の切り分けは
 *   Supabase のログ側で行う。
 */
export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "") || null);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  revalidatePath("/", "layout");
  redirect(next);
}

/** ログアウトする Server Action。 */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

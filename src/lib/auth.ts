// 認証・ロールの共通ヘルパー。Server Component / Server Action から使う。
//
// 要件：docs/requirements.md §3（4ロール）
//   control 管制  … 配置の作成・確定・当日変更、引き渡し、連絡、マスタ編集
//   office  事務  … 🔴 配置の閲覧のみ ＋ 出力のダウンロード（編集不可）
//   admin   管理者… 全機能 ＋ ユーザー管理 ＋ 監査ログ
//   guard   隊員  … 🔴 第1弾では作らない（第3弾）
//
// 🔴 守りは3枚重ねる。どれか1枚が抜けても即漏えいにしない。
//   1. DB の RLS       … 最後の砦。ここだけは必ず効く
//   2. requireRole()   … 画面に入る前の関門（このファイル）
//   3. proxy.ts        … 未認証をログインへ送る導線（認可ではない）
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "control" | "office" | "admin";

/** 配置を編集できるロール。事務は含まない（requirements.md §3 決定 #2）。 */
export const EDITOR_ROLES: readonly Role[] = ["control", "admin"];

/** 画面に出すロール名。エラー文や見出しで使う。 */
export const roleLabel: Record<Role, string> = {
  control: "管制",
  office: "事務",
  admin: "管理者",
};

/** ログイン後の既定の入口。第1弾は全ロールが配置ボードを見る。 */
export const roleHome: Record<Role, string> = {
  control: "/board",
  office: "/board",
  admin: "/board",
};

export type SessionProfile = {
  id: string;
  role: Role;
  display_name: string | null;
};

/**
 * ログインユーザーと profile を取得する。
 * 未ログインなら user=null、profile 未割当なら profile=null。
 * profile は RLS により自分の行しか取れない。
 */
export async function getSessionProfile(): Promise<{
  user: { id: string; email?: string } | null;
  profile: SessionProfile | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  return { user, profile: (profile as SessionProfile | null) ?? null };
}

/**
 * ログイン済み かつ profile が割り当て済みであることを要求する。
 * 未ログイン → /login ／ profile 未割当 → /no-access
 *
 * 🔴 profile 未割当を「入れる」にしない。
 *   招待トリガーは user_metadata に role が無ければ profile を作らない。
 *   つまり未割当＝管理者がロールを決めていない状態であり、
 *   ここを素通りさせると「誰でもない人」が画面を開けてしまう。
 */
export async function requireStaff() {
  const { user, profile } = await getSessionProfile();
  if (!user) redirect("/login");
  if (!profile) redirect("/no-access");
  return { user, profile };
}

/** 指定したロールのいずれかであることを要求する。外れたら /no-access。 */
export async function requireRole(...allowed: Role[]) {
  const { user, profile } = await requireStaff();
  if (!allowed.includes(profile.role)) {
    redirect(`/no-access?need=${encodeURIComponent(allowed.join(","))}`);
  }
  return { user, profile };
}

/** 配置を編集できるか。画面内でボタンの出し分けに使う（関門ではない）。 */
export function canEdit(profile: SessionProfile) {
  return EDITOR_ROLES.includes(profile.role);
}

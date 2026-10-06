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
import { cache } from "react";
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
  /** 退職・異動で止めた人は false。行は消さない（監査ログの追跡のため）。 */
  is_active: boolean;
};

/**
 * ログインユーザーと profile を取得する。
 * 未ログインなら user=null、profile 未割当なら profile=null。
 * profile は RLS により自分の行しか取れない。
 *
 * 🔴 React の cache() で包む理由（2026-09-08）
 *   1画面を描くのに requireStaff() が**複数回**呼ばれる。
 *   例：/masters/sites は layout と page の両方が呼ぶ（関門を layout だけに
 *   預けない方針のため、これは意図した重複）。
 *   包まないと、そのたびに **getUser()（Auth サーバへの往復）と
 *   profiles の SELECT** が走り、往復が2倍になる。
 *
 *   cache() は**同一リクエスト内**でのみ結果を使い回す。
 *   リクエストをまたいだ共有はしないので、
 *   「別の人のセッションが混ざる」ことは起きない。
 *   ＝ 関門を減らさずに往復だけ減らせる。
 */
export const getSessionProfile = cache(async function getSessionProfile(): Promise<{
  user: { id: string; email?: string } | null;
  profile: SessionProfile | null;
}> {
  const supabase = await createClient();
  // 🔴 getUser() ではなく getClaims()（2026-10-06）。
  //   proxy.ts が**毎リクエスト** getUser() で Auth サーバに確かめ、セッションも更新している。
  //   ここでもう一度 Auth サーバへ往復すると、1画面ごとに同じ確認を2回待つことになる。
  //   getClaims() は手元のトークンの署名を検証する（公開鍵は一度取れば使い回す）。
  //   署名方式が旧式（HS256）のプロジェクトでは、中で getUser() に落ちる＝遅くはならないが速くもならない。
  //   このプロジェクトは新しい方式で、40〜140ms → 5〜19ms になった（柴山の手元で実測）。
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const user = claims?.sub ? { id: claims.sub, email: claims.email } : null;
  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, display_name, is_active")
    .eq("id", user.id)
    .maybeSingle();

  return { user, profile: (profile as SessionProfile | null) ?? null };
});

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
  // 🔴 無効化された人はここで止める。DB 側でも current_app_role() が null を返すため
  //    RLS で行も引けないが、**理由を出すため**にアプリ側でも見る。
  if (!profile.is_active) redirect("/no-access?reason=inactive");
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

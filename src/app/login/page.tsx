// ログイン画面。
// 🔴 招待制のため新規登録の導線は置かない（管理者が Supabase 側でユーザーを作る）。
//    隊員ログインも置かない ─ 隊員ロールは第3弾（requirements.md §3）。
import { login } from "./actions";

export const metadata = { title: "ログイン | AS 管制" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <main className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          配置管理
        </h1>
        <p className="t-meta mt-1 text-slate-500">And Security 管制業務システム</p>

        {error && (
          <p className="mt-4 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            メールアドレスまたはパスワードが違います。
          </p>
        )}

        <form action={login} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next ?? "/board"} />

          <label className="flex flex-col gap-1 text-sm text-slate-700">
            メールアドレス
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-slate-900 outline-none transition-all duration-150 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-700">
            パスワード
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-slate-900 outline-none transition-all duration-150 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>

          <button
            type="submit"
            className="mt-2 h-9 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white transition-all duration-150 hover:bg-indigo-700"
          >
            ログイン
          </button>
        </form>

        <p className="t-meta mt-6 border-t border-slate-200 pt-4 text-slate-500">
          アカウントは管理者が発行します。ログインできない場合は柴山までご連絡ください。
        </p>
      </main>
    </div>
  );
}

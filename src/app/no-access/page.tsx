// ロールが未割当、または必要な権限が無いときの行き止まり画面。
//
// 🔴 「なぜ入れないか」を出す。
//   黙ってトップへ飛ばすと、利用者は何度もログインし直したうえで
//   「システムが壊れている」と受け取る。定着施策の一部（schedule-plan.md §5）。
import { getSessionProfile, roleLabel, type Role } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export const metadata = { title: "権限がありません | AS 管制" };

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ need?: string }>;
}) {
  const { need } = await searchParams;
  const { profile } = await getSessionProfile();

  const needLabels = (need ?? "")
    .split(",")
    .filter(Boolean)
    .map((r) => roleLabel[r as Role] ?? r)
    .join("・");

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <main className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-base font-semibold tracking-tight text-slate-900">
          この画面を開く権限がありません
        </h1>

        <dl className="mt-3 flex flex-col gap-1 text-sm text-slate-700">
          <div className="flex gap-2">
            <dt className="t-meta w-24 shrink-0 pt-0.5 text-slate-500">現在の権限</dt>
            <dd>
              {profile
                ? roleLabel[profile.role]
                : "未割当（管理者がまだ権限を設定していません）"}
            </dd>
          </div>
          {needLabels && (
            <div className="flex gap-2">
              <dt className="t-meta w-24 shrink-0 pt-0.5 text-slate-500">必要な権限</dt>
              <dd>{needLabels}</dd>
            </div>
          )}
        </dl>

        <p className="t-meta mt-4 text-slate-500">
          権限の変更は管理者（柴山）が行います。
        </p>

        <form action={logout} className="mt-4">
          <button
            type="submit"
            className="h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50"
          >
            ログアウト
          </button>
        </form>
      </main>
    </div>
  );
}

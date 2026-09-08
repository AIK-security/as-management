// マスタ画面（S-10〜）の共通枠。ヘッダとタブだけを持つ。
//
// 🔴 なぜマスタ画面が要るのか（2026-09-08）
//   9/7 に「現場を追加」を作ったが、**追加したものを見に行く場所が無い**。
//   さらに NG リストは「運用開始後に貯める」前提で設計してあり
//   （screen-design.md §10-3）、**貯める入口が無ければその前提が成立しない**。
//
// 🔴 ここでも requireStaff() を通すが、これは関門の1枚目にすぎない。
//   各ページでも呼ぶ（layout は将来キャッシュされうるため、
//   layout だけに認可を預けない）。最後の砦は DB の RLS。
import Link from "next/link";
import { requireStaff, roleLabel } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { MasterTabs } from "@/components/masters/MasterTabs";

export default async function MastersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireStaff();

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex shrink-0 items-center gap-3 border-b-2 border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        {/* 🔴 いちばん左は「配置ボードへ戻る」。
            マスタは配置作業の途中で寄る場所であり、終点ではない */}
        <Link
          href="/board"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          ◀ 配置ボード
        </Link>
        <span className="text-[18px] font-semibold tracking-tight text-slate-900">マスタ</span>

        <MasterTabs />

        <div className="ml-auto flex items-center gap-2 border-l-2 border-slate-200 pl-3">
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[14px] font-semibold text-slate-800">
              {profile.display_name ?? "（氏名未設定）"}
            </span>
            <span className="t-meta text-slate-500">{roleLabel[profile.role]}</span>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border-2 border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
            >
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">{children}</main>
    </div>
  );
}

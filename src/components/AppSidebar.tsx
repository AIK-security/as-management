// 左サイドバー（2026-09-09）。
//
// 🔴 なぜヘッダのボタン列をやめたのか（柴山・2026-09-09）
//   「画面の上部に一つずつボタンを設けるのも限界がある」。実際そうなっていた ─
//   配置ボードのヘッダには 日付送り／管轄／日勤夜勤／集計3つ／現場追加／一括確定／
//   連絡作成／引き渡し／マスタ／氏名／ログアウト が**1行に並んでいた**。
//   画面が増えるほど破綻するので、**行き先（ナビ）だけを左へ出す**。
//
// 🔴 ヘッダに残すのは「その画面の操作」だけ。行き先はここ。
//   日付送りや一括確定は配置ボードの操作なのでヘッダに残す。
//
// 🔴 hydration が止まっても壊れない作りにする（MasterTabs と同じ）。
//   usePathname はサーバ側でも解決されるため、**HTML の時点で現在地が濃くなり**、
//   中身はただの <Link>。JS が動かなくても遷移はできる。
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; match: string };

const NAV: { heading: string; items: Item[] }[] = [
  {
    heading: "配置",
    items: [{ href: "/board", label: "配置ボード", match: "/board" }],
  },
  {
    heading: "マスタ",
    items: [
      { href: "/masters/sites", label: "現場", match: "/masters/sites" },
      { href: "/masters/guards", label: "隊員", match: "/masters/guards" },
      { href: "/masters/customers", label: "得意先", match: "/masters/customers" },
      { href: "/masters/ng", label: "NG", match: "/masters/ng" },
    ],
  },
];

export function AppSidebar({
  displayName,
  role,
  logout,
}: {
  displayName: string;
  role: string;
  /** ログアウトの Server Action。form の action にそのまま渡す */
  logout: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-2.5">
        <div className="text-[15px] font-semibold tracking-tight text-slate-900">配置管理</div>
        <div className="t-meta text-slate-500">And Security</div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-2">
        {NAV.map((group) => (
          <div key={group.heading} className="mb-2">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {group.heading}
            </div>
            {group.items.map((item) => {
              const active = pathname === item.match || pathname.startsWith(item.match + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "block border-l-2 px-3 py-1.5 text-[14px] transition-all duration-150 ease-in-out",
                    active
                      ? "border-indigo-600 bg-indigo-50 font-semibold text-indigo-700"
                      : "border-transparent font-medium text-slate-600 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-slate-200 px-3 py-2">
        <div className="text-[13px] font-semibold leading-tight text-slate-800">{displayName}</div>
        <div className="t-meta mb-1.5 text-slate-500">{role}</div>
        <form action={logout}>
          <button
            type="submit"
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
          >
            ログアウト
          </button>
        </form>
      </div>
    </nav>
  );
}

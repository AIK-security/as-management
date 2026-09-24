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
// 🔴 hydration が止まっても壊れない作りにする。
//   usePathname はサーバ側でも解決されるため、**HTML の時点で現在地が濃くなり**、
//   中身はただの <Link>。JS が動かなくても遷移はできる。
//
// 🔴 A表（週）では細い帯に畳む（2026-09-24・柴山）。
//   週表は 現場列＋7日＋隊員プール で横幅を使い切る。サイドバー 208px を残すと、
//   Windows の拡大表示（125%）で使える幅 約1,526px に **プールを開いたまま7日が入らない**
//   （必要 208 + 1,226 + 260 = 1,694px）。帯にすれば 56 + 1,226 + 260 = 1,542px。
//   開閉ボタンにしないのは、週表で広げる理由が無く、押す手間だけが増えるため。
//   項目名は2文字の略称にする（アイコン用のパッケージを足さない・N-1）。
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; match: string; /** 畳んだ帯に出す2文字 */ short: string };

const NAV: { heading: string; items: Item[] }[] = [
  {
    heading: "配置",
    items: [
      { href: "/board", label: "配置ボード", match: "/board", short: "配置" },
      // 🔴 管制は「A表」と呼ぶ。画面名も業務の呼び名に合わせる（2026-09-15）
      { href: "/week", label: "A表（週）", match: "/week", short: "A表" },
      { href: "/notices", label: "連絡作成", match: "/notices", short: "連絡" },
      // 🔴 休みは配置の一部（2026-09-16）。マスタではなくここに置く ──
      //   「今日誰が出られるか」を決める作業そのものだから
      { href: "/offs", label: "休み", match: "/offs", short: "休み" },
    ],
  },
  {
    heading: "マスタ",
    items: [
      { href: "/masters/sites", label: "現場", match: "/masters/sites", short: "現場" },
      { href: "/masters/guards", label: "隊員", match: "/masters/guards", short: "隊員" },
      { href: "/masters/customers", label: "得意先", match: "/masters/customers", short: "得意" },
      { href: "/masters/ng", label: "NG", match: "/masters/ng", short: "NG" },
      { href: "/masters/import", label: "取込", match: "/masters/import", short: "取込" },
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
  const isActive = (item: Item) => pathname === item.match || pathname.startsWith(item.match + "/");

  if (pathname === "/week" || pathname.startsWith("/week/")) {
    return (
      <nav className="flex w-14 shrink-0 flex-col border-r border-slate-200 bg-white" aria-label="メニュー">
        <div className="border-b border-slate-200 py-2.5 text-center text-[13px] font-semibold tracking-tight text-slate-900">
          AS
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-2">
          {NAV.map((group, gi) => (
            // 見出しの代わりに区切り線だけ置く（2文字の帯に見出しは入らない）
            <div key={group.heading} className={gi > 0 ? "mt-1.5 border-t border-slate-200 pt-1.5" : ""}>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  className={[
                    "block border-l-2 py-1.5 text-center text-[13px] transition-all duration-150 ease-in-out",
                    isActive(item)
                      ? "border-indigo-600 bg-indigo-50 font-semibold text-indigo-700"
                      : "border-transparent font-medium text-slate-600 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {item.short}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 px-1 py-2">
          <form action={logout}>
            <button
              type="submit"
              title={`${displayName}（${role}）をログアウト`}
              className="w-full rounded-md border border-slate-300 bg-white px-0.5 py-1 text-[11px] font-medium leading-tight text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
            >
              ログ
              <br />
              アウト
            </button>
          </form>
        </div>
      </nav>
    );
  }

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
              const active = isActive(item);
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

// マスタのタブ。現在地の判定に現在のパスが要るため、ここだけクライアント側。
//
// 🔴 hydration が止まっても壊れない。
//   usePathname はサーバ側レンダリングでも解決されるため、
//   **HTML の時点で正しいタブが濃くなり、中身はただの <Link>** で動く。
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/masters/sites", label: "現場" },
  { href: "/masters/guards", label: "隊員" },
  { href: "/masters/customers", label: "得意先" },
  { href: "/masters/ng", label: "NG" },
] as const;

export function MasterTabs() {
  const pathname = usePathname();

  return (
    <div className="flex overflow-hidden rounded-md border-2 border-slate-300">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={[
              "px-4 py-1 text-[15px] font-semibold transition-all duration-150 ease-in-out",
              active
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

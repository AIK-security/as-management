// マスタ画面（S-10〜）の共通部品。
//
// 🔴 すべてサーバコンポーネントのままにする。
//   検索は素の `<form method="get">`、ページ送りは `<Link>`。
//   クライアント JS を1行も持たないので、**hydration が止まっても動く**
//   （2026-09-02 に CSP で hydration を殺した前例がある）。
//   マスタは「探して見る」画面で、配置ボードのような即時操作は要らない。
//
// 🔴 表の作りは共通デザインルールに従う。
//   ヘッダは bg-slate-50 / text-xs / uppercase、行間は詰め、
//   セル間の縦線は入れず横線だけ。行ホバーでマウス位置を示す。
import Link from "next/link";
import { PAGE_SIZE, type MasterList } from "@/lib/masters";

/** 検索欄。GET フォームなので JS 不要。 */
export function SearchForm({
  action,
  q,
  placeholder,
}: {
  action: string;
  q: string;
  placeholder: string;
}) {
  return (
    <form action={action} method="get" className="flex items-center gap-2">
      {/* 🔴 検索したら1ページ目へ戻す。page を残すと
          「3ページ目の絞り込み結果」＝ たいてい空振り になる */}
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        className="h-9 w-80 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
      <button
        type="submit"
        className="h-9 rounded-md bg-indigo-600 px-3 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700"
      >
        検索
      </button>
      {q && (
        <Link
          href={action}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[14px] font-medium leading-9 text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          解除
        </Link>
      )}
    </form>
  );
}

/** 件数とページ送り。 */
export function Pager<T>({
  action,
  q,
  list,
}: {
  action: string;
  q: string;
  list: MasterList<T>;
}) {
  const href = (page: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (page > 1) sp.set("page", String(page));
    const s = sp.toString();
    return s ? `${action}?${s}` : action;
  };

  const first = list.total === 0 ? 0 : (list.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(list.page * PAGE_SIZE, list.total);

  const btn =
    "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100";
  const btnOff = "rounded-md border border-slate-200 px-2.5 py-1 text-[13px] text-slate-300";

  return (
    <div className="flex items-center gap-3">
      <span className="t-meta text-slate-500">
        {/* 🔴 「全◯件のうち◯〜◯件」を必ず出す。
            件数が出ないと、絞り込みが効いているのか空振りなのか区別できない */}
        全 <span className="font-semibold tabular-nums text-slate-700">{list.total}</span> 件
        {list.total > 0 && (
          <>
            {" "}
            <span className="tabular-nums">
              （{first}–{last}）
            </span>
          </>
        )}
      </span>
      <div className="flex items-center gap-1">
        {list.page > 1 ? (
          <Link href={href(list.page - 1)} className={btn}>
            ◀ 前
          </Link>
        ) : (
          <span className={btnOff}>◀ 前</span>
        )}
        <span className="t-meta px-1 tabular-nums text-slate-500">
          {list.page} / {list.pageCount}
        </span>
        {list.page < list.pageCount ? (
          <Link href={href(list.page + 1)} className={btn}>
            次 ▶
          </Link>
        ) : (
          <span className={btnOff}>次 ▶</span>
        )}
      </div>
    </div>
  );
}

/** 表の外枠。ヘッダ行だけ固定して縦スクロールさせる。 */
export function MasterTable({
  head,
  children,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // 🔴 横方向は表自身の中でスクロールさせる。画面ごと横に伸ばさない
    <div className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-left">
          <tr className="border-b border-slate-200">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-middle text-slate-700 ${className}`}>{children}</td>;
}

export function Row({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-slate-100 transition-all duration-150 ease-in-out hover:bg-slate-50">
      {children}
    </tr>
  );
}

/** 0件のときの表示。「壊れている」と「該当が無い」を言い分ける。 */
export function EmptyRow({ colSpan, q }: { colSpan: number; q: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-[14px] text-slate-500">
        {q ? (
          <>
            「<span className="font-semibold text-slate-700">{q}</span>」に一致する行はありません。
          </>
        ) : (
          "データがありません。"
        )}
      </td>
    </tr>
  );
}

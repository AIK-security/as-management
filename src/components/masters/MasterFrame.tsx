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
import { ClickableRow } from "@/components/masters/ClickableRow";
import { AutoSubmitSelect } from "@/components/masters/AutoSubmitSelect";
import { PAGE_SIZE, type MasterList, type MasterQuery } from "@/lib/masters";

/** 検索条件の一部（NG のように並べ替え・絞り込みを持たない一覧もある） */
type QueryLike = Pick<MasterQuery, "q"> & Partial<Omit<MasterQuery, "q">>;

/**
 * 一覧の URL を組み立てる（2026-10-02）。
 * 🔴 検索語・並べ替え・絞り込みを**いつも全部引き継ぐ**。
 *   ページ送りや見出しのクリックで条件が1つでも落ちると、「さっきと違う一覧」になる。
 *   既定値（1ページ目・昇順・空の絞り込み）は URL に書かない。
 */
export function masterHref(action: string, query: QueryLike, patch: Partial<MasterQuery> = {}) {
  const v = { ...query, ...patch };
  const sp = new URLSearchParams();
  if (v.q) sp.set("q", v.q);
  if (v.j) sp.set("j", v.j);
  if (v.st) sp.set("st", v.st);
  if (v.co) sp.set("co", v.co);
  if (v.sort) sp.set("sort", v.sort);
  if (v.sort && v.dir === "desc") sp.set("dir", "desc");
  if (v.page && v.page > 1) sp.set("page", String(v.page));
  const s = sp.toString();
  return s ? `${action}?${s}` : action;
}

/** 絞り込みのプルダウン1つぶん */
export type FilterDef = {
  name: "j" | "st" | "co";
  label: string;
  options: { value: string; label: string }[];
};

/**
 * 検索欄。GET フォームなので JS 不要。
 * 🔴 絞り込みのプルダウンは選んだ瞬間に送る（AutoSubmitSelect）。JS が止まっていても「検索」で送れる。
 * 🔴 並べ替えは hidden で引き継ぐ。検索し直したら並びが既定に戻る、を起こさない。
 */
export function SearchForm({
  action,
  q,
  placeholder,
  query,
  filters = [],
}: {
  action: string;
  q: string;
  placeholder: string;
  query?: QueryLike;
  filters?: FilterDef[];
}) {
  const active = filters.some((f) => query?.[f.name]);
  return (
    <form action={action} method="get" className="flex flex-wrap items-center gap-2">
      {query?.sort && <input type="hidden" name="sort" value={query.sort} />}
      {query?.sort && query.dir === "desc" && <input type="hidden" name="dir" value="desc" />}
      {filters.map((f) => (
        <AutoSubmitSelect
          key={f.name}
          name={f.name}
          defaultValue={query?.[f.name] ?? ""}
          aria-label={f.label}
          className={[
            "h-9 rounded-md border px-2 text-[14px] transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20",
            query?.[f.name]
              ? "border-indigo-400 bg-indigo-50 text-indigo-800"
              : "border-slate-300 bg-white text-slate-700",
          ].join(" ")}
        >
          <option value="">{f.label}：すべて</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {f.label}：{o.label}
            </option>
          ))}
        </AutoSubmitSelect>
      ))}
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
      {(q || active) && (
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
  query,
  list,
}: {
  action: string;
  q: string;
  /** 並べ替え・絞り込みを引き継ぐ。無い一覧（NG）は q だけ */
  query?: QueryLike;
  list: MasterList<T>;
}) {
  const href = (page: number) => masterHref(action, query ?? { q }, { page });

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
      {/* 🔴 w-full にしない（2026-09-08）。
          列が少ないときに w-full だと、余った幅が各列へ配られて
          「情報は少ないのに列だけ異様に広い」表になる。
          w-max + min-w-full にすると、**内容の幅で詰めたうえで**
          足りなければ画面幅まで伸びる。 */}
      <table className="w-max min-w-full border-collapse text-[13px]">
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
      className={`whitespace-nowrap px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}

/**
 * 押すと並べ替わる見出し（2026-10-02）。もう一度押すと逆順。
 * 🔴 <Link> なので JS 不要。並べ替えたら1ページ目へ戻す（並びが変わればページの中身も変わる）。
 */
export function SortTh({
  children,
  action,
  query,
  sortKey,
  isDefault = false,
  className = "",
}: {
  children: React.ReactNode;
  action: string;
  query: MasterQuery;
  sortKey: string;
  /** 何も指定していないときの並び（＝ この列の昇順）なら true */
  isDefault?: boolean;
  className?: string;
}) {
  const current = query.sort ? query.sort === sortKey : isDefault;
  const dir = query.sort ? query.dir : "asc";
  const next = current && dir === "asc" ? "desc" : "asc";
  return (
    <th
      scope="col"
      aria-sort={current ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`whitespace-nowrap px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${className}`}
    >
      <Link
        href={masterHref(action, query, { sort: sortKey, dir: next, page: 1 })}
        className={[
          "inline-flex items-center gap-0.5 rounded px-0.5 transition-all duration-150 ease-in-out hover:bg-slate-200 hover:text-slate-800",
          current ? "text-indigo-700" : "text-slate-500",
        ].join(" ")}
        title={`${typeof children === "string" ? children : "この列"}で並べ替え`}
      >
        {children}
        <span className={current ? "" : "text-slate-300"}>
          {current ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
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
  // 🔴 既定で折り返さない（2026-09-08）。
  //   1行が2段になると、行の高さが揃わず一覧として読めなくなる。
  //   長い値は truncate させ、全文は title 属性で見せる（Cell 参照）。
  return (
    <td className={`whitespace-nowrap px-3 py-1.5 align-middle text-slate-700 ${className}`}>
      {children}
    </td>
  );
}

/** 長い値（現場名・住所・メール）用。幅を決めて切り、全文は hover で出す。 */
export function Ellipsis({
  value,
  width = "max-w-[220px]",
}: {
  value: string | null | undefined;
  width?: string;
}) {
  if (!value) return <span className="text-slate-300">—</span>;
  return (
    <span className={`block truncate ${width}`} title={value}>
      {value}
    </span>
  );
}

export function Row({
  children,
  href,
}: {
  children: React.ReactNode;
  /** 指定すると行全体が詳細へのリンクになる */
  href?: string;
}) {
  const className = [
    "border-b border-slate-100 transition-all duration-150 ease-in-out hover:bg-slate-50",
    href ? "cursor-pointer" : "",
  ].join(" ");

  // 🔴 ダブルクリックで開けるようにする（2026-09-09・柴山の要望）。
  //   ここだけクライアント側になる（onDoubleClick が要るため）。
  //   行末の「開く」は**残す** ─ 新しいタブで開く手段と、JS 前の導線を消さない。
  const body = (
    <>
      {children}
      {/* 🔴 <tr> を <Link> で包めない（HTML として不正）。
          行末に「開く」を1列だけ置き、そこをリンクにする。
          行全体を JS のクリックで飛ばす手もあるが、
          それだと**新しいタブで開けない**うえ hydration 前に反応しない。 */}
      {href && (
        <td className="whitespace-nowrap px-3 py-1.5 text-right">
          <Link
            href={href}
            className="t-meta rounded border border-slate-300 px-1.5 py-0.5 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800"
          >
            開く
          </Link>
        </td>
      )}
    </>
  );

  if (!href) return <tr className={className}>{body}</tr>;
  return (
    <ClickableRow href={href} className={className}>
      {body}
    </ClickableRow>
  );
}

/** 0件のときの表示。「壊れている」と「該当が無い」を言い分ける。 */
export function EmptyRow({
  colSpan,
  q,
  filtered = false,
}: {
  colSpan: number;
  q: string;
  /** 絞り込みが効いているか（「データが無い」と言い分ける） */
  filtered?: boolean;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-[14px] text-slate-500">
        {q ? (
          <>
            「<span className="font-semibold text-slate-700">{q}</span>」に一致する行はありません
            {filtered && "（絞り込み中）"}。
          </>
        ) : filtered ? (
          "絞り込みに一致する行はありません。"
        ) : (
          "データがありません。"
        )}
      </td>
    </tr>
  );
}

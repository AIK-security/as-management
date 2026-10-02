// S-12 得意先マスタ 一覧（2026-09-08）
//
// 🔴 現場数を出す。
//   「毎日たくさん現場をくれる会社が1社、残りは数社」というのが管制の実感で
//   （screen-design.md §2-3）、配置ボードの得意先タブもその前提で作ってある。
//   一覧でも規模が見えないと、タブの並びと頭の中が繋がらない。
//
// 🔴 得意先は新規作成しない（2026-09-07 決定）。
//   ShiftMax 由来のマスタで、請求（第2弾）の突き合わせに使うため。
//   ここは**閲覧だけ**で正しい。
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import {
  listCustomers,
  listJurisdictionOptions,
  parseMasterQuery,
  type MasterSearchParams,
} from "@/lib/masters";
import {
  Ellipsis,
  EmptyRow,
  MasterTable,
  Pager,
  Row,
  SearchForm,
  SortTh,
  Td,
  Th,
} from "@/components/masters/MasterFrame";

const ACTION = "/masters/customers";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<MasterSearchParams>;
}) {
  await requireStaff();

  const query = parseMasterQuery(await searchParams);
  const [list, jurisdictions] = await Promise.all([
    listCustomers(query),
    listJurisdictionOptions(),
  ]);
  const filtered = Boolean(query.j);
  const sortProps = { action: ACTION, query };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchForm
          action={ACTION}
          q={query.q}
          query={query}
          placeholder="得意先名・フリガナ・担当コードで検索"
          filters={[
            {
              name: "j",
              label: "管轄",
              options: jurisdictions.map((j) => ({ value: j.code, label: j.name })),
            },
          ]}
        />
        <div className="flex items-center gap-2">
          <Pager action={ACTION} q={query.q} query={query} list={list} />
          {/* 🔴 新規登録の入口（2026-09-09）。これまで一覧に入口が無く、
              現場は配置ボード経由の仮番号でしか作れず、隊員・得意先は作れなかった。
              権限の出し分けはしない ─ 押した先の requireRole() と RLS で止める。 */}
          <Link href="/masters/customers/new" className="rounded-md bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700">
            ＋ 得意先を新規登録
          </Link>
        </div>
      </div>

      <MasterTable
        head={
          <>
            {/* 🔴 見出しを押すと並べ替え（2026-10-02）。既定はフリガナ順 */}
            <SortTh {...sortProps} sortKey="code">
              担当コード
            </SortTh>
            <SortTh {...sortProps} sortKey="name" isDefault>
              得意先名
            </SortTh>
            <Th>フリガナ</Th>
            <Th>担当</Th>
            <Th>請求番号</Th>
            <Th>請求名</Th>
            <SortTh {...sortProps} sortKey="jurisdiction">
              管轄
            </SortTh>
            <SortTh {...sortProps} sortKey="sites" className="text-right">
              現場数
            </SortTh>
          </>
        }
      >
        {list.rows.length === 0 ? (
          <EmptyRow colSpan={8} q={query.q} filtered={filtered} />
        ) : (
          list.rows.map((c) => (
            <Row key={c.id} href={`/masters/customers/${c.id}`}>
              <Td className="font-mono tabular-nums text-slate-500">{c.staff_code}</Td>
              <Td className="font-semibold text-slate-900">
                <Ellipsis value={c.name} width="max-w-[220px]" />
              </Td>
              <Td className="text-slate-500">
                <Ellipsis value={c.name_kana} width="max-w-[200px]" />
              </Td>
              <Td className="text-slate-500">{c.contact_name ?? "—"}</Td>
              <Td className="font-mono tabular-nums text-slate-500">{c.billing_no ?? "—"}</Td>
              <Td className="text-slate-500">
                <Ellipsis value={c.billing_name} width="max-w-[200px]" />
              </Td>
              <Td className="text-slate-500">{c.jurisdiction_name ?? "—"}</Td>
              <Td className="text-right font-mono font-semibold tabular-nums text-slate-700">
                {c.site_count}
              </Td>
            </Row>
          ))
        )}
      </MasterTable>
    </>
  );
}

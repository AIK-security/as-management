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
import { requireStaff } from "@/lib/auth";
import { listCustomers, parseMasterQuery } from "@/lib/masters";
import {
  Ellipsis,
  EmptyRow,
  MasterTable,
  Pager,
  Row,
  SearchForm,
  Td,
  Th,
} from "@/components/masters/MasterFrame";

const ACTION = "/masters/customers";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireStaff();

  const query = parseMasterQuery(await searchParams);
  const list = await listCustomers(query);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchForm action={ACTION} q={query.q} placeholder="得意先名・フリガナ・担当コードで検索" />
        <Pager action={ACTION} q={query.q} list={list} />
      </div>

      <MasterTable
        head={
          <>
            <Th>担当コード</Th>
            <Th>得意先名</Th>
            <Th>フリガナ</Th>
            <Th>担当</Th>
            <Th>請求番号</Th>
            <Th>請求名</Th>
            <Th>管轄</Th>
            <Th className="text-right">現場数</Th>
          </>
        }
      >
        {list.rows.length === 0 ? (
          <EmptyRow colSpan={8} q={query.q} />
        ) : (
          list.rows.map((c) => (
            <Row key={c.id}>
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
              <Td className="text-slate-500">{c.jurisdiction?.name ?? "—"}</Td>
              <Td className="text-right font-mono font-semibold tabular-nums text-slate-700">
                {/* 集計は配列1件で返る。0件のときは配列自体が空になりうる */}
                {c.site_count[0]?.count ?? 0}
              </Td>
            </Row>
          ))
        )}
      </MasterTable>
    </>
  );
}

// S-10 現場マスタ 一覧（2026-09-08）
//
// 🔴 行の「開く」から詳細・編集へ入る（2026-09-08 追加）。
//   一覧だけでは台帳として使えない、という指摘への対応。
//   なお「新規作成のときに何が必須か」の線引きは 9/16 に管制へ聞く。
//   それは**作る速さ**の話で、既にある現場を直すこの画面とは別。
//
// 🔴 警備先番号は現場に持たせない（2026-10-02）。一覧は現場コードを出す。
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { listSites, parseMasterQuery } from "@/lib/masters";
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

const ACTION = "/masters/sites";

/** 予定時刻。持っていない現場もあるので「—」で潰す */
function planTime(h: number | null, m: number | null) {
  if (h === null || m === null) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  // 🔴 layout でも通しているが、ここでも通す（関門を layout だけに預けない）
  await requireStaff();

  const query = parseMasterQuery(await searchParams);
  const list = await listSites(query);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchForm action={ACTION} q={query.q} placeholder="現場名・略称・現場コードで検索" />
        <div className="flex items-center gap-2">
          <Pager action={ACTION} q={query.q} list={list} />
          {/* 🔴 新規登録の入口（2026-09-09）。これまで一覧に入口が無く、
              現場は配置ボード経由でしか作れず、隊員・得意先は作れなかった。
              権限の出し分けはしない ─ 押した先の requireRole() と RLS で止める。 */}
          <Link href="/masters/sites/new" className="rounded-md bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700">
            ＋ 現場を新規登録
          </Link>
        </div>
      </div>

      <MasterTable
        head={
          <>
            <Th>現場コード</Th>
            <Th>現場名</Th>
            <Th>フリガナ</Th>
            <Th>略称</Th>
            <Th>得意先</Th>
            <Th>管轄</Th>
            <Th>部署</Th>
            <Th>予定</Th>
            <Th className="text-right">休憩</Th>
            <Th>住所</Th>
            <Th>請求番号</Th>
            <Th>状態</Th>
            <Th> </Th>
          </>
        }
      >
        {list.rows.length === 0 ? (
          <EmptyRow colSpan={13} q={query.q} />
        ) : (
          list.rows.map((s) => {
            const start = planTime(s.plan_start_h, s.plan_start_m);
            const end = planTime(s.plan_end_h, s.plan_end_m);
            return (
              <Row key={s.id} href={`/masters/sites/${s.id}`}>
                <Td className="font-mono tabular-nums text-slate-500">{s.site_code}</Td>
                <Td className="font-semibold text-slate-900">
                  <Ellipsis value={s.name} width="max-w-[240px]" />
                </Td>
                <Td className="text-slate-500">
                  <Ellipsis value={s.name_kana} width="max-w-[180px]" />
                </Td>
                <Td className="text-slate-500">{s.short_name}</Td>
                <Td>
                  <Ellipsis value={s.customer?.name} width="max-w-[160px]" />
                  {!s.customer && (
                    // 🔴 「（あとで設定する）」で作った現場がここに出る。
                    //   放置すると請求（第2弾）の突き合わせで詰まるため目立たせる
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[12px] font-medium text-amber-800">
                      未設定
                    </span>
                  )}
                </Td>
                <Td className="text-slate-500">{s.jurisdiction?.name ?? "—"}</Td>
                <Td className="text-slate-500">{s.department?.name ?? "—"}</Td>
                <Td className="font-mono tabular-nums">
                  {start && end ? (
                    `${start}–${end}`
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Td>
                <Td className="text-right font-mono tabular-nums">
                  {s.plan_break ?? <span className="text-slate-400">—</span>}
                </Td>
                <Td className="text-slate-500">
                  <Ellipsis value={s.address} width="max-w-[200px]" />
                </Td>
                <Td className="font-mono tabular-nums text-slate-500">{s.billing_no ?? "—"}</Td>
                <Td>
                  {s.status === "active" ? (
                    <span className="t-badge text-emerald-700">稼働</span>
                  ) : (
                    <span className="t-badge text-slate-400">停止</span>
                  )}
                </Td>
              </Row>
            );
          })
        )}
      </MasterTable>
    </>
  );
}

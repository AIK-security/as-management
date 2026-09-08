// S-10 現場マスタ 一覧（2026-09-08）
//
// 🔴 まず「見る」だけを作る。編集は付けない。
//   現場の詳細項目は「その場で必ず要る情報／後で埋めればいい情報」の線引きを
//   9/16 の管制 MTG で聞く予定であり（logs/2026-09-07.md 申し送り）、
//   **聞く前に編集画面を作ると、聞く前に仕様を決めたことになる。**
//   それは AIK assign が使われなくなった構図そのもの。
//
// 🔴 検索は警備先番号でも引ける。べんり君の入力キーがそれだから
//   （要件は資産に合わせて曲げない）。
import { requireStaff } from "@/lib/auth";
import { listSites, parseMasterQuery } from "@/lib/masters";
import {
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
        <SearchForm action={ACTION} q={query.q} placeholder="現場名・略称・警備先番号で検索" />
        <Pager action={ACTION} q={query.q} list={list} />
      </div>

      <MasterTable
        head={
          <>
            <Th className="w-28">警備先番号</Th>
            <Th>現場名</Th>
            <Th className="w-32">略称</Th>
            <Th className="w-56">得意先</Th>
            <Th className="w-24">管轄</Th>
            <Th className="w-40">予定</Th>
            <Th className="w-16">休憩</Th>
            <Th className="w-16">状態</Th>
          </>
        }
      >
        {list.rows.length === 0 ? (
          <EmptyRow colSpan={8} q={query.q} />
        ) : (
          list.rows.map((s) => {
            const start = planTime(s.plan_start_h, s.plan_start_m);
            const end = planTime(s.plan_end_h, s.plan_end_m);
            return (
              <Row key={s.id}>
                <Td className="font-mono tabular-nums text-slate-500">{s.guard_target_no}</Td>
                <Td className="font-semibold text-slate-900">{s.name}</Td>
                <Td className="text-slate-500">{s.short_name}</Td>
                <Td>
                  {s.customer?.name ?? (
                    // 🔴 「（あとで設定する）」で作った現場がここに出る。
                    //   放置すると請求（第2弾）の突き合わせで詰まるため目立たせる
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[12px] font-medium text-amber-800">
                      未設定
                    </span>
                  )}
                </Td>
                <Td className="text-slate-500">{s.jurisdiction?.name ?? "—"}</Td>
                <Td className="font-mono tabular-nums">
                  {start && end ? (
                    `${start} – ${end}`
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Td>
                <Td className="text-right font-mono tabular-nums">
                  {s.plan_break ?? <span className="text-slate-400">—</span>}
                </Td>
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

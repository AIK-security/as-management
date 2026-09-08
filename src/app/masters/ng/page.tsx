// S-13 NG リスト（2026-09-08）
//
// 🔴 この画面が第1弾で持つ意味
//   配置の完全自動化は目指さないと決めた（8/27）。判断基準に人間関係・監督NG・
//   不仲が含まれるためで、その代わり**NG リストは必須**とした。
//   ただし中身は誰も持っておらず、「運用開始後に貯める」前提で器だけ作ってある。
//   → **貯める入口がここ。** 空のまま MTG に出せば「で、これは何ですか」で終わる。
//
// 🟠 9/16 の管制 MTG では、この画面を見せて
//   「思いつくものを2〜3件その場で入れてもらう」のが目的。
//   仕様を先に決めず、実物を見せて引き出す（screen-design.md §10-3）。
import { canEdit, requireStaff } from "@/lib/auth";
import { listNgEntries, listNgPicks, ngReasonLabel, parseMasterQuery } from "@/lib/masters";
import { NgAddDialog } from "@/components/masters/NgAddDialog";
import { NgDeleteButton } from "@/components/masters/NgDeleteButton";
import {
  EmptyRow,
  MasterTable,
  Pager,
  Row,
  SearchForm,
  Td,
  Th,
} from "@/components/masters/MasterFrame";

const ACTION = "/masters/ng";

export default async function NgPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { profile } = await requireStaff();
  const editable = canEdit(profile);

  const query = parseMasterQuery(await searchParams);
  // 🔴 選択肢は編集できる人にだけ取りに行く。事務が開いたときに
  //   隊員・現場の全件を無駄に読まない
  const [list, picks] = await Promise.all([
    listNgEntries(query),
    editable ? listNgPicks() : Promise.resolve({ guards: [], sites: [] }),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchForm action={ACTION} q={query.q} placeholder="理由の本文で検索" />
        <div className="flex items-center gap-3">
          <Pager action={ACTION} q={query.q} list={list} />
          {editable && <NgAddDialog guards={picks.guards} sites={picks.sites} />}
        </div>
      </div>

      <MasterTable
        head={
          <>
            <Th className="w-40">種類</Th>
            <Th className="w-48">隊員</Th>
            <Th className="w-64">現場 / 相手</Th>
            <Th className="w-24">区分</Th>
            <Th>理由</Th>
            <Th className="w-28">強さ</Th>
            <Th className="w-28">登録日</Th>
            {editable && <Th className="w-24"> </Th>}
          </>
        }
      >
        {list.rows.length === 0 ? (
          <EmptyRow colSpan={editable ? 8 : 7} q={query.q} />
        ) : (
          list.rows.map((n) => (
            <Row key={n.id}>
              <Td>
                <span className="t-badge rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                  {n.kind === "site_guard" ? "現場 × 隊員" : "隊員 × 隊員"}
                </span>
              </Td>
              <Td className="font-semibold text-slate-900">{n.guardName}</Td>
              <Td>{n.kind === "site_guard" ? n.siteName : n.counterpartName}</Td>
              <Td className="text-slate-500">{ngReasonLabel[n.reason_kind]}</Td>
              <Td className="text-slate-700">{n.reason}</Td>
              <Td>
                {n.severity === "block" ? (
                  <span className="t-badge rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">
                    絶対に出せない
                  </span>
                ) : (
                  <span className="t-badge text-amber-700">なるべく避ける</span>
                )}
              </Td>
              <Td className="font-mono tabular-nums text-slate-500">
                {/* 保存は UTC。表示は JST の日付だけにする（時刻までは要らない） */}
                {new Date(n.created_at).toLocaleDateString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                })}
              </Td>
              {editable && (
                <Td>
                  <NgDeleteButton id={n.id} />
                </Td>
              )}
            </Row>
          ))
        )}
      </MasterTable>
    </>
  );
}

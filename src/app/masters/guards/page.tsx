// S-11 隊員マスタ 一覧（2026-09-08）
//
// 🔴 資格は「持っているか」だけでなく**期限が切れていないか**を出す。
//   資格をテーブルで持ったのは有効期限のためで（data-model.md §5-2）、
//   一覧に出さないなら期限を持っている意味がない。
//   配置ボードの警告と同じ判断材料を、ここでも同じ形で見せる。
//
// 🔴 協力会社の隊員は個人コード（ShiftMax）を持たない。
//   持っていないことが**異常ではない**と分かるように「—」で潰し、
//   会社の欄で自社／協力会社を色分けする。
import { requireStaff } from "@/lib/auth";
import { listGuards, parseMasterQuery } from "@/lib/masters";
import { todayInJst } from "@/lib/board";
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

const ACTION = "/masters/guards";

/** 雇用区分。DB の値をそのまま出しても管制には通じない */
const employmentLabel: Record<string, string> = {
  employee: "社員",
  part_time: "パート",
  partner: "協力",
};

export default async function GuardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireStaff();

  const query = parseMasterQuery(await searchParams);
  const list = await listGuards(query);
  // 🔴 期限の判定は JST の今日で行う。Vercel は UTC で動くため
  //    素の Date に任せると本番だけ1日ずれる（board/page.tsx と同じ理由）。
  const today = todayInJst();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchForm action={ACTION} q={query.q} placeholder="氏名・フリガナ・個人コードで検索" />
        <Pager action={ACTION} q={query.q} list={list} />
      </div>

      <MasterTable
        head={
          <>
            <Th>個人コード</Th>
            <Th>隊員No</Th>
            <Th>氏名</Th>
            <Th>フリガナ</Th>
            <Th>略称</Th>
            <Th>会社</Th>
            <Th>区分</Th>
            <Th>管轄</Th>
            <Th>部署</Th>
            <Th>資格</Th>
            <Th>メール</Th>
            <Th>状態</Th>
          </>
        }
      >
        {list.rows.length === 0 ? (
          <EmptyRow colSpan={12} q={query.q} />
        ) : (
          list.rows.map((g) => (
            <Row key={g.id}>
              <Td className="font-mono tabular-nums text-slate-500">
                {g.staff_code ?? <span className="text-slate-300">—</span>}
              </Td>
              <Td className="font-mono tabular-nums text-slate-500">
                {g.guard_no ?? <span className="text-slate-300">—</span>}
              </Td>
              <Td className="font-semibold text-slate-900">{g.name}</Td>
              <Td className="text-slate-500">{g.name_kana ?? "—"}</Td>
              <Td className="text-slate-500">{g.short_name}</Td>
              <Td>
                <span
                  className={
                    g.company?.kind === "partner"
                      ? "rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-medium text-slate-600"
                      : "text-slate-700"
                  }
                >
                  {g.company?.name ?? "—"}
                </span>
              </Td>
              <Td className="text-slate-500">{employmentLabel[g.employment_type] ?? g.employment_type}</Td>
              <Td className="text-slate-500">{g.jurisdiction?.name ?? "—"}</Td>
              <Td className="text-slate-500">{g.department?.name ?? "—"}</Td>
              <Td>
                <div className="flex gap-1">
                  {g.guard_qualifications.length === 0 ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    g.guard_qualifications.map((q, i) => {
                      // 期限なし（null）は「切れない資格」。期限切れだけを赤で出す。
                      const expired = q.expires_on !== null && q.expires_on < today;
                      return (
                        <span
                          key={i}
                          title={
                            q.qualification?.name +
                            (q.expires_on ? `（期限 ${q.expires_on}）` : "")
                          }
                          className={[
                            "t-badge rounded px-1.5 py-0.5",
                            expired
                              ? "bg-rose-100 text-rose-700 line-through"
                              : "bg-indigo-50 text-indigo-700",
                          ].join(" ")}
                        >
                          {q.qualification?.short_label ?? "?"}
                        </span>
                      );
                    })
                  )}
                </div>
              </Td>
              <Td className="text-slate-500">
                <Ellipsis value={g.email} width="max-w-[200px]" />
              </Td>
              <Td>
                {g.status === "active" ? (
                  <span className="t-badge text-emerald-700">在籍</span>
                ) : (
                  <span className="t-badge text-slate-400">停止</span>
                )}
              </Td>
            </Row>
          ))
        )}
      </MasterTable>
    </>
  );
}

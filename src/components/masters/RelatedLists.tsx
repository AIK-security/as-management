// 隊員の稼働履歴／得意先の現場一覧（2026-09-09）。どちらも読むだけ。
//
// 🔴 読むだけにしてある理由は現場の配置枠と同じ。
//   稼働を直すのは配置ボード、現場を直すのは現場詳細。同じ操作を2か所に作らない。
//   ここは「そこへ辿れる」ことが仕事。
import Link from "next/link";
import type { CustomerSiteRow, GuardAssignmentRow } from "@/lib/masters";
import { Section } from "@/components/masters/FormBits";

const TH =
  "border-b border-slate-200 py-1 pr-2 text-left text-[11px] font-semibold uppercase text-slate-500";

function hhmm(h: number | null, m: number | null) {
  if (h === null || m === null) return "—";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const OFF_KIND: Record<string, string> = {
  paid_leave: "有給休暇",
  training: "研修・講習",
  medical: "健康診断",
  absent_self: "欠勤（自己都合）",
  absent_company: "欠勤（会社都合）",
  night_duty: "夜勤明け",
  substitute_holiday: "振替休日",
  control: "管制",
  office: "事務",
  standby: "待機",
};

const WORK_KIND: Record<string, string> = {
  day: "日勤",
  nightA: "夜勤A",
  nightB: "夜勤B",
  dayCancel: "日勤中止",
  nightCancel: "夜勤中止",
};

/** 隊員の稼働履歴。A表の下部にある「有給／研修／管制」の行と同じ情報が並ぶ */
export function GuardAssignmentList({ rows }: { rows: GuardAssignmentRow[] }) {
  return (
    <Section title="稼働" hint="直近30件・日付順。直すのは配置ボード">
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-white">
            <tr>
              <th className={TH}>日付</th>
              <th className={TH}>区分</th>
              <th className={TH}>行き先</th>
              <th className={TH}>役割</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-slate-400">
                  稼働の記録はまだありません。
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const group = r.workKind?.startsWith("night") ? "night" : "day";
              return (
                <tr
                  key={r.id}
                  className="border-b border-slate-100 transition-all duration-150 ease-in-out hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap py-1.5 pr-2 font-mono tabular-nums text-slate-700">
                    {r.work_date}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-slate-600">
                    {r.kind === "site"
                      ? (r.workKind && WORK_KIND[r.workKind]) || "現場"
                      : r.kind === "lent_out"
                        ? "貸出"
                        : "休み等"}
                  </td>
                  <td className="py-1.5 pr-2 text-slate-700">
                    {r.kind === "site"
                      ? (r.siteName ?? "—")
                      : r.kind === "lent_out"
                        ? (r.external_site_name ?? "（貸出先未記入）")
                        : (r.off_kind && OFF_KIND[r.off_kind]) || "—"}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-slate-500">
                    {r.role === "leader" ? "隊長" : "隊員"}
                    {r.is_long_distance && (
                      <span className="t-badge ml-1 rounded bg-slate-100 px-1 py-0.5 text-slate-600">
                        遠距離
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5">
                    {r.kind === "site" && (
                      <Link
                        href={`/board?date=${r.work_date}&group=${group}`}
                        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[12px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
                      >
                        ボードで開く
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** 得意先が持つ現場。A表は得意先ごとに現場が束ねられているので、この単位が要る */
export function CustomerSiteList({ rows }: { rows: CustomerSiteRow[] }) {
  return (
    <Section title="この得意先の現場" hint="A表は得意先ごとに現場が並ぶ">
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-white">
            <tr>
              <th className={TH}>警備先番号</th>
              <th className={TH}>現場名</th>
              <th className={TH}>略称</th>
              <th className={TH}>班</th>
              <th className={TH}>予定</th>
              <th className={TH}>状態</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-2 text-slate-400">
                  この得意先の現場はありません。
                </td>
              </tr>
            )}
            {rows.map((s) => (
              <tr
                key={s.id}
                className="border-b border-slate-100 transition-all duration-150 ease-in-out hover:bg-slate-50"
              >
                <td className="whitespace-nowrap py-1.5 pr-2 font-mono tabular-nums text-slate-500">
                  {s.guard_target_no}
                </td>
                <td className="py-1.5 pr-2">
                  <Link
                    href={`/masters/sites/${s.id}`}
                    className="font-semibold text-indigo-700 transition-all duration-150 ease-in-out hover:underline"
                  >
                    {s.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-slate-500">{s.short_name}</td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-slate-500">
                  {s.band_name ?? "—"}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 font-mono tabular-nums text-slate-600">
                  {hhmm(s.plan_start_h, s.plan_start_m)}–{hhmm(s.plan_end_h, s.plan_end_m)}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2">
                  {s.status === "active" ? (
                    <span className="t-badge text-emerald-700">稼働</span>
                  ) : (
                    <span className="t-badge text-slate-400">停止</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

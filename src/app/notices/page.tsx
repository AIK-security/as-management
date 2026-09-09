// S-03 一斉連絡（2026-09-09）。
//
// 🔴 送信チャネルは作らない（2026-08-27 決定）。宛先と文面を「作る」までが第1弾。
// 🔴 対象日は前日／当日を選べる（前日に送る運用があるため・2026-09-09）。
//   既定は**翌日**＝前日連絡。当日変更のときだけ「今日」に切り替える。
//
// ⚠️ 暫定方針であり確定ではない（screen-design.md §4-1）。9/16 の管制ヒアリングで詰める。
import Link from "next/link";
import { requireStaff, canEdit } from "@/lib/auth";
import { addDays, todayInJst } from "@/lib/board-format";
import {
  getNoticeTargets,
  listJurisdictionsForNotice,
  listMessageTemplates,
  listNotices,
} from "@/lib/notices";
import type { BoardShiftGroup } from "@/lib/board";
import { NoticeComposer } from "@/components/notices/NoticeComposer";

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; j?: string; group?: string }>;
}) {
  const { profile } = await requireStaff();
  const sp = await searchParams;

  const today = todayInJst();
  // 既定は翌日ぶん（前日連絡）
  const workDate = sp.date ?? addDays(today, 1);
  const group: BoardShiftGroup = sp.group === "night" ? "night" : "day";

  const jurisdictions = await listJurisdictionsForNotice();
  const jurisdiction = jurisdictions.find((j) => j.code === sp.j) ?? jurisdictions[0];

  if (!jurisdiction) {
    return (
      <main className="p-4">
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          管轄が1件も登録されていません。先にマスタを投入してください。
        </p>
      </main>
    );
  }

  const [targets, templates, history] = await Promise.all([
    getNoticeTargets(workDate, jurisdiction.id, group),
    listMessageTemplates(),
    listNotices(8),
  ]);

  const editable = canEdit(profile);
  const href = (p: Record<string, string>) => {
    const q = new URLSearchParams({ date: workDate, j: jurisdiction.code, group, ...p });
    return `/notices?${q.toString()}`;
  };
  const tab =
    "px-3 py-1 text-[14px] font-semibold transition-all duration-150 ease-in-out";

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 p-4 print:p-0">
      {/* ══ ヘッダ ══════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">連絡作成</h1>

        {/* 🔴 前日／当日。既定は翌日ぶん（前日に送る運用がある） */}
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {[
            { d: addDays(today, 1), label: "明日ぶん" },
            { d: today, label: "今日ぶん" },
          ].map((o) => (
            <Link
              key={o.d}
              href={href({ date: o.d })}
              className={[
                tab,
                workDate === o.d ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              {o.label}
            </Link>
          ))}
        </div>
        {/* 🔴 日付を直接指定できるようにする（2026-09-09）。
            「明日／今日」だけだと、それ以外の日の配置に連絡を出せない。
            当日変更でも前日でもない日（週明けぶんをまとめて など）は普通にある。
            form の GET なので JS が動かなくても効く。 */}
        <form method="get" action="/notices" className="flex items-center gap-1">
          <input type="hidden" name="j" value={jurisdiction.code} />
          <input type="hidden" name="group" value={group} />
          <input
            type="date"
            name="date"
            defaultValue={workDate}
            className="h-9 rounded-md border border-slate-300 px-2 font-mono text-[14px] tabular-nums text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
          >
            表示
          </button>
        </form>

        {jurisdictions.length > 1 && (
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            {jurisdictions.map((j) => (
              <Link
                key={j.id}
                href={href({ j: j.code })}
                className={[
                  tab,
                  j.id === jurisdiction.id
                    ? "bg-slate-700 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                {j.name}
              </Link>
            ))}
          </div>
        )}

        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {(["day", "night"] as const).map((g) => (
            <Link
              key={g}
              href={href({ group: g })}
              className={[
                tab,
                group === g ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              {g === "day" ? "日勤" : "夜勤"}
            </Link>
          ))}
        </div>

        <Link
          href={`/board?date=${workDate}&j=${jurisdiction.code}&group=${group}`}
          className="ml-auto rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          この日の配置ボード
        </Link>
      </div>

      {/* ⚠️ 送信はしない、を画面でも言う。押せば送られると思われると事故になる */}
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] leading-snug text-amber-900 print:hidden">
        🔴 <span className="font-semibold">このシステムからは送信しません。</span>
        宛先と文面を作るところまでです（2026-08-27 決定）。LINE はコピーして貼り、
        <span className="font-semibold">LINE が繋がらないぶんは電話リストを印刷して電話する</span>
        運用を想定しています。
      </p>

      {editable ? (
        <NoticeComposer
          workDate={workDate}
          jurisdictionId={jurisdiction.id}
          shiftGroup={group}
          targets={targets}
          templates={templates}
        />
      ) : (
        <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-600">
          閲覧のみの権限です。連絡の作成は管制・管理者が行います。
        </p>
      )}

      {/* ══ 履歴（親だけ） ═══════════════════════════════ */}
      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm print:hidden">
        <h2 className="mb-2 text-[13px] font-semibold tracking-tight text-slate-900">
          連絡の履歴
          <span className="t-meta ml-2 font-normal text-slate-500">
            直近8件。「送信済にする」を押した記録（実際の送信は外で行うため自己申告）
          </span>
        </h2>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase text-slate-500">
              <th className="py-1 pr-2">対象日</th>
              <th className="py-1 pr-2">区分</th>
              <th className="py-1 pr-2">宛先</th>
              <th className="py-1 pr-2">内訳</th>
              <th className="py-1 pr-2">記録</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-slate-400">
                  まだ記録はありません。
                </td>
              </tr>
            )}
            {history.map((h) => (
              <tr key={h.id} className="border-b border-slate-100">
                <td className="whitespace-nowrap py-1.5 pr-2 font-mono tabular-nums text-slate-700">
                  {h.work_date}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-slate-600">
                  {h.shift_group === "day" ? "日勤" : "夜勤"}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 font-semibold tabular-nums text-slate-800">
                  {h.target_count} 名
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-slate-500 tabular-nums">
                  LINE {h.reachable_count}／電話 {h.phone_count}／会社 {h.company_count}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 font-mono text-slate-500">
                  {h.sent_at ? h.sent_at.slice(0, 16).replace("T", " ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

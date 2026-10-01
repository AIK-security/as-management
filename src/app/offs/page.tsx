// S-08 休み管理（2026-09-16）。
//
// 🔴 9/16 の管制 MTG で決まった「休みを管理できるようにする」の第1弾ぶん。
//   将来は**隊員が申請 → 管制が承認 → 本人に結果が伝わる**が、
//   申請の経路（隊員ポータル）は第2弾なので、ここは**管制が代理で入れる**形にしてある。
//
// 🔴 第1弾の範囲は「休みを入れられる」「入れた休みが配置に効く」の2つだけ。
//   有給の付与・残日数・回復日は**持たない**（第3弾／MTG でも「今はやらない」と確認）。
//
// 🔴 休みが配置に効く、の中身は board.ts 側にある：
//   休みの隊員は隊員プールから消え、プール下部の「非現場」に氏名で出る。
//   一部勤務可（日勤だけ休み・夜Aだけ休み）は、**その区分の盤面からだけ**消える。
import { requireStaff, canEdit } from "@/lib/auth";
import { OffGrid } from "@/components/offs/OffGrid";
import { todayInJst } from "@/lib/board";
import { getOffMonth, monthStart, shiftMonth } from "@/lib/offs";
import Link from "next/link";

export default async function OffsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; h?: string }>;
}) {
  // 🔴 ここが実際の関門。proxy.ts は導線であって認可ではない。
  const { profile } = await requireStaff();
  const editable = canEdit(profile);

  const sp = await searchParams;
  const today = todayInJst();
  const month = monthStart(sp.m, today).slice(0, 7);
  const data = await getOffMonth(month);

  // 🔴 半月ずつ見せる（2026-10-01）。1か月を横に並べるとマスが 26px しか取れず、
  //   「マス・文字が小さい」と管制に言われた。半月なら言葉（有給・休み）で書ける。
  //   既定は今日を含む側。今月でなければ前半から。
  const isThisMonth = month === today.slice(0, 7);
  const half: 1 | 2 =
    sp.h === "1" || sp.h === "2"
      ? (Number(sp.h) as 1 | 2)
      : isThisMonth && Number(today.slice(8, 10)) > 15
        ? 2
        : 1;
  const dates = half === 1 ? data.dates.slice(0, 15) : data.dates.slice(15);

  const navBtn =
    "rounded-md border border-slate-300 px-2 py-1 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800";

  const offCount = data.rows.reduce(
    (n, r) => n + Object.values(r.byDate).reduce((m, list) => m + list.length, 0),
    0,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b-2 border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex shrink-0 items-center gap-1">
          <Link href={`/offs?m=${shiftMonth(month, -1)}`} className={navBtn} aria-label="前の月">
            ◀
          </Link>
          <span className="px-1 text-[18px] font-bold tracking-tight whitespace-nowrap text-slate-900 tabular-nums">
            {month.replace("-", "/")}
          </span>
          <Link href={`/offs?m=${shiftMonth(month, 1)}`} className={navBtn} aria-label="次の月">
            ▶
          </Link>
          {!isThisMonth && (
            <Link
              href="/offs"
              className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
            >
              今月
            </Link>
          )}
        </div>

        <div className="ml-1 flex shrink-0 overflow-hidden rounded-md border border-slate-300">
          {([1, 2] as const).map((h) => (
            <Link
              key={h}
              href={`/offs?m=${month}&h=${h}`}
              aria-current={half === h ? "true" : undefined}
              className={[
                "px-2.5 py-1 text-[13px] font-semibold whitespace-nowrap transition-all duration-150 ease-in-out",
                half === h ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              {h === 1 ? "1〜15日" : `16〜${data.dates.length}日`}
            </Link>
          ))}
        </div>

        <div className="ml-1 flex shrink-0 items-baseline gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 whitespace-nowrap text-slate-700">
          <span className="t-meta">{Number(month.slice(5, 7))}月の休み</span>
          <span className="text-[16px] font-bold tabular-nums">{offCount}</span>
          <span className="t-meta text-slate-500">件</span>
        </div>

        {!editable && (
          <span className="t-meta shrink-0 text-slate-500">閲覧のみのため、休みは入れられません</span>
        )}
      </header>

      <OffGrid month={month} dates={dates} rows={data.rows} editable={editable} />
    </div>
  );
}

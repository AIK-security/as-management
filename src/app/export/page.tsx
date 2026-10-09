// S-20 出力 ① 配置明細（2026-10-09）。
//
// 設計は docs/s20-output-design.md §5。期間を選び、中身を確かめてから CSV を落とす。
// CSV 本体は /export/csv が返す（ここには埋め込まない ─ route.ts の冒頭）。
//
// 🔴 仮設計の範囲で作った。残業・諸経費・中止区分は**まだ出ない**と画面にも書いておく。
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { addDays, todayInJst } from "@/lib/board-format";
import { EXPORT_HEADER, MAX_DAYS, daysBetween, getAssignmentDetail } from "@/lib/export";
import { HEADER_BTN } from "@/components/board/header-ui";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 画面に並べる行数。全部は CSV で見る */
const PREVIEW = 100;

function monthRange(iso: string, offset: number): { from: string; to: string } {
  const [y, m] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const from = first.toISOString().slice(0, 10);
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
}

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  // 🔴 ここが実際の関門。proxy.ts は導線であって認可ではない。
  await requireStaff();
  const sp = await searchParams;

  const today = todayInJst();
  const lastMonth = monthRange(today, -1);
  const thisMonth = monthRange(today, 0);
  // 既定は前月（締めたあとに出すことが多いため）
  const from = sp.from && DATE.test(sp.from) ? sp.from : lastMonth.from;
  const to = sp.to && DATE.test(sp.to) ? sp.to : lastMonth.to;

  const days = daysBetween(from, to);
  const rangeError =
    days === 0 ? "終了日が開始日より前になっています。" : days > MAX_DAYS ? `期間は ${MAX_DAYS} 日以内で指定してください。` : null;
  const data = rangeError ? null : await getAssignmentDetail(from, to);

  const href = (r: { from: string; to: string }) => `/export?${new URLSearchParams(r).toString()}`;
  const presetBtn =
    "rounded-md border border-slate-300 px-2 py-1 text-[13px] text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100";
  const inputCls =
    "h-8 rounded-md border border-slate-300 px-1.5 font-mono text-[13px] tabular-nums text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b-2 border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        <h1 className="mr-2 text-[18px] font-bold tracking-tight text-slate-900">配置明細</h1>

        {/* 🔴 form の GET（DateJump と同じ形）。JS が動かなくても効く */}
        <form method="get" action="/export" className="flex shrink-0 items-center gap-1">
          <input type="date" name="from" defaultValue={from} key={`f${from}`} aria-label="開始日" className={inputCls} />
          <span className="text-slate-500">〜</span>
          <input type="date" name="to" defaultValue={to} key={`t${to}`} aria-label="終了日" className={inputCls} />
          <button type="submit" className={presetBtn}>
            表示
          </button>
        </form>
        <Link href={href(lastMonth)} className={presetBtn}>
          前月
        </Link>
        <Link href={href(thisMonth)} className={presetBtn}>
          今月
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {data && data.rows.length > 0 ? (
            // 🔴 a の download で落とす。中身は /export/csv がサーバで作る
            <a
              href={`/export/csv?${new URLSearchParams({ from, to }).toString()}`}
              className={`${HEADER_BTN} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`}
            >
              CSV をダウンロード
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={`${HEADER_BTN} cursor-not-allowed border-dashed border-slate-300 bg-slate-50 text-slate-400`}
            >
              CSV をダウンロード
            </button>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <p className="t-meta text-slate-500">
          期間内の配置を、1行＝隊員1人で出します。中止した枠も「枠の状態」を付けて出します。
          残業・諸経費・中止の区分は、まだ入れる場所が無いため出ません。
        </p>

        {rangeError && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{rangeError}</p>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] text-slate-700">
              <span>
                <span className="text-[16px] font-bold tabular-nums">{data.rows.length}</span> 行
              </span>
              <span>
                確定 <span className="font-semibold tabular-nums">{data.confirmed}</span>
              </span>
              <span>
                中止 <span className="font-semibold tabular-nums">{data.cancelled}</span>
              </span>
              {data.onsiteCancelled > 0 && (
                <span>
                  現着中止 <span className="font-semibold tabular-nums">{data.onsiteCancelled}</span> 名
                </span>
              )}
            </div>

            {data.draft > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] leading-snug text-amber-900">
                仮組みのままの配置が {data.draft} 行あります。CSV には「仮組み」として入ります。
              </p>
            )}

            <div className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-[13px] leading-snug">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    {EXPORT_HEADER.map((h) => (
                      <th
                        key={h}
                        className="border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-semibold whitespace-nowrap text-slate-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, PREVIEW).map((cells, i) => (
                    <tr
                      key={i}
                      className={[
                        "border-b border-slate-100 transition-all duration-150 ease-in-out hover:bg-slate-50",
                        cells[10] === "中止" ? "text-slate-400" : "text-slate-900",
                      ].join(" ")}
                    >
                      {cells.map((c, j) => (
                        <td key={j} className="px-2 py-1 whitespace-nowrap">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={EXPORT_HEADER.length} className="px-3 py-6 text-center text-slate-500">
                        この期間に配置はありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {data.rows.length > PREVIEW && (
              <p className="t-meta text-slate-500">
                画面には先頭の {PREVIEW} 行だけを出しています。全部は CSV で確かめてください。
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

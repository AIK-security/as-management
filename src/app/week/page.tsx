// S-07 A表（週表）。設計は docs/screen-design.md §7-2。
//
// 🔴 なぜ `S-01` とは別にこの画面が要るのか
//   配置ボードは1日しか映さないため、「この隊員は明後日どこか」が画面から分からない。
//   現行が週表（A表）で組んでいるのは紙の都合ではなく、
//   **先の予定を見ながら今日を決めている**ため（2026-09-15 決定）。
//
// 🔴 `S-01` を置き換えるものではない。当日変更は1日の密度が要るので `S-01`、
//   先を見ながら組むのは `S-07`。**同じデータの2つの見方**として両方を持つ。
//
// 🔴 ここに残すのは**サーバでしかできないこと**だけ ─ 認可・取得・ヘッダ。
//   表とプールと D&D は WeekDnd（クライアント）が持つ。
//   表とプールを**同じ DndContext** に入れないと、プールからセルへ落とせない。
//
// 🔴 認可はここが関門。proxy.ts は導線であって認可ではない。最後の砦は DB の RLS。
import Link from "next/link";
import { requireStaff, canEdit } from "@/lib/auth";
import { WeekDnd } from "@/components/board/WeekDnd";
import { addDays, formatWeekDay, startOfWeek, todayInJst, type BoardShiftGroup } from "@/lib/board";
import { getWeekBoardData } from "@/lib/week-board";

function CountChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "draft" | "plain" | "shortage" | "overlap";
}) {
  const toneClass = {
    draft: "border-amber-400 bg-amber-50 text-amber-800",
    plain: "border-slate-300 bg-white text-slate-700",
    shortage:
      value > 0 ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-300 bg-white text-slate-500",
    // 🔴 重なりだけは確定を丸ごと止める。0 のときも薄く出し続ける
    //   （出たり消えたりすると、見る場所を覚えられない）
    overlap:
      value > 0 ? "border-rose-500 bg-rose-100 text-rose-800" : "border-slate-300 bg-white text-slate-500",
  }[tone];

  return (
    <div className={`flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 ${toneClass}`}>
      <span className="t-meta">{label}</span>
      <span className="text-[18px] font-bold tabular-nums">{value}</span>
    </div>
  );
}

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; start?: string; base?: string; j?: string }>;
}) {
  // 🔴 事務ロールは閲覧のみ（requirements.md §3 決定 #2）。つかめないようにする
  const { profile } = await requireStaff();
  const editable = canEdit(profile);

  const sp = await searchParams;
  const group: BoardShiftGroup = sp.group === "night" ? "night" : "day";
  // 🔴 日付は JST で決める。Vercel は UTC で動くため、素の Date に任せると
  //    ローカルでは合うのに本番で1日ずれる。
  const isIso = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");
  const startDate = isIso(sp.start) ? startOfWeek(sp.start!) : startOfWeek(todayInJst());

  const week = await getWeekBoardData({
    startDate,
    baseDate: isIso(sp.base) ? sp.base : undefined,
    jurisdictionCode: sp.j,
    group,
  });

  /** 現在の絞り込みを保ったまま、一部だけ差し替えた URL を作る */
  const hrefWith = (patch: { start?: string; base?: string; group?: string; j?: string }) => {
    const q = new URLSearchParams();
    q.set("start", patch.start ?? week.startDate);
    q.set("group", patch.group ?? group);
    // 週を動かすときは基準日を引きずらない（別の週の日付になってしまう）
    if (patch.base) q.set("base", patch.base);
    else if (!patch.start) q.set("base", week.baseDate);
    const j = patch.j ?? week.jurisdiction.code;
    if (j) q.set("j", j);
    return `/week?${q.toString()}`;
  };

  /** 日別（S-01）へ降りる。確定はあちらで行う（§7-2-6） */
  const boardHref = (date: string) => {
    const q = new URLSearchParams();
    q.set("date", date);
    q.set("group", group);
    if (week.jurisdiction.code) q.set("j", week.jurisdiction.code);
    return `/board?${q.toString()}`;
  };

  const thisWeek = startOfWeek(todayInJst());
  const navBtn =
    "rounded-md border border-slate-300 px-2 py-1 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ══ ヘッダ ═══════════════════════════════════════════ */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b-2 border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-1">
          <Link href={hrefWith({ start: addDays(week.startDate, -7) })} className={navBtn} aria-label="前の週">
            ◀
          </Link>
          <span className="px-1 text-[18px] font-bold tracking-tight text-slate-900 tabular-nums">
            {formatWeekDay(week.startDate)} 〜 {formatWeekDay(week.dates[6])}
          </span>
          <Link href={hrefWith({ start: addDays(week.startDate, 7) })} className={navBtn} aria-label="次の週">
            ▶
          </Link>
          {week.startDate !== thisWeek && (
            <Link
              href={hrefWith({ start: thisWeek })}
              className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
            >
              今週
            </Link>
          )}
        </div>

        {week.jurisdictions.length > 1 && (
          <div className="flex overflow-hidden rounded-md border-2 border-slate-300">
            {week.jurisdictions.map((j) => (
              <Link
                key={j.id}
                href={hrefWith({ j: j.code })}
                className={[
                  "px-3 py-1 text-[15px] font-semibold transition-all duration-150 ease-in-out",
                  j.id === week.jurisdiction.id
                    ? "bg-slate-700 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                {j.name}
              </Link>
            ))}
          </div>
        )}

        <div className="flex overflow-hidden rounded-md border-2 border-slate-300">
          {(["day", "night"] as const).map((g) => (
            <Link
              key={g}
              href={hrefWith({ group: g })}
              className={[
                "px-3 py-1 text-[15px] font-semibold transition-all duration-150 ease-in-out",
                g === week.group ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              {g === "day" ? "日勤" : "夜勤"}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <CountChip label="仮組み" value={week.counts.draft} tone="draft" />
          <CountChip label="確定" value={week.counts.confirmed} tone="plain" />
          <CountChip label="未充足" value={week.counts.shortage} tone="shortage" />
          {/* 🔴 仮組みのうちは DB が重なりを止めない。止めない代わりに必ず見せる */}
          <CountChip label="重複" value={week.counts.overlap} tone="overlap" />
        </div>

        {/* 🔴 確定は週表では行わない（§7-2-6）。日別へ降りる導線だけ置く */}
        <Link
          href={boardHref(week.baseDate)}
          className="ml-auto rounded-md border-2 border-slate-300 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          {formatWeekDay(week.baseDate)} の配置ボードへ
        </Link>
      </header>

      {/* ══ 本体 ═══════════════════════════════════════════ */}
      <WeekDnd
        data={week}
        baseHrefs={week.dates.map((d) => hrefWith({ base: d }))}
        dayHrefs={week.dates.map((d) => boardHref(d))}
        editable={editable}
      />
    </div>
  );
}

// S-01 配置ボード（段2：Supabase から読む）
//
// 設計は docs/screen-design.md §2。
// **1画面 = 1日 × 1管轄 × 日勤/夜勤。** ShiftMax（べんり君）の入力単位と揃えてある。
//
// 🔴 段1（表示のみ・ダミー定数）から、データ元を Supabase に移した（2026-09-02）。
//    段1 で「getBoardData の戻り値の形は載せ替えても変えない」と決めておいたため、
//    画面の構造は変わっていない。
//
// 🔴 日付・管轄の切り替えをここで生かした。段1 では飾りのボタンだった。
//    1画面が1日×1管轄である以上、切り替えが無いと他の日のデータに到達できない。
//
// 🔴 認可は3枚重ね。requireStaff() は関門で、最後の砦は DB の RLS。
//    事務ロールは**閲覧のみ**なので編集系のボタンを出さない（requirements.md §3 決定 #2）。
//
// 🔴 段2-③（2026-09-03）で本体を BoardDnd（クライアント）へ移した。
//    ここに残るのは**サーバでしかできないこと**だけ ─ 認可・取得・ヘッダ。
//    得意先タブと空表示は Link を含むのでサーバで描き、
//    ReactNode として BoardDnd に差し込む（クライアントに Link の生成を持ち込まない）。

import Link from "next/link";
import { requireStaff, canEdit, roleLabel } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { PaneHeading } from "@/components/board/PaneHeading";
import { WarningsPane } from "@/components/board/BoardPanes";
import { BoardDnd } from "@/components/board/BoardDnd";
import { ConfirmAllButton } from "@/components/board/ConfirmAllButton";
import {
  addDays,
  formatBoardDate,
  getBoardData,
  todayInJst,
  type BoardShiftGroup,
} from "@/lib/board";

/** ヘッダの件数表示。数字を大きく、ラベルを小さくして役割の差をつける */
function CountChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "draft" | "confirmed" | "shortage";
}) {
  // 🔴 確定は色を持たせない（1色1意味・2026-09-02）。
  //   amber＝まだ終わっていない ／ rose＝足りない ／ slate＝それ以外。
  const toneClass = {
    draft: "border-amber-400 bg-amber-50 text-amber-800",
    confirmed: "border-slate-300 bg-white text-slate-700",
    shortage:
      value > 0
        ? "border-rose-400 bg-rose-50 text-rose-700"
        : "border-slate-300 bg-white text-slate-500",
  }[tone];

  return (
    <div className={`flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 ${toneClass}`}>
      <span className="t-meta">{label}</span>
      <span className="text-[18px] font-bold tabular-nums">{value}</span>
    </div>
  );
}

/** 得意先タブ。件数と不足を持たせ、開かなくても状況が分かるようにする */
function CustomerTab({
  href,
  label,
  count,
  shortage,
  active,
}: {
  href: string;
  label: string;
  count: number;
  shortage: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 text-[13px] font-semibold",
        "transition-all duration-150 ease-in-out",
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
      ].join(" ")}
    >
      <span className="max-w-[16ch] truncate">{label}</span>
      <span className={active ? "tabular-nums text-indigo-100" : "tabular-nums text-slate-500"}>
        {count}
      </span>
      {/* 🔴 不足はタブに出す。開かないと分からないと、絞り込みが見落としを生む */}
      {shortage > 0 && (
        <span
          className={[
            "rounded px-1 text-[11px] leading-4",
            active ? "bg-white/25 text-white" : "bg-rose-100 text-rose-700",
          ].join(" ")}
          title={`${shortage}名 不足`}
        >
          不足{shortage}
        </span>
      )}
    </Link>
  );
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; date?: string; j?: string; c?: string }>;
}) {
  // 🔴 ここが実際の関門。proxy.ts は導線であって認可ではない。
  const { profile } = await requireStaff();
  const editable = canEdit(profile);

  const sp = await searchParams;
  const group: BoardShiftGroup = sp.group === "night" ? "night" : "day";
  // 🔴 日付は JST で決める。Vercel は UTC で動くため、ここを素の Date に任せると
  //    ローカルでは合うのに本番で1日ずれる。
  const workDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayInJst();

  const board = await getBoardData({
    workDate,
    jurisdictionCode: sp.j,
    group,
  });

  const offTotal = board.offGroups.reduce((n, g) => n + g.guards.length, 0);
  const lentTotal = board.lentGroups.reduce((n, g) => n + g.guards.length, 0);
  const placed = board.rows.reduce((n, r) => n + r.plates.length, 0);

  // ── 得意先タブ ──────────────────────────────────────
  // 🔴 実態は「毎日たくさん現場をくれる会社が1社、残りは数社」（管制の実感）。
  //   1社で20件超になるため、全件を1画面に積むと他社が下へ流れて見えなくなる。
  //   → 得意先で切り替えられるようにし、**カードからは得意先名を外す**。
  //
  // 🔴 タブの並びはグループと同じ「得意先名順で固定」。件数順にすると
  //   日によって位置が変わり、探す場所を覚えられなくなる。
  const selectedCustomer = sp.c ?? "";
  const visibleGroups = selectedCustomer
    ? board.groups.filter((g) => g.customer?.staff_code === selectedCustomer)
    : board.groups;

  // 🔴 グループごとにグリッドを分けない（2026-09-02 変更）。
  //   分けると1件しかない会社でも1行を占有し、右側が丸ごと空く。
  //   得意先の順（groups の並び）を保ったまま**1本のグリッドに流し込んで上から詰める**。
  //   まとまりは「カード内の得意先名」と「並び順」で示す。
  const visibleRows = visibleGroups.flatMap((g) => g.rows);
  // 1社に絞っているときは全カードに同じ会社名が並ぶだけなので出さない
  const showCustomerOnCard = !selectedCustomer;

  // 🔴 一括確定の対象は**いま表示している**仮組みの枠だけ。
  //   得意先タブで絞っているときに画面外の枠まで確定すると、
  //   「押した範囲」と「変わった範囲」が食い違う。
  const draftShiftIdsOnScreen = visibleRows
    .filter((r) => r.shift.status === "draft")
    .map((r) => r.shift.id);

  /** 現在の絞り込みを保ったまま、一部だけ差し替えた URL を作る */
  const hrefWith = (patch: { date?: string; group?: string; j?: string; c?: string }) => {
    const q = new URLSearchParams();
    q.set("date", patch.date ?? workDate);
    q.set("group", patch.group ?? group);
    const j = patch.j ?? board.jurisdiction.code;
    if (j) q.set("j", j);
    // 空文字は「すべて」＝パラメータを付けない
    const c = patch.c ?? selectedCustomer;
    if (c) q.set("c", c);
    return `/board?${q.toString()}`;
  };

  const navBtn =
    "rounded-md border border-slate-300 px-2 py-1 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800";

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* ══ ヘッダ ═══════════════════════════════════════════ */}
      <header className="flex shrink-0 items-center gap-3 border-b-2 border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-1">
          <Link href={hrefWith({ date: addDays(workDate, -1) })} className={navBtn} aria-label="前日">
            ◀
          </Link>
          <span className="px-1 text-[20px] font-bold tracking-tight text-slate-900 tabular-nums">
            {formatBoardDate(board.date)}
          </span>
          <Link href={hrefWith({ date: addDays(workDate, 1) })} className={navBtn} aria-label="翌日">
            ▶
          </Link>
          {workDate !== todayInJst() && (
            <Link
              href={hrefWith({ date: todayInJst() })}
              className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
            >
              今日
            </Link>
          )}
        </div>

        {/* 管轄。1画面 = 1管轄 なので切り替えが要る */}
        {board.jurisdictions.length > 1 ? (
          <div className="flex overflow-hidden rounded-md border-2 border-slate-300">
            {board.jurisdictions.map((j) => (
              <Link
                key={j.id}
                href={hrefWith({ j: j.code })}
                className={[
                  "px-3 py-1 text-[15px] font-semibold transition-all duration-150 ease-in-out",
                  j.id === board.jurisdiction.id
                    ? "bg-slate-700 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                {j.name}
              </Link>
            ))}
          </div>
        ) : (
          <span className="rounded-md border-2 border-slate-300 bg-slate-50 px-2.5 py-1 text-[15px] font-semibold text-slate-800">
            {board.jurisdiction.name}
          </span>
        )}

        {/* 日勤 / 夜勤 */}
        <div className="flex overflow-hidden rounded-md border-2 border-slate-300">
          {(["day", "night"] as const).map((g) => (
            <Link
              key={g}
              href={hrefWith({ group: g })}
              className={[
                "px-4 py-1 text-[15px] font-semibold transition-all duration-150 ease-in-out",
                group === g
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              {g === "day" ? "日勤" : "夜勤"}
            </Link>
          ))}
        </div>

        <div className="ml-3 flex items-center gap-2">
          <CountChip label="仮組み" value={board.counts.draft} tone="draft" />
          <CountChip label="確定" value={board.counts.confirmed} tone="confirmed" />
          <CountChip label="未充足" value={board.counts.shortage} tone="shortage" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* 編集系は管制・管理者のみ。事務には出さない（requirements.md §3 決定 #2）。
              ⚠️ 出し分けは見た目の話。実際の防御は RLS と Server Action 側で行う。 */}
          {editable && (
            <>
              {/* 🔴 対象は**いま表示している**仮組みの枠。得意先タブで絞っていればその範囲 */}
              <ConfirmAllButton shiftIds={draftShiftIdsOnScreen} />
              <button
                type="button"
                className="rounded-md border-2 border-slate-300 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
              >
                連絡作成
              </button>
              <button
                type="button"
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700"
              >
                べんり君へ引き渡し
              </button>
            </>
          )}

          <div className="ml-1 flex items-center gap-2 border-l-2 border-slate-200 pl-3">
            <div className="flex flex-col items-end leading-tight">
              <span className="text-[14px] font-semibold text-slate-800">
                {profile.display_name ?? "（氏名未設定）"}
              </span>
              <span className="t-meta text-slate-500">{roleLabel[profile.role]}</span>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-md border-2 border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
              >
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* ══ 本体（D&D はクライアント側） ═══════════════════ */}
      <BoardDnd
        rows={visibleRows}
        pool={board.pool}
        editable={editable}
        showCustomerOnCard={showCustomerOnCard}
        jurisdictionId={board.jurisdiction.id}
        totalSiteCount={board.rows.length}
        totalPlaced={placed}
        filtered={Boolean(selectedCustomer)}
        /* ── 得意先タブ ──
           🔴 絞り込むのは**カードだけ**。ヘッダの件数と下の「要確認」は
              その日の全体を出し続ける。絞り込みで警告が隠れると、
              見えていない現場の不足に気づけないまま当日を迎える */
        customerTabs={
          board.groups.length > 1 ? (
            <div className="mb-3.5 flex flex-wrap items-center gap-2">
              <CustomerTab
                href={hrefWith({ c: "" })}
                label="すべて"
                count={board.rows.length}
                shortage={0}
                active={!selectedCustomer}
              />
              {board.groups.map((g) => (
                <CustomerTab
                  key={g.customer?.id ?? "__none__"}
                  href={hrefWith({ c: g.customer?.staff_code ?? "" })}
                  label={g.customer?.name ?? "（得意先が未設定）"}
                  count={g.siteCount}
                  shortage={Math.max(0, g.headcount - g.placed)}
                  active={selectedCustomer === g.customer?.staff_code}
                />
              ))}
            </div>
          ) : null
        }
        /* 🔴 空のときに何も出さない画面にしない。
           「壊れているのか、その日が本当に空なのか」が利用者に区別できない。 */
        emptyState={
          <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center">
            <p className="text-[15px] font-semibold text-slate-700">
              この日の{group === "day" ? "日勤" : "夜勤"}の枠はありません
            </p>
            <p className="t-meta mt-1 text-slate-500">
              {formatBoardDate(board.date)} ／ {board.jurisdiction.name}
            </p>
            {board.nearestDateWithShifts && (
              <Link
                href={hrefWith({ date: board.nearestDateWithShifts })}
                className="mt-3 inline-block rounded-md bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-indigo-700"
              >
                枠がある直近の日（{formatBoardDate(board.nearestDateWithShifts)}）へ
              </Link>
            )}
          </div>
        }
        poolFooter={
          <>
            {/* 非現場ステータス */}
            <PaneHeading title="非現場" sub={`${offTotal} 名`} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2">
              {board.offGroups.map((g) => (
                <div
                  key={g.label}
                  className="flex items-baseline justify-between border-b border-slate-200 pb-1"
                >
                  <span className="text-[14px] text-slate-700">{g.label}</span>
                  <span className="text-[15px] font-bold tabular-nums text-slate-800">
                    {g.guards.length}
                  </span>
                </div>
              ))}
            </div>

            {/* 協力会社への貸出。🔴 請求に効くため第1弾から持つ（data-model.md §4-2） */}
            <PaneHeading title="貸出中（協力会社へ）" sub={`${lentTotal} 名`} />
            <div className="px-3 py-2">
              {board.lentGroups.map((g) => (
                <div
                  key={`${g.companyName}:${g.siteName}`}
                  className="flex items-baseline gap-2 border-b border-slate-200 py-1"
                >
                  <span className="text-[14px] font-semibold text-slate-800">{g.companyName}</span>
                  <span className="t-meta truncate text-slate-500">{g.siteName}</span>
                  <span className="ml-auto text-[15px] font-bold tabular-nums text-slate-800">
                    {g.guards.length}
                  </span>
                </div>
              ))}
            </div>
          </>
        }
      />

      {/* ══ 要確認（閉じられる） ══════════════════════════════ */}
      <WarningsPane count={board.warnings.length}>
        <ul className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-0.5">
          {board.warnings.map((w, i) => (
            <li key={i} className="flex items-baseline gap-1.5 text-[13px]">
              <span
                className={[
                  "t-badge shrink-0 rounded px-1.5 leading-5",
                  w.kind === "ng"
                    ? "bg-rose-100 text-rose-700"
                    : w.kind === "shortage"
                      ? "bg-slate-200 text-slate-700"
                      : "bg-amber-100 text-amber-800",
                ].join(" ")}
              >
                {w.kind === "ng" ? "NG" : w.kind === "shortage" ? "不足" : "資格"}
              </span>
              <span className="truncate text-slate-700">{w.message}</span>
            </li>
          ))}
        </ul>
      </WarningsPane>
    </div>
  );
}

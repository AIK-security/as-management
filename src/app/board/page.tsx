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

import Link from "next/link";
import { requireStaff, canEdit, roleLabel } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { ShiftRowCard } from "@/components/board/ShiftRowCard";
import { PoolPlate } from "@/components/board/Plate";
import { PaneHeading } from "@/components/board/PaneHeading";
import { PoolPane, WarningsPane } from "@/components/board/BoardPanes";
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
  const visibleSiteCount = visibleRows.length;
  const visiblePlaced = visibleRows.reduce((n, r) => n + r.plates.length, 0);

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
              <button
                type="button"
                className="rounded-md border-2 border-slate-300 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
              >
                一括確定
              </button>
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

      {/* ══ 本体 ═════════════════════════════════════════════ */}
      <div className="flex min-h-0 flex-1">
        {/* ── 左：配置（現場 × 枠） ── */}
        <main className="thin-scroll min-w-0 flex-1 overflow-y-auto p-4">
          <div className="mb-2.5 flex items-baseline gap-2 px-0.5">
            <h1 className="text-[15px] font-semibold tracking-tight text-slate-700">配置</h1>
            <span className="t-meta text-slate-500">
              現場 {visibleSiteCount} 件 ／ 配置 {visiblePlaced} 名
              {selectedCustomer && (
                <span className="ml-1 text-slate-400">
                  （この日の全体は {board.rows.length} 件 / {placed} 名）
                </span>
              )}
            </span>
          </div>

          {/* ── 得意先タブ ──
              🔴 絞り込むのは**カードだけ**。ヘッダの件数と下の「要確認」は
                 その日の全体を出し続ける。絞り込みで警告が隠れると、
                 見えていない現場の不足に気づけないまま当日を迎える */}
          {board.groups.length > 1 && (
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
          )}

          {/* 🔴 空のときに何も出さない画面にしない。
              「壊れているのか、その日が本当に空なのか」が利用者に区別できない。 */}
          {board.rows.length === 0 ? (
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
          ) : (
            /* 🔴 箱組み（2026-09-02）。横幅いっぱいの帯から変更した。
               日勤は平均 1.7名/現場で1名の枠が多く、帯だと右側がほぼ空白だった。

               ・🔴 **箱の大きさは統一する。** 人数で幅を変える案は大小が混ざって
                 読みにくく、一覧として成立しなかった
               ・列幅は最低 296px。プレート（112px）が2枚入り、
                 内側の余白（左右12px）を取っても窮屈にならない幅
               ・高さは同じ行の中で揃う（グリッドの既定）。
                 プレート置き場を下端に寄せてあるので、行内で高さの基準線が合う
               ・grid-auto-flow: dense は**使わない**。
                 隙間は埋まるが表示順が入れ替わる。順番が変わると
                 A表と突き合わせられなくなる

               🔴 並び順（2026-09-02 決定）
               ・**得意先名順で固定**。毎日同じ場所に出るので探す位置を覚えられ、
                 当日変更で枠が増減しても他社のカード位置がずれない
               ・**同じ得意先の中は開始時刻順**（board.ts のクエリ側で付けている）
               ・🔴 見出しで区切らず**1本のグリッドに詰める**。
                 会社ごとに区切ると1件の会社でも1行を占有して右が空く。
                 まとまりはカード内の得意先名と並び順で示す */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] items-stretch gap-3">
              {visibleRows.map((row) => (
                <ShiftRowCard
                  key={row.shift.id}
                  row={row}
                  showCustomer={showCustomerOnCard}
                />
              ))}
            </div>
          )}

          {editable && board.rows.length > 0 && (
            <button
              type="button"
              className="mt-2.5 w-full rounded-lg border-2 border-dashed border-slate-300 py-3 text-[14px] font-semibold text-slate-400 transition-all duration-150 ease-in-out hover:border-slate-400 hover:bg-white hover:text-slate-600"
            >
              ＋ 現場を追加
            </button>
          )}
        </main>

        {/* ── 右：隊員プール（閉じられる） ── */}
        <PoolPane poolCount={board.pool.length}>
          <div className="px-3 py-2">
            <input
              type="search"
              placeholder="氏名で検索"
              className="h-10 w-full rounded-md border-2 border-slate-300 px-2.5 text-[14px] transition-all duration-150 ease-in-out outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["自社", "協力会社", "他管轄", "資格あり"].map((f) => (
                <button
                  key={f}
                  type="button"
                  className="t-meta rounded-md border-2 border-slate-300 bg-white px-2 py-1 text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 px-3 pb-3">
            {board.pool.map((view) => (
              <PoolPlate key={view.guard.id} view={view} />
            ))}
          </div>

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
        </PoolPane>
      </div>

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

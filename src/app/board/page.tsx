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
import { requireStaff, canEdit } from "@/lib/auth";
import { WarningsPane } from "@/components/board/BoardPanes";
import { BoardDnd } from "@/components/board/BoardDnd";
import { ConfirmAllButton } from "@/components/board/ConfirmAllButton";
import { AddShiftDialog } from "@/components/board/AddShiftDialog";
import { CopyDayDialog } from "@/components/board/CopyDayDialog";
import { DateJump } from "@/components/DateJump";
import { HEADER_BTN } from "@/components/board/header-ui";
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
    <div
      className={`flex shrink-0 items-baseline gap-1.5 rounded-md border px-2 py-1 whitespace-nowrap ${toneClass}`}
    >
      <span className="t-meta">{label}</span>
      <span className="text-[16px] font-bold tabular-nums">{value}</span>
    </div>
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

  const placed = board.rows.reduce((n, r) => n + r.plates.length, 0);

  // ── 得意先タブ ──────────────────────────────────────
  // 🔴 実態は「毎日たくさん現場をくれる会社が1社、残りは数社」（管制の実感）。
  //   1社で20件超になるため、全件を1画面に積むと他社が下へ流れて見えなくなる。
  //   → 得意先で切り替えられるようにし、**カードからは得意先名を外す**。
  //
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
  //   🔴 中止の枠は対象外（2026-09-07）。誰も行かない枠を確定しても意味がなく、
  //      「一括確定を押したのに件数が合わない」という不信のもとになる。
  const draftShiftIdsOnScreen = visibleRows
    .filter((r) => r.shift.status === "draft" && r.shift.cancelled_at === null)
    .map((r) => r.shift.id);

  // 🔴 タブの並びはグループと同じ「得意先名順で固定」。件数順にすると
  //   日によって位置が変わり、探す場所を覚えられなくなる。
  //   1社しか無い日はタブ自体を出さない（切り替える先が無い）。
  const customerTabs =
    board.groups.length > 1
      ? [
          {
            id: "__all__",
            href: hrefWith({ c: "" }),
            label: "すべて",
            count: board.rows.length,
            shortage: 0,
            active: !selectedCustomer,
          },
          ...board.groups.map((g) => ({
            id: g.customer?.id ?? "__none__",
            href: hrefWith({ c: g.customer?.staff_code ?? "" }),
            label: g.customer?.name ?? "（得意先が未設定）",
            count: g.siteCount,
            shortage: Math.max(0, g.headcount - g.placed),
            active: selectedCustomer === g.customer?.staff_code,
          })),
        ]
      : [];

  // 🔴 まだ中身が無い操作。押せないことと理由が見た目で分かるようにする
  const PENDING_BTN = `${HEADER_BTN} cursor-not-allowed border-dashed border-slate-300 bg-slate-50 text-slate-400`;

  const navBtn =
    "rounded-md border border-slate-300 px-2 py-1 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ══ ヘッダ ═══════════════════════════════════════════ */}
      {/* 🔴 flex-wrap にした（2026-09-16）。110% 表示で幅が足りなくなると、
          これまでは**ボタンの中で文字が折り返して**ヘッダ全体が崩れていた。
          各要素に whitespace-nowrap / shrink-0 を付けたうえで折り返しを許すと、
          溢れたぶんは**要素まるごと次の行へ**落ちる。
          50インチのモニタを離れて見る以上、拡大表示は例外ではなく通常の使い方 */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b-2 border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex shrink-0 items-center gap-1">
          <Link href={hrefWith({ date: addDays(workDate, -1) })} className={navBtn} aria-label="前日">
            ◀
          </Link>
          <span className="px-1 text-[18px] font-bold tracking-tight whitespace-nowrap text-slate-900 tabular-nums">
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
          {/* 🔴 管轄と日勤夜勤は引き継ぐ。得意先の絞り込みは外す（別の日には無い得意先がある） */}
          <span className="ml-1">
            <DateJump
              action="/board"
              name="date"
              type="date"
              value={workDate}
              keep={{ group, ...(board.jurisdiction.code ? { j: board.jurisdiction.code } : {}) }}
            />
          </span>
        </div>

        {/* 🔴 管轄（東京／千葉）の切り替えは**画面から外した**（2026-09-16・管制の要望）。
            「東京だけでよい」。タブが常に出ていたぶんヘッダの幅を約120px 使っていた。

            🔴 外したのは**表示だけ**。`jurisdiction` は DB にも URL（?j=）にも残してある：
              ・`shifts.jurisdiction_id` は NOT NULL で、べんり君へ渡す18列CSVにも管轄が要る
              ・取得は今も管轄で絞っている（board.ts の `.eq("jurisdiction_id", …)`）
            消すと ShiftMax へ渡すデータが壊れる。**戻すのはこの塊を書き戻すだけ**にしてある。 */}

        {/* 日勤 / 夜勤 */}
        <div className="flex shrink-0 overflow-hidden rounded-md border-2 border-slate-300">
          {(["day", "night"] as const).map((g) => (
            <Link
              key={g}
              href={hrefWith({ group: g })}
              className={[
                "px-3 py-1 text-[14px] font-semibold whitespace-nowrap transition-all duration-150 ease-in-out",
                group === g
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              {g === "day" ? "日勤" : "夜勤"}
            </Link>
          ))}
        </div>

        <div className="ml-1 flex shrink-0 items-center gap-1.5">
          <CountChip label="仮組み" value={board.counts.draft} tone="draft" />
          <CountChip label="確定" value={board.counts.confirmed} tone="confirmed" />
          <CountChip label="未充足" value={board.counts.shortage} tone="shortage" />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* 編集系は管制・管理者のみ。事務には出さない（requirements.md §3 決定 #2）。
              ⚠️ 出し分けは見た目の話。実際の防御は RLS と Server Action 側で行う。 */}
          {editable && (
            <>
              {/* 🔴 対象は**いま表示している**仮組みの枠。得意先タブで絞っていればその範囲 */}
              {/* 🔴 「現場を追加」は一括確定の**左**に置く。
                  作る → 人を入れる → 確定する、の順に手が動く */}
              <AddShiftDialog
                workDate={board.date}
                jurisdictionId={board.jurisdiction.id}
                group={board.group}
                sitePicks={board.sitePicks}
                customerPicks={board.customerPicks}
              />
              {/* 🔴 似た日を丸ごと写す（2026-10-05）。空の盤面に1件ずつ作らせない */}
              <CopyDayDialog
                workDate={board.date}
                jurisdictionId={board.jurisdiction.id}
                jurisdictionName={board.jurisdiction.name}
              />
              <ConfirmAllButton shiftIds={draftShiftIdsOnScreen} />
              {/* 🔴 中身が無いボタンは「準備中」と分かる形にする（2026-09-09 決定）。
                  これまで onClick すら無い**押しても無反応のボタン**が2つ並んでいた。
                  デモで押されれば「壊れている」と読まれる。消す案もあったが、
                  **これから何ができるようになるかが見える**ほうがよいと判断し、
                  押せない状態＋説明（title）で残す。
                  🔴 実装したら disabled と「準備中」を外すこと。 */}
              {/* 🔴 いま見ている日・管轄・日勤夜勤をそのまま引き継ぐ。
                  連絡は「この盤面の人たちへ」出すものなので、条件を選び直させない */}
              <Link
                href={`/notices?date=${board.date}&j=${board.jurisdiction.code}&group=${board.group}`}
                className={`${HEADER_BTN} border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
              >
                連絡作成
              </Link>
              <button
                type="button"
                disabled
                title="確定した枠を18列CSVで出し、べんり君のコピーから ShiftMax へ送る工程。要否そのものが未判定で、事務側ヒアリングの結果しだいで不要になる"
                className={PENDING_BTN}
              >
                べんり君へ引き渡し
                <span className="t-badge ml-1.5 rounded bg-slate-200 px-1 py-0.5 text-slate-500">
                  未着手
                </span>
              </button>
            </>
          )}

          {/* 🔴 行き先（マスタ）・氏名・ログアウトは**左サイドバーへ移した**（2026-09-09）。
              ここに残すのは「この画面の操作」だけ。 */}
        </div>
      </header>

      {/* ══ 本体（D&D はクライアント側） ═══════════════════ */}
      {/* 🔴 渡すのはプレーンなデータだけ。JSX を境界越しに渡さない。
          Link はクライアント側でも動くので、markup は BoardDnd 側で組む
          （2026-09-03 修正。理由は BoardDnd.tsx の「得意先タブ・空表示」節） */}
      <BoardDnd
        rows={visibleRows}
        pool={board.pool}
        editable={editable}
        showCustomerOnCard={showCustomerOnCard}
        jurisdictionId={board.jurisdiction.id}
        totalSiteCount={board.rows.length}
        totalPlaced={placed}
        filtered={Boolean(selectedCustomer)}
        customerTabs={customerTabs}
        empty={{
          groupLabel: group === "day" ? "日勤" : "夜勤",
          dateLabel: formatBoardDate(board.date),
          jurisdictionName: board.jurisdiction.name,
          nearest: board.nearestDateWithShifts
            ? {
                href: hrefWith({ date: board.nearestDateWithShifts }),
                label: formatBoardDate(board.nearestDateWithShifts),
              }
            : null,
        }}
        offGroups={
          // 🔴 件数だけでなく**氏名**を渡す（2026-09-16・管制の要望）。
          //   休みの隊員はプールから消えるため、「居ない理由」を確かめる場所がここしかない。
          board.offGroups.map((g) => ({
            label: g.label,
            names: g.guards.map((x) => x.short_name),
          }))
        }
        lentGroups={board.lentGroups.map((g) => ({
          companyName: g.companyName,
          siteName: g.siteName,
          count: g.guards.length,
        }))}
      />

      {/* ══ 要確認（閉じられる） ══════════════════════════════ */}
      <WarningsPane count={board.warnings.length}>
        <ul className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-0.5">
          {board.warnings.map((w, i) => (
            // 🔴 重なりだけ2列ぶんを使い、省略もしない（2026-09-04）。
            //   ここだけが「直さないと確定できない」警告で、文面も長い
            //   （相手が別の管轄・別の勤務にいることが多いため、
            //   得意先・管轄・区分まで書かないと探せない）。
            //   truncate すると、いちばん要る後半が消える。
            <li
              key={i}
              className={[
                "flex items-baseline gap-1.5 text-[13px]",
                w.kind === "overlap" ? "col-span-2" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "t-badge shrink-0 rounded px-1.5 leading-5",
                  w.kind === "overlap"
                    ? "bg-rose-600 text-white"
                    : w.kind === "ng"
                      ? "bg-rose-100 text-rose-700"
                      : w.kind === "shortage"
                        ? "bg-slate-200 text-slate-700"
                        : "bg-amber-100 text-amber-800",
                ].join(" ")}
              >
                {w.kind === "overlap"
                  ? "重複"
                  : w.kind === "ng"
                    ? "NG"
                    : w.kind === "shortage"
                      ? "不足"
                      : "資格"}
              </span>
              <span
                className={w.kind === "overlap" ? "text-slate-800" : "truncate text-slate-700"}
                title={w.message}
              >
                {w.message}
              </span>
            </li>
          ))}
        </ul>
      </WarningsPane>
    </div>
  );
}

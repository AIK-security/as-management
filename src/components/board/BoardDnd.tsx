// 配置ボードの D&D（段2-③・2026-09-03）。
//
// 🔴 この画面がやることは1つ ──「誰をどの枠に置くか」を最小操作で変える。
//   現行のべんり君（Excel）は既に D&D で、管制は1日 約150枚のプレートを動かす
//   （screen-design.md §2-1）。**遅い・重い・戻るなら使われない。**
//
// 🔴 止めるのは重複だけ。あとは警告（screen-design.md §2-5）。
//   NG も資格不足も人数超過も**置ける**。保存を拒むのは DB の EXCLUDE 制約
//   （確定済みどうしの時間帯の重なり）に触れたときだけ。
//   「正しさを強制する画面」は現場に嫌われ、AIK assign の再現になる。
//
// 🔴 なぜ楽観更新（useOptimistic）なのか
//   置いた結果が出るまでサーバ往復を待つと、150回の操作すべてに待ちが挟まる。
//   先に画面を動かし、結果が返ったら**サーバの値で上書きする**。
//   失敗したら勝手に元へ戻る ─ これが「プレートが戻る」の実装（§2-5）。
//
// 🔴 楽観更新中の警告（NG・資格・経験）はサーバ再取得まで古いままになる。
//   これは承知のうえ。**判定をクライアントにも書くと、規則が二か所になる**。
//   ずれるのは1秒未満で、置けたか置けなかったかは色で分かる。
"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Plate, PoolPlate, DraggablePoolPlate } from "@/components/board/Plate";
import { ShiftRowCard } from "@/components/board/ShiftRowCard";
import { ShiftEditDialog } from "@/components/board/ShiftEditDialog";
import { PoolPane } from "@/components/board/BoardPanes";
import { PaneHeading } from "@/components/board/PaneHeading";
import { useBoardKeys } from "@/components/board/useBoardKeys";
import {
  moveAssignment,
  placeGuard,
  setAssignmentRole,
  setAssignmentJobType,
  deleteShift,
  setShiftCancelled,
  setShiftStatus,
  unplaceAssignment,
  type ActionResult,
} from "@/app/board/actions";
import type { AssignmentRole, GuardView, JobType, PlateView, ShiftRow } from "@/lib/types";
import { callAction } from "@/lib/action-call";

// ─────────────────────────────────────────────────────────
// 楽観更新
// ─────────────────────────────────────────────────────────

type BoardState = { rows: ShiftRow[]; pool: GuardView[] };

type Move =
  /** プール → 枠 */
  | { type: "place"; guardId: string; toShiftId: string }
  /** 枠 → 別の枠 */
  | { type: "move"; assignmentId: string; toShiftId: string }
  /** 枠 → プール */
  | { type: "unplace"; assignmentId: string }
  /** 隊長の付け外し */
  | { type: "role"; assignmentId: string; role: AssignmentRole }
  /** 職種（K・R・D）の付け外し（2026-10-08） */
  | { type: "job"; assignmentId: string; jobType: JobType | null }
  | { type: "status"; shiftId: string; status: "draft" | "confirmed" }
  /** 枠の中止／取り消し（2026-09-07） */
  | { type: "cancel"; shiftId: string; cancelled: boolean }
  /** 枠そのものを消す（2026-09-07） */
  | { type: "deleteShift"; shiftId: string };

/**
 * 🔴 プールの並びはサーバと同じ規則で戻す（staff_code 順・空は最後）。
 *   board.ts のクエリが `.order("staff_code", { nullsFirst: false })`。
 *   ここを合わせておかないと、外した瞬間に別の位置へ現れて目で追えなくなる。
 *   （協力会社の隊員は staff_code を持たないので必ず最後に来る）
 */
function sortPool(pool: GuardView[]): GuardView[] {
  return [...pool].sort((a, b) => {
    const x = a.guard.staff_code;
    const y = b.guard.staff_code;
    if (x === y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -1 : 1;
  });
}

function reduce(state: BoardState, move: Move): BoardState {
  switch (move.type) {
    case "place": {
      const view = state.pool.find((v) => v.guard.id === move.guardId);
      if (!view) return state;
      // 🔴 仮の id。サーバから本物が返るまでの間だけ生きる。
      //   `optimistic:` を接頭辞にしておくと、万一これが残っていても
      //   見た人が「返ってきていない」と分かる
      const plate: PlateView = {
        assignmentId: `optimistic:${move.guardId}`,
        guard: view.guard,
        qualLabels: view.qualLabels,
        role: "member",
        jobType: null,
        jobQualMissing: false,
        // 経験・NG はサーバでしか分からない。再取得で正しい値に置き換わる
        experienced: false,
        ngReasons: [],
        isPartner: view.isPartner,
        isOtherJurisdiction: false,
      };
      return {
        pool: state.pool.filter((v) => v.guard.id !== move.guardId),
        rows: state.rows.map((r) =>
          r.shift.id === move.toShiftId ? { ...r, plates: [...r.plates, plate] } : r,
        ),
      };
    }

    case "move": {
      const plate = state.rows
        .flatMap((r) => r.plates)
        .find((p) => p.assignmentId === move.assignmentId);
      if (!plate) return state;
      return {
        pool: state.pool,
        rows: state.rows.map((r) => {
          if (r.shift.id === move.toShiftId) {
            return { ...r, plates: [...r.plates.filter((p) => p !== plate), plate] };
          }
          return { ...r, plates: r.plates.filter((p) => p.assignmentId !== move.assignmentId) };
        }),
      };
    }

    case "unplace": {
      const plate = state.rows
        .flatMap((r) => r.plates)
        .find((p) => p.assignmentId === move.assignmentId);
      if (!plate) return state;
      return {
        pool: sortPool([
          ...state.pool,
          { guard: plate.guard, qualLabels: plate.qualLabels, isPartner: plate.isPartner },
        ]),
        rows: state.rows.map((r) => ({
          ...r,
          plates: r.plates.filter((p) => p.assignmentId !== move.assignmentId),
        })),
      };
    }

    // 🔴 隊長は枠に1人とは限らない（複数人置ける）。ここで他を降ろさない。
    //   「1枠1人」という規則は管制に確認していない（requirements.md §8-7）。
    //   確かめていない規則を画面が勝手に強制すると、直すのは現場ではなくこちらになる。
    case "role":
      return {
        pool: state.pool,
        rows: state.rows.map((r) => ({
          ...r,
          plates: r.plates.map((p) =>
            p.assignmentId === move.assignmentId ? { ...p, role: move.role } : p,
          ),
        })),
      };

    // 🔴 資格が足りるか（jobQualMissing）はサーバでしか分からない。再取得で正しい値になる
    case "job":
      return {
        pool: state.pool,
        rows: state.rows.map((r) => ({
          ...r,
          plates: r.plates.map((p) =>
            p.assignmentId === move.assignmentId ? { ...p, jobType: move.jobType } : p,
          ),
        })),
      };

    case "status":
      return {
        pool: state.pool,
        rows: state.rows.map((r) =>
          r.shift.id === move.shiftId ? { ...r, shift: { ...r.shift, status: move.status } } : r,
        ),
      };
    case "cancel":
      // 🔴 配置（plates）はそのまま。中止でも「誰を入れていたか」は残す。
      //   サーバ側も消していない（actions.ts の setShiftCancelled）。
      return {
        pool: state.pool,
        rows: state.rows.map((r) =>
          r.shift.id === move.shiftId
            ? {
                ...r,
                shift: {
                  ...r.shift,
                  // 楽観更新なので時刻の中身は使わない。null かどうかだけを見ている
                  cancelled_at: move.cancelled ? new Date().toISOString() : null,
                },
              }
            : r,
        ),
      };
    case "deleteShift": {
      // 🔴 枠に居た隊員はプールへ戻す。消えたまま画面から居なくなると、
      //   その人が空いていることに気づけない（サーバ側は cascade で
      //   assignments が消え、次の取得でプールに現れる）。
      const gone = state.rows.find((r) => r.shift.id === move.shiftId);
      const back: GuardView[] = (gone?.plates ?? []).map((p) => ({
        guard: p.guard,
        qualLabels: p.qualLabels,
        isPartner: p.isPartner,
      }));
      return {
        pool: sortPool([...state.pool, ...back]),
        rows: state.rows.filter((r) => r.shift.id !== move.shiftId),
      };
    }
  }
}

// ─────────────────────────────────────────────────────────
// プールのドロップ先
//
// 🔴 「外す」は D&D で1操作（§2-7）。プールのどこへ落としても外れる。
//   ゴミ箱アイコンのような小さな的にしない
// ─────────────────────────────────────────────────────────
function PoolDropArea({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool", data: { type: "pool" } });
  return (
    <div
      ref={setNodeRef}
      className={[
        "min-h-full transition-all duration-150 ease-in-out",
        isOver ? "bg-indigo-50 ring-2 ring-indigo-500 ring-inset" : "",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 得意先タブ・空表示
//
// 🔴 なぜサーバから JSX ではなく**データ**を受け取るのか（2026-09-03 修正）
//   当初は「Link はサーバで描くもの」と思い込み、タブと空表示を
//   ReactNode の props として page.tsx から渡していた。**これは誤り。**
//   ・`next/link` はクライアントコンポーネントでも普通に動く
//   ・Server Component で作った JSX を Client Component の props で渡すと、
//     クライアント側で配列の子として並んだときに
//     「key が無い」と React に警告される（境界を越えた要素は未検証扱いになる）
//   → 渡すのは**プレーンなデータだけ**にし、markup は使う場所で組む。
//     RSC のペイロードに描画済み markup を積まずに済む利点もある。
// ─────────────────────────────────────────────────────────

export type CustomerTabView = {
  /** 並びの key。得意先 id、未設定は固定値 */
  id: string;
  href: string;
  label: string;
  count: number;
  /** 🔴 不足はタブに出す。開かないと分からないと、絞り込みが見落としを生む */
  shortage: number;
  active: boolean;
};

export type EmptyBoardView = {
  /** 「日勤」/「夜勤」 */
  groupLabel: string;
  dateLabel: string;
  jurisdictionName: string;
  /** 枠がある直近の日への導線。無ければ null */
  nearest: { href: string; label: string } | null;
};

/** キーの表記。文中に混ぜても「これはキー」と読めるだけの見た目にする */
function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-sans text-[11px] text-slate-700">
      {children}
    </kbd>
  );
}

/** 得意先タブ。件数と不足を持たせ、開かなくても状況が分かるようにする */
function CustomerTab({ tab }: { tab: CustomerTabView }) {
  return (
    <Link
      href={tab.href}
      className={[
        "flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 text-[13px] font-semibold",
        "transition-all duration-150 ease-in-out",
        tab.active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
      ].join(" ")}
    >
      <span className="max-w-[16ch] truncate">{tab.label}</span>
      <span
        className={tab.active ? "tabular-nums text-indigo-100" : "tabular-nums text-slate-500"}
      >
        {tab.count}
      </span>
      {tab.shortage > 0 && (
        <span
          className={[
            "rounded px-1 text-[11px] leading-4",
            tab.active ? "bg-white/25 text-white" : "bg-rose-100 text-rose-700",
          ].join(" ")}
          title={`${tab.shortage}名 不足`}
        >
          不足{tab.shortage}
        </span>
      )}
    </Link>
  );
}

/**
 * 🔴 空のときに何も出さない画面にしない。
 *   「壊れているのか、その日が本当に空なのか」が利用者に区別できない。
 */
function EmptyBoard({ empty }: { empty: EmptyBoardView }) {
  return (
    <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center">
      <p className="text-[15px] font-semibold text-slate-700">
        この日の{empty.groupLabel}の枠はありません
      </p>
      <p className="t-meta mt-1 text-slate-500">
        {empty.dateLabel} ／ {empty.jurisdictionName}
      </p>
      {empty.nearest && (
        <Link
          href={empty.nearest.href}
          className="mt-3 inline-block rounded-md bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-indigo-700"
        >
          枠がある直近の日（{empty.nearest.label}）へ
        </Link>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 本体
// ─────────────────────────────────────────────────────────

export type BoardDndProps = {
  rows: ShiftRow[];
  pool: GuardView[];
  editable: boolean;
  showCustomerOnCard: boolean;
  /** 現在の管轄。プールの「他管轄」絞り込みに使う */
  jurisdictionId: string;
  /** 得意先タブ。1つ以下なら出さない（page.tsx が空配列で渡す） */
  customerTabs: CustomerTabView[];
  /** 🔴 見出しの件数は state から数える。得意先タブで絞っていても
   *  「この日の全体」は出し続ける（絞り込みで不足を見落とさないため） */
  totalSiteCount: number;
  totalPlaced: number;
  /** 得意先タブで絞っているか */
  filtered: boolean;
  /** 枠が0件のときに出す案内 */
  empty: EmptyBoardView;
  /** 非現場ステータス（有給・研修 …）。人数だけあればよい */
  /** 🔴 非現場（休み・内勤など）。氏名まで出す（2026-09-16） */
  offGroups: { label: string; names: string[] }[];
  /** 協力会社への貸出 */
  lentGroups: { companyName: string; siteName: string; count: number }[];
};

const POOL_FILTERS = ["自社", "協力会社", "他管轄", "資格あり"] as const;
type PoolFilter = (typeof POOL_FILTERS)[number];

export function BoardDnd({
  rows,
  pool,
  editable,
  showCustomerOnCard,
  jurisdictionId,
  customerTabs,
  totalSiteCount,
  totalPlaced,
  filtered,
  empty,
  offGroups,
  lentGroups,
}: BoardDndProps) {
  const [state, applyMove] = useOptimistic<BoardState, Move>({ rows, pool }, reduce);
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<
    { kind: "plate"; plate: PlateView } | { kind: "pool"; view: GuardView } | null
  >(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  // プールの絞り込み（ここはサーバに聞く必要が無い＝即座に効く）
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<PoolFilter>>(new Set());
  const searchRef = useRef<HTMLInputElement | null>(null);
  // 🔴 「Enter で置かれる1名」を光らせるのは、検索欄に居るときだけ。
  //   常に光らせると、盤面を触っている間ずっと関係のない1枚が目立つ
  const [searchFocused, setSearchFocused] = useState(false);
  // 🔴 開いている枠の編集ダイアログ（2026-09-09）。
  //   楽観更新の state ではなく **サーバの値** を出したいので id だけ持ち、
  //   中身は state.rows から引く（保存すると refresh() で描き直される）。
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  // 🔴 rows は props（サーバの値）から引く。楽観 state ではないので、
  //   保存後に refresh() が走れば正しい値で開き直る。
  const editingShift = editingShiftId ? rows.find((r) => r.shift.id === editingShiftId) : null;

  // 🔴 マウスを少し動かすまでドラッグを始めない。
  //   0 にすると確定バッジのクリックがドラッグとして食われる。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  /** 書き込みを1か所に集める。失敗したメッセージの出し方を揃えるため */
  function run(move: Move, action: () => Promise<ActionResult>) {
    startTransition(async () => {
      applyMove(move);
      const result = await callAction(action);
      // 🔴 失敗しても画面を戻す処理は書かない。
      //   useOptimistic は transition が終わるとサーバの値に戻る＝
      //   置けなかったプレートは自動で元の場所へ帰る（§2-5「プレートが戻る」）
      // 🔴 通信断のときは callAction が details を持たない失敗を返す（`in` で見る）
      setError(
        result.ok
          ? null
          : { message: result.message, details: "details" in result ? (result.details ?? []) : [] },
      );
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    if (data?.type === "plate") setDragging({ kind: "plate", plate: data.plate as PlateView });
    else if (data?.type === "pool") setDragging({ kind: "pool", view: data.view as GuardView });
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const over = event.over?.data.current;
    const active = event.active.data.current;
    if (!over || !active) return;

    // プール → 枠
    if (active.type === "pool" && over.type === "shift") {
      const guardId = (active.view as GuardView).guard.id;
      const shiftId = over.shiftId as string;
      run({ type: "place", guardId, toShiftId: shiftId }, () =>
        placeGuard({ guardId, shiftId, position: over.plateCount as number }),
      );
      return;
    }

    // 枠 → 別の枠
    if (active.type === "plate" && over.type === "shift") {
      const plate = active.plate as PlateView;
      const from = state.rows.find((r) =>
        r.plates.some((p) => p.assignmentId === plate.assignmentId),
      );
      // 同じ枠に戻しただけなら何もしない（枠の中の並べ替えは未実装）
      if (from?.shift.id === over.shiftId) return;
      run(
        { type: "move", assignmentId: plate.assignmentId, toShiftId: over.shiftId as string },
        () =>
          moveAssignment({
            assignmentId: plate.assignmentId,
            toShiftId: over.shiftId as string,
            position: over.plateCount as number,
          }),
      );
      return;
    }

    // 枠 → プール
    if (active.type === "plate" && over.type === "pool") {
      const plate = active.plate as PlateView;
      run({ type: "unplace", assignmentId: plate.assignmentId }, () =>
        unplaceAssignment({ assignmentId: plate.assignmentId }),
      );
    }
  }

  function handleToggleStatus(shiftId: string, next: "draft" | "confirmed") {
    run({ type: "status", shiftId, status: next }, () => setShiftStatus({ shiftId, status: next }));
  }

  function handleDeleteShift(shiftId: string) {
    run({ type: "deleteShift", shiftId }, () => deleteShift({ shiftId }));
  }

  function handleToggleCancel(shiftId: string, cancelled: boolean) {
    run({ type: "cancel", shiftId, cancelled }, () => setShiftCancelled({ shiftId, cancelled }));
  }

  // ── プールの絞り込み ──────────────────────────────────
  const visiblePool = state.pool.filter((v) => {
    if (query && !`${v.guard.name}${v.guard.short_name}`.includes(query)) return false;
    if (filters.has("自社") && v.isPartner) return false;
    if (filters.has("協力会社") && !v.isPartner) return false;
    if (filters.has("他管轄") && v.guard.jurisdiction_id === jurisdictionId) return false;
    if (filters.has("資格あり") && v.qualLabels.length === 0) return false;
    return true;
  });

  function toggleFilter(f: PoolFilter) {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) {
        next.delete(f);
      } else {
        // 🔴 `自社` と `協力会社` は同時に押せない（押すと必ず0件になる）。
        //   0件の理由が「そういう人が居ない」のか「押し方が悪い」のかを
        //   画面から区別できない。後から押したほうを生かす。
        if (f === "自社") next.delete("協力会社");
        if (f === "協力会社") next.delete("自社");
        next.add(f);
      }
      return next;
    });
  }

  // ── キーボード操作（§2-8） ────────────────────────────
  //
  // 🔴 キーボードと D&D で**別の書き込み経路を作らない**。どちらも同じ run() を通す。
  //   2本あると、片方だけ直した／片方だけ楽観更新が効かない、が必ず起きる。
  const keys = useBoardKeys({
    rows: state.rows,
    candidates: visiblePool,
    enabled: editable,
    searchRef,
    onClearQuery: () => setQuery(""),
    onPlace: (guardId, shiftId) => {
      // position は D&D と同じ「いま何枚入っているか」＝末尾に足す
      const count = state.rows.find((r) => r.shift.id === shiftId)?.plates.length ?? 0;
      run({ type: "place", guardId, toShiftId: shiftId }, () =>
        placeGuard({ guardId, shiftId, position: count }),
      );
    },
    onUnplace: (assignmentId) =>
      run({ type: "unplace", assignmentId }, () => unplaceAssignment({ assignmentId })),
    onSetRole: (assignmentId, role) =>
      run({ type: "role", assignmentId, role }, () => setAssignmentRole({ assignmentId, role })),
    onSetJobType: handleSetJobType,
    onConfirm: (shiftId) => handleToggleStatus(shiftId, "confirmed"),
  });

  function handleSelect(shiftId: string, assignmentId: string | null) {
    if (!editable) return;
    keys.select(shiftId, assignmentId);
  }

  function handleSetRole(assignmentId: string, role: AssignmentRole) {
    run({ type: "role", assignmentId, role }, () => setAssignmentRole({ assignmentId, role }));
  }

  function handleSetJobType(assignmentId: string, jobType: JobType | null) {
    run({ type: "job", assignmentId, jobType }, () =>
      setAssignmentJobType({ assignmentId, jobType }),
    );
  }

  return (
    <DndContext
      // 🔴 id を必ず渡す（2026-09-03）。渡さないと dnd-kit は
      //   モジュール内のカウンタで採番する（@dnd-kit/utilities の useUniqueId）。
      //   サーバ描画とクライアント描画で番号がずれ、読み上げ用の
      //   aria-describedby が食い違って **hydration mismatch** になる。
      //   1画面に DndContext は1つなので、固定文字列で足りる。
      id="board"
      sensors={sensors}
      // 🔴 pointerWithin にする。既定の rectIntersection は
      //   カードが密に並ぶ画面で「隣の枠が反応する」ことがある。
      //   ポインタが乗っている先＝置く先、が管制の期待に合う
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex min-h-0 flex-1">
        {/* ── 左：配置（現場 × 枠） ── */}
        <main className="thin-scroll min-w-0 flex-1 overflow-y-auto p-4">
          {/* 🔴 件数は楽観更新後の state から数える。サーバの値をそのまま出すと、
              プレートを置いた直後だけカードと件数が食い違って見える */}
          <div className="mb-2.5 flex items-baseline gap-2 px-0.5">
            <h1 className="text-[15px] font-semibold tracking-tight text-slate-700">配置</h1>
            <span className="t-meta text-slate-500">
              現場 {state.rows.length} 件 ／ 配置{" "}
              {state.rows.reduce((n, r) => n + r.plates.length, 0)} 名
              {filtered && (
                <span className="ml-1 text-slate-400">
                  （この日の全体は {totalSiteCount} 件 / {totalPlaced} 名）
                </span>
              )}
            </span>
          </div>

          {/* 🔴 絞り込むのは**カードだけ**。ヘッダの件数と下の「要確認」は
              その日の全体を出し続ける。絞り込みで警告が隠れると、
              見えていない現場の不足に気づけないまま当日を迎える */}
          {customerTabs.length > 0 && (
            <div className="mb-3.5 flex flex-wrap items-center gap-2">
              {customerTabs.map((tab) => (
                <CustomerTab key={tab.id} tab={tab} />
              ))}
            </div>
          )}

          {state.rows.length === 0 ? (
            <EmptyBoard empty={empty} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-stretch gap-3">
              {state.rows.map((row) => (
                <ShiftRowCard
                  key={row.shift.id}
                  row={row}
                  showCustomer={showCustomerOnCard}
                  editable={editable}
                  selected={keys.selection.shiftId === row.shift.id}
                  selectedPlateId={
                    keys.selection.shiftId === row.shift.id ? keys.selection.assignmentId : null
                  }
                  onToggleStatus={handleToggleStatus}
                  onToggleCancel={handleToggleCancel}
                  onDelete={handleDeleteShift}
                  onEdit={setEditingShiftId}
                  onSelect={handleSelect}
                  onSetRole={handleSetRole}
                  onSetJobType={handleSetJobType}
                />
              ))}
            </div>
          )}
        </main>

        {/* ── 右：隊員プール ── */}
        <PoolPane poolCount={state.pool.length}>
          <PoolDropArea>
            <div className="px-3 py-2">
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={keys.onSearchKeyDown}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="氏名で検索（/ でここへ）"
                className="h-10 w-full rounded-md border-2 border-slate-300 px-2.5 text-[14px] transition-all duration-150 ease-in-out outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {POOL_FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFilter(f)}
                    aria-pressed={filters.has(f)}
                    className={[
                      "t-meta cursor-pointer rounded-md border-2 px-2 py-1",
                      "transition-all duration-150 ease-in-out",
                      filters.has(f)
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {/* 🔴 絞り込んだ結果が0件なら、そう言う。
                  空欄のままだと「全員配置済み」と読み違える */}
              {visiblePool.length !== state.pool.length && (
                <div className="t-meta mt-1.5 text-slate-500">
                  {visiblePool.length} 名を表示（未配置 {state.pool.length} 名中）
                </div>
              )}

              {/* ── キーの案内 ──
                  🔴 ショートカットは**見えていないと使われない**。
                    「知っている人だけ速い」は、覚える気のない人の速度が
                    現行（べんり君）より落ちるということ。常時1行だけ出す。
                  🔴 押したのに何も起きなかったときは、同じ場所で理由を出す。
                    無反応だと「壊れている」と読まれる。 */}
              {editable &&
                (keys.notice ? (
                  <div
                    role="status"
                    className="t-meta mt-2 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-amber-800"
                  >
                    {keys.notice}
                  </div>
                ) : (
                  <div className="t-meta mt-2 leading-snug text-slate-500">
                    <KeyCap>↑↓</KeyCap> 枠 <KeyCap>←→</KeyCap> プレート <KeyCap>Enter</KeyCap>{" "}
                    枠→検索→配置 <KeyCap>Esc</KeyCap> 盤面へ戻る
                    <br />
                    <KeyCap>/</KeyCap> 検索 <KeyCap>Del</KeyCap> 外す <KeyCap>L</KeyCap> 隊長{" "}
                    <KeyCap>Ctrl+S</KeyCap> この枠を確定
                  </div>
                ))}
            </div>

            {/* 🔴 3列（2026-10-05）。4列だと名札が狭く、名前やバッジが入りきらなかった */}
            <div className="grid grid-cols-3 gap-2 px-3 pb-3">
              {visiblePool.map((view, i) => (
                // 🔴 Enter で置かれる1名を光らせる。「どれが置かれるのか」が
                //   見えないまま Enter を押させると、外れたときに原因が分からない
                <div
                  key={view.guard.id}
                  className={
                    searchFocused && i === keys.cursor
                      ? "rounded-lg outline-2 outline-offset-1 outline-indigo-600"
                      : ""
                  }
                >
                  <DraggablePoolPlate view={view} disabled={!editable} />
                </div>
              ))}
            </div>

            {/* 非現場ステータス */}
            {/* 🔴 氏名まで出す（2026-09-16・管制の要望）。
                休みの隊員はプールから消えるので、**消えた人を確かめる場所**がここになる。
                件数だけだと「誰が休みか」を別の画面へ探しに行くことになっていた。
                区分を指定した休み（一部勤務可）は見出しに「有給（夜A）」のように出る。 */}
            <PaneHeading
              title="非現場"
              sub={`${offGroups.reduce((n, g) => n + g.names.length, 0)} 名`}
            />
            <div className="px-3 py-2">
              {offGroups.length === 0 && (
                <p className="t-meta text-slate-400">この日は居ません</p>
              )}
              {offGroups.map((g) => (
                <div key={g.label} className="border-b border-slate-200 py-1.5 last:border-b-0">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] font-semibold text-slate-700">{g.label}</span>
                    <span className="text-[14px] font-bold tabular-nums text-slate-800">
                      {g.names.length}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                    {g.names.map((n, i) => (
                      <span key={`${n}-${i}`} className="t-meta text-slate-500">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 協力会社への貸出。🔴 請求に効くため第1弾から持つ（data-model.md §4-2） */}
            <PaneHeading
              title="貸出中（協力会社へ）"
              sub={`${lentGroups.reduce((n, g) => n + g.count, 0)} 名`}
            />
            <div className="px-3 py-2">
              {lentGroups.map((g) => (
                <div
                  key={`${g.companyName}:${g.siteName}`}
                  className="flex items-baseline gap-2 border-b border-slate-200 py-1"
                >
                  <span className="text-[14px] font-semibold text-slate-800">{g.companyName}</span>
                  <span className="t-meta truncate text-slate-500">{g.siteName}</span>
                  <span className="ml-auto text-[15px] font-bold tabular-nums text-slate-800">
                    {g.count}
                  </span>
                </div>
              ))}
            </div>
          </PoolDropArea>
        </PoolPane>
      </div>

      {/* ── ドラッグ中に指の下へ付いてくる1枚 ──
          🔴 元の場所に薄く残したまま、掴んだものを別に描く。
             どこから来て今どこにいるかが同時に見える */}
      <DragOverlay dropAnimation={null}>
        {dragging?.kind === "plate" && (
          <div className="rotate-2 opacity-95 shadow-lg">
            <Plate plate={dragging.plate} />
          </div>
        )}
        {dragging?.kind === "pool" && (
          <div className="rotate-2 opacity-95 shadow-lg">
            <PoolPlate view={dragging.view} />
          </div>
        )}
      </DragOverlay>

      {/* ── 失敗の通知 ──
          🔴 レイアウトを押し広げない位置に出す。カードが動くと
             「何が起きたか」より「表示が崩れた」に見える */}
      {error && (
        <div
          role="alert"
          className="fixed top-16 left-1/2 z-50 flex max-w-[720px] -translate-x-1/2 items-start gap-3 rounded-lg border-2 border-rose-400 bg-white px-4 py-2.5 text-left shadow-lg"
        >
          <span className="t-badge mt-0.5 shrink-0 rounded bg-rose-100 px-1.5 py-0.5 leading-5 text-rose-700">
            置けません
          </span>
          <div className="min-w-0 text-[14px] leading-snug text-slate-800">
            {error.message}
            {/* 🔴 誰が・どことどこで重なっているかを名前で出す（2026-09-04） */}
            {error.details.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 border-t border-slate-200 pt-1.5">
                {error.details.slice(0, 8).map((d) => (
                  <li key={d} className="text-[13px] text-slate-700">
                    ・{d}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-1 shrink-0 cursor-pointer rounded px-1.5 text-[13px] text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800"
          >
            閉じる
          </button>
        </div>
      )}

      {/* ── 枠の編集（2026-09-09） ─────────────────────────
          🔴 「それぞれの枠から確認・編集」（柴山）への対応。
             カードの「編集」から開く。現場そのものは差し替えない。 */}
      {editingShift && (
        <ShiftEditDialog
          shift={editingShift.shift}
          siteName={editingShift.site.name}
          onClose={() => setEditingShiftId(null)}
        />
      )}
    </DndContext>
  );
}

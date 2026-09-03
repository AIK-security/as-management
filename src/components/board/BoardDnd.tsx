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

import { useOptimistic, useState, useTransition } from "react";
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
import { PoolPane } from "@/components/board/BoardPanes";
import {
  moveAssignment,
  placeGuard,
  setShiftStatus,
  unplaceAssignment,
  type ActionResult,
} from "@/app/board/actions";
import type { GuardView, PlateView, ShiftRow } from "@/lib/types";

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
  | { type: "status"; shiftId: string; status: "draft" | "confirmed" };

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

    case "status":
      return {
        pool: state.pool,
        rows: state.rows.map((r) =>
          r.shift.id === move.shiftId ? { ...r, shift: { ...r.shift, status: move.status } } : r,
        ),
      };
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
// 本体
// ─────────────────────────────────────────────────────────

export type BoardDndProps = {
  rows: ShiftRow[];
  pool: GuardView[];
  editable: boolean;
  showCustomerOnCard: boolean;
  /** 現在の管轄。プールの「他管轄」絞り込みに使う */
  jurisdictionId: string;
  /** サーバで描いた得意先タブ（Link を含むのでそのまま差し込む） */
  customerTabs: React.ReactNode;
  /** 🔴 見出しの件数は state から数える。得意先タブで絞っていても
   *  「この日の全体」は出し続ける（絞り込みで不足を見落とさないため） */
  totalSiteCount: number;
  totalPlaced: number;
  /** 得意先タブで絞っているか */
  filtered: boolean;
  /** 枠が0件のときの案内（Link を含む） */
  emptyState: React.ReactNode;
  /** プールの下に続く「非現場」「貸出中」 */
  poolFooter: React.ReactNode;
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
  emptyState,
  poolFooter,
}: BoardDndProps) {
  const [state, applyMove] = useOptimistic<BoardState, Move>({ rows, pool }, reduce);
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<
    { kind: "plate"; plate: PlateView } | { kind: "pool"; view: GuardView } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  // プールの絞り込み（ここはサーバに聞く必要が無い＝即座に効く）
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<PoolFilter>>(new Set());

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
      const result = await action();
      // 🔴 失敗しても画面を戻す処理は書かない。
      //   useOptimistic は transition が終わるとサーバの値に戻る＝
      //   置けなかったプレートは自動で元の場所へ帰る（§2-5「プレートが戻る」）
      setError(result.ok ? null : result.message);
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
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  return (
    <DndContext
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

          {customerTabs}

          {state.rows.length === 0 ? (
            emptyState
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-stretch gap-3">
              {state.rows.map((row) => (
                <ShiftRowCard
                  key={row.shift.id}
                  row={row}
                  showCustomer={showCustomerOnCard}
                  editable={editable}
                  onToggleStatus={handleToggleStatus}
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
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="氏名で検索"
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
            </div>

            <div className="flex flex-wrap gap-2 px-3 pb-3">
              {visiblePool.map((view) => (
                <DraggablePoolPlate key={view.guard.id} view={view} disabled={!editable} />
              ))}
            </div>

            {poolFooter}
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
          className="fixed top-16 left-1/2 z-50 flex max-w-[560px] -translate-x-1/2 items-start gap-3 rounded-lg border-2 border-rose-400 bg-white px-4 py-2.5 shadow-lg"
        >
          <span className="t-badge shrink-0 rounded bg-rose-100 px-1.5 py-0.5 leading-5 text-rose-700">
            置けません
          </span>
          <span className="text-[14px] leading-snug text-slate-800">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-1 shrink-0 cursor-pointer rounded px-1.5 text-[13px] text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800"
          >
            閉じる
          </button>
        </div>
      )}
    </DndContext>
  );
}

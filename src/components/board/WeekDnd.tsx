// S-07 A表（週表）の D&D。設計は docs/screen-design.md §7-2-4／§7-2-5。
//
// 🔴 Server Action は1本も書き足していない。
//   placeGuard / moveAssignment / unplaceAssignment をそのまま使う。
//   **日をまたぐ移動も既存のままで成立する** ─ assignments_fill_planned_times
//   （20260903000000）が `before update of shift_id` で発火し、
//   `new.work_date := s.work_date` で日付を枠に合わせるため。
//   ここで work_date を送ると、規則が2か所に生まれてやがてズレる。
//
// 🔴 止めるのは重複だけ。あとは警告（§2-5 と同じ）。
//   重なりを止めるのは DB の assignments_no_overlap であって、この画面ではない。
//   置けなかったプレートは refresh() 後の再描画で元の場所へ戻る。
//
// 🔴 楽観更新（useOptimistic）は入れていない。
//   日別（BoardDnd）は rows が平らな配列なので楽観更新を書けるが、
//   週表は 得意先 > 現場 > 7日 > 枠 > 隊員 と深く、同じことをすると
//   「画面の更新規則」がもう1つ増える。1名体制では読めなくなるほうが高くつく。
//   → まずサーバの値だけを信じる。遅ければ後で足す（そのとき初めて必要が分かる）。
"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  moveAssignment,
  placeGuard,
  unplaceAssignment,
  type ActionResult,
} from "@/app/board/actions";
import { callAction } from "@/lib/action-call";
import { formatWeekDay } from "@/lib/board-format";
import { PoolPane } from "@/components/board/BoardPanes";
import { WeekGrid } from "@/components/board/WeekGrid";
import type { WeekBoardData, WeekPlate, WeekPoolGuard } from "@/lib/week-board";

// ─────────────────────────────────────────────────────────
// プールの隊員1名
// ─────────────────────────────────────────────────────────
function PoolCard({ p, editable }: { p: WeekPoolGuard; editable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pool-${p.guard.id}`,
    data: { type: "pool", pool: p },
    disabled: !editable,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={p.guard.name}
      className={[
        "rounded-md border px-1.5 py-1 text-[13px] leading-tight",
        editable ? "cursor-grab active:cursor-grabbing" : "",
        isDragging ? "opacity-30" : "",
        p.isPartner ? "border-slate-300 bg-slate-100" : "border-slate-200 bg-white",
      ].join(" ")}
    >
      <div className="truncate font-medium text-slate-900">
        {p.guard.short_name || p.guard.name}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {p.qualLabels.map((q) => (
          <span
            key={q}
            className="rounded bg-emerald-50 px-1 text-[10px] font-semibold text-emerald-700"
          >
            {q}
          </span>
        ))}
        {/* 🔴 これが週表を見る意味そのもの。日別の画面では出せない情報 */}
        <span className="t-meta ml-auto text-slate-400">週{p.weekDays}日</span>
      </div>
    </div>
  );
}

export function WeekDnd({
  data,
  baseHrefs,
  dayHrefs,
  editable,
  printHeading,
}: {
  data: WeekBoardData;
  baseHrefs: string[];
  dayHrefs: string[];
  editable: boolean;
  /** 紙にだけ出す見出し（画面には出ない） */
  printHeading: { title: string; asOf: string };
}) {
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState<{ label: string } | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  // 🔴 マウスを少し動かすまでドラッグを始めない。
  //   0 にすると、セルの時刻リンク（日別へ飛ぶ）のクリックがドラッグに食われる。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  /** 書き込みを1か所に集める。失敗したメッセージの出し方を揃えるため */
  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await callAction(action);
      // 🔴 通信断のときは callAction が details を持たない失敗を返す（`in` で見る）
      setError(
        result.ok
          ? null
          : { message: result.message, details: "details" in result ? (result.details ?? []) : [] },
      );
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const d = event.active.data.current;
    if (!d) return;
    if (d.type === "pool") {
      const p = d.pool as WeekPoolGuard;
      setDragging({ label: p.guard.short_name || p.guard.name });
    } else if (d.type === "plate") {
      const p = d.plate as WeekPlate;
      setDragging({ label: p.guard.short_name || p.guard.name });
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const over = event.over?.data.current;
    const active = event.active.data.current;
    if (!over || !active) return;

    // プール → 枠
    if (active.type === "pool" && over.type === "shift") {
      const guardId = (active.pool as WeekPoolGuard).guard.id;
      const shiftId = over.shiftId as string;
      run(() => placeGuard({ guardId, shiftId, position: over.plateCount as number }));
      return;
    }

    // 枠 → 別の枠（🔴 週表では**日をまたぐ**。work_date は DB のトリガが合わせる）
    if (active.type === "plate" && over.type === "shift") {
      const plate = active.plate as WeekPlate;
      const toShiftId = over.shiftId as string;
      // 同じ枠へ戻しただけなら何もしない（枠の中の並べ替えは未実装）
      if (findShiftIdOf(data, plate.assignmentId) === toShiftId) return;
      run(() =>
        moveAssignment({
          assignmentId: plate.assignmentId,
          toShiftId,
          position: over.plateCount as number,
        }),
      );
      return;
    }

    // 枠 → プール（配置を外す）
    if (active.type === "plate" && over.type === "pool") {
      const plate = active.plate as WeekPlate;
      run(() => unplaceAssignment({ assignmentId: plate.assignmentId }));
    }
  }

  return (
    <DndContext
      id="week-dnd"
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className={`flex min-h-0 min-w-0 flex-1 ${pending ? "opacity-70" : ""}`}>
        <WeekGrid
          data={data}
          baseHrefs={baseHrefs}
          dayHrefs={dayHrefs}
          editable={editable}
          printHeading={printHeading}
        />

        {/* ── 隊員プール（基準日で絞る・§7-2-4）──────────────
            🔴 畳めるようにする。週表は横に長く、右を 260px 占めたままだと
              7日が1画面に入らない環境が出る。作法は日別（PoolPane）と同じ。
            🔴 開閉の保存キーは日別と分ける。広げたい理由が画面ごとに違う。 */}
        <PoolPane
          poolCount={data.pool.length}
          storageKey="week.pool.collapsed"
          widthClass="w-[260px]"
          sub={`${formatWeekDay(data.baseDate)}・${data.pool.length}名`}
        >
          <PoolBody data={data} editable={editable} />
        </PoolPane>
      </div>

      {/* 🔴 失敗は必ず見せる。黙って戻ると「置けたつもり」になる */}
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
            {error.details.length > 0 && (
              <ul className="mt-1.5 max-h-[40vh] space-y-0.5 overflow-y-auto border-t border-slate-200 pt-1.5">
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

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="rounded-md border-2 border-indigo-500 bg-white px-2 py-1 text-[13px] font-medium text-slate-900 shadow-lg">
            {dragging.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** プールの中身。ここ全体が「外す」ための落とし先でもある */
function PoolBody({ data, editable }: { data: WeekBoardData; editable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "pool",
    data: { type: "pool" },
    disabled: !editable,
  });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-full p-2 ${isOver ? "bg-indigo-50" : ""}`}
    >
      <p className="t-meta mb-1.5 text-slate-400">
        日付の見出しで基準日を変えられます。ここへ戻すと配置から外れます
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {data.pool.map((p) => (
          <PoolCard key={p.guard.id} p={p} editable={editable} />
        ))}
      </div>
    </div>
  );
}

/** その配置がいまどの枠にいるか。同じ枠へ落としたときに何もしないため */
function findShiftIdOf(data: WeekBoardData, assignmentId: string): string | null {
  for (const g of data.groups) {
    for (const row of g.rows) {
      for (const cell of row.cells) {
        for (const s of cell.shifts) {
          if (s.plates.some((p) => p.assignmentId === assignmentId)) return s.shift.id;
        }
      }
    }
  }
  return null;
}

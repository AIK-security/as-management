// 得意先の中の現場の並べ替え（2026-11-17・赤尾さんの要望②）
//
// 🔴 配置ボードの得意先見出しから開く小窓。カードそのものは掴ませない ──
//   盤面は名札の D&D に使っており、カードまで掴めると誤操作の元になる。
// 🔴 並べるのは**この日の盤面に出ている現場**だけ。決めた順は毎日・週表でも同じに使われる。
// 🔴 掴んで動かすか ↑↓。どちらでも同じ（掴むのが苦手な人・細かく1つずつ動かしたいとき用に ↑↓ を残す）。
// 🔴 window.confirm は使わない（2026-09-04 決定）。保存するまで何も変わらない。
"use client";

import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderSites } from "@/app/board/actions";
import { callAction } from "@/lib/action-call";

type SiteItem = { id: string; name: string };

const ARROW =
  "h-6 w-6 cursor-pointer rounded border border-slate-300 bg-white text-[12px] text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30";

function SortableSiteRow({
  item,
  index,
  last,
  onMove,
}: {
  item: SiteItem;
  index: number;
  last: number;
  onMove: (from: number, to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[
        "flex items-center gap-2 border-b border-slate-100 bg-white px-2 py-1.5 last:border-b-0",
        isDragging ? "relative z-10 shadow-md" : "",
      ].join(" ")}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={`${item.name} を掴んで動かす`}
        className="cursor-grab px-1 text-slate-400 select-none active:cursor-grabbing"
      >
        ≡
      </span>
      <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-slate-400">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] text-slate-900" title={item.name}>
        {item.name}
      </span>
      <button
        type="button"
        aria-label="1つ上へ"
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
        className={ARROW}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="1つ下へ"
        disabled={index === last}
        onClick={() => onMove(index, index + 1)}
        className={ARROW}
      >
        ↓
      </button>
    </li>
  );
}

export function ReorderSitesDialog({
  customerId,
  customerName,
  sites,
}: {
  customerId: string;
  customerName: string;
  /** その日の盤面に出ている順（重複なし） */
  sites: SiteItem[];
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SiteItem[]>(sites);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function openDialog() {
    // 🔴 開くたびに盤面のいまの順から始める（前回の閉じ方に引きずられない）
    setItems(sites);
    setError(null);
    setOpen(true);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    setItems((xs) => arrayMove(xs, from, to));
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((x) => x.id === active.id);
    const to = items.findIndex((x) => x.id === over.id);
    if (from >= 0 && to >= 0) move(from, to);
  }

  async function save() {
    setPending(true);
    setError(null);
    const result = await callAction(() =>
      reorderSites({ customerId, siteIds: items.map((x) => x.id) }),
    );
    setPending(false);
    if (!result.ok) {
      setError(result.message ?? "保存できませんでした。");
      return;
    }
    setOpen(false);
  }

  const changed = items.some((x, i) => x.id !== sites[i]?.id);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openDialog())}
        className={[
          "cursor-pointer rounded-md border px-1.5 py-0.5 text-[12px] font-medium transition-all duration-150 ease-in-out",
          open
            ? "border-indigo-600 bg-indigo-600 text-white"
            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100",
        ].join(" ")}
      >
        並べ替え
      </button>

      {open && (
        <div
          className="absolute top-full left-0 z-30 mt-1 w-[380px] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg"
          onKeyDown={(e) => {
            // 🔴 盤面のキー操作（↑↓ で枠を選ぶ・Esc 等・useBoardKeys は window で受ける）へ流さない
            e.stopPropagation();
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate text-[14px] font-semibold text-slate-900">
              {customerName} の並び順
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              閉じる（Esc）
            </button>
          </div>
          <p className="t-meta mb-2 leading-snug text-slate-500">
            ≡ を掴んで動かすか、↑↓ で並べ替えます。決めた順は明日以降と週表でも使われます。
          </p>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              <ul className="thin-scroll max-h-[60vh] overflow-y-auto rounded-md border border-slate-200">
                {items.map((item, i) => (
                  <SortableSiteRow
                    key={item.id}
                    item={item}
                    index={i}
                    last={items.length - 1}
                    onMove={move}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          {error && (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[13px] text-rose-700">
              {error}
            </div>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-md border-2 border-slate-300 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending || !changed}
              className="cursor-pointer rounded-md border-2 border-indigo-600 bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "保存中…" : "この順で保存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

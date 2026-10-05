// 名札に出す資格の文字を組む（2026-10-05）。
//
// 🔴 列車見張（qualifications.category = 'train'）は鉄道会社ごとに別の資格で、
//   1人で4〜5社持つ人がいる。交1／交2 と同じく全部並べると 84px の名札からはみ出す。
//   そこで出し方を2通りにする（柴山・2026-10-05）：
//   ・"site"（枠の中の名札）… その現場が必要とする会社のものだけ出す
//   ・"pool"（プール・A表）  … 「列5」のように1つに畳む。中身は train で返す
//   区分の無い資格（交1・交2 など）はどちらでも全部出す。
//
// 🔴 board.ts と week-board.ts（どちらも server-only）から使うので、ここは純粋な関数だけ置く。

import type { Qualification } from "@/lib/types";

/** プールで列車見張を畳んだときの頭文字。名札のバッジとツールチップの判定に使う */
export const TRAIN_PREFIX = "列";

export function foldQuals(
  qualIds: string[],
  qualById: Map<string, Qualification>,
  mode: { kind: "site"; required: Set<string> } | { kind: "pool" },
): { labels: string[]; train: string[] } {
  const labels: string[] = [];
  const train: string[] = [];
  for (const id of qualIds) {
    const q = qualById.get(id);
    if (!q) continue;
    if (q.category !== "train") {
      labels.push(q.short_label);
      continue;
    }
    train.push(q.short_label);
    if (mode.kind === "site" && mode.required.has(id)) labels.push(q.short_label);
  }
  if (mode.kind === "pool" && train.length > 0) labels.push(`${TRAIN_PREFIX}${train.length}`);
  return { labels, train };
}

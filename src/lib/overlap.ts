// 時間帯の重なりを見つける（2026-09-04）。
//
// 🔴 **これは判定ではない。判定は DB の `assignments_no_overlap` がする。**
//   ここは「押す前に見せる」「落ちた理由を説明する」ための写しであって、
//   保存の可否を決めない。可否を持つのは最後まで DB の1か所。
//   → 規則が2つに増えたように見えるが、増えているのは**言い方**であって可否ではない。
//
// 🔴 重なりだけは、警告の中で唯一「確定を丸ごと止める」条件である。
//   不足も資格不足も NG も置けるが（§2-5）、重なりだけは置けない。
//   だから他の警告と違い、**先に見えていないと作業が止まる**。
//
// 🔴 使う側が2つある（`board.ts` の要確認 と `actions.ts` の失敗の説明）ため、
//   規則をここ1本に置く。文面は使う側がそれぞれ組む。

export type Span = {
  /** 重なりを見る単位。ここでは隊員 id */
  key: string;
  /** ISO 8601（timestamptz）。オフセット付き */
  start: string;
  end: string;
};

/**
 * 同じ key で時間帯が重なる組をすべて返す。
 *
 * 🔴 文字列ではなく**時刻に直してから**並べ・比べる。
 *   timestamptz の文字列表現はオフセットの書き方に幅があり
 *   （`+09` と `+00:00` が混ざるなど）、文字列比較では前後が入れ替わる。
 *   実際にこれを取り違えて「重なりは無い」と誤った確認をしている（2026-09-04）。
 */
export function findOverlaps<T extends Span>(spans: T[]): [T, T][] {
  const byKey = new Map<string, T[]>();
  for (const s of spans) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);

  const pairs: [T, T][] = [];
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        // 開始順に並んでいるので、始まりが前の終わり以降なら、以降も重ならない
        if (Date.parse(sorted[j].start) >= Date.parse(sorted[i].end)) break;
        pairs.push([sorted[i], sorted[j]]);
      }
    }
  }
  return pairs;
}

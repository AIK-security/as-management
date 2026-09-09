// 一斉連絡（S-03）の「サーバに依存しない部分」（2026-09-09）。
//
// 🔴 なぜ lib/notices.ts と分けるのか
//   notices.ts は Supabase のサーバクライアント（next/headers）を使う。
//   画面（NoticeComposer）は "use client" なので、型と差し込みだけのために
//   notices.ts を import すると **サーバ専用コードがクライアントバンドルへ入って
//   ビルドが落ちる**（2026-09-09 に実際に落ちた。tsc も eslint も素通りした）。
//
//   既にある board.ts / board-format.ts と同じ分け方に揃える。
//   **型と純粋な関数はこちら、DB を叩くものは notices.ts。**

/** 宛先の経路。line=本人へ / phone=電話リストへ回す / company=所属会社経由 */
export type NoticeChannel = "line" | "phone" | "company";

export type NoticeTarget = {
  guardId: string;
  name: string;
  shortName: string;
  channel: NoticeChannel;
  /** channel='line' のときの宛先（LINE ID など） */
  lineValue: string | null;
  /** channel='phone' のときの電話番号。無ければ null（＝連絡手段が無い） */
  phoneValue: string | null;
  companyId: string | null;
  companyName: string | null;
  companyEmail: string | null;
  /** 差し込み用 */
  siteName: string;
  bandName: string | null;
  startText: string;
  endText: string;
  planComment: string | null;
  shiftId: string;
  cancelled: boolean;
  /** 仮組み（確定していない）。確定済みなら false */
  isDraft: boolean;
  /**
   * 🔴 **今日この枠が動いたか**（JST）。当日変更の連絡はここで絞る。
   *
   * 🔴 「確定後に変更された」を直接は知れない。
   *   2026-09-03 に `changed_after_confirm` 列を捨て、確定後に変わったら
   *   **仮組みへ戻す（confirmed_at も null にする）**設計へ変えたため、
   *   「一度も確定していない仮組み」と「確定後に戻された仮組み」が区別できない。
   *   → 代わりに shifts.updated_at（トリガーで維持）を見て**近似**する。
   *   正確に取るなら変更履歴のテーブルが要る（同マイグレーションも同じことを書いている）。
   */
  updatedToday: boolean;
};

export type MessageTemplate = {
  id: string;
  name: string;
  kind: string;
  body: string;
};

/**
 * 差し込みの解釈。DB は文字列を持つだけで、記法はここでだけ決める。
 *
 * 🔴 値が空の差し込みは**行ごと落とす**（2026-09-09）。
 *   集合場所が未入力の枠で「集合：」という行だけが残り、そのまま LINE に
 *   貼られてしまっていた。実際に画面で見て気づいた。
 *   ただし落とすのは「その行の差し込みが**すべて空**のとき」だけ。
 *   値のあるものと同居している行を消すと、情報が黙って減る。
 */
export function fillTemplate(body: string, t: NoticeTarget): string {
  const values: Record<string, string> = {
    "{隊員名}": t.name,
    "{現場名}": t.siteName,
    "{開始}": t.startText,
    "{終了}": t.endText,
    "{班}": t.bandName ?? "",
    "{集合}": t.planComment ?? "",
  };
  const keys = Object.keys(values);

  return body
    .split("\n")
    .filter((line) => {
      const used = keys.filter((k) => line.includes(k));
      if (used.length === 0) return true; // 差し込みの無い行はそのまま
      return used.some((k) => values[k] !== "");
    })
    .map((line) => keys.reduce((acc, k) => acc.replaceAll(k, values[k]), line))
    .join("\n");
}

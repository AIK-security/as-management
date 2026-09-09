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
  /** 🔴 確定後に枠が変更された。当日変更の連絡はここで絞る */
  changedAfterConfirm: boolean;
  cancelled: boolean;
};

export type MessageTemplate = {
  id: string;
  name: string;
  kind: string;
  body: string;
};

/** 差し込みの解釈。DB は文字列を持つだけで、記法はここでだけ決める */
export function fillTemplate(body: string, t: NoticeTarget): string {
  return body
    .replaceAll("{隊員名}", t.name)
    .replaceAll("{現場名}", t.siteName)
    .replaceAll("{開始}", t.startText)
    .replaceAll("{終了}", t.endText)
    .replaceAll("{班}", t.bandName ?? "")
    .replaceAll("{集合}", t.planComment ?? "");
}

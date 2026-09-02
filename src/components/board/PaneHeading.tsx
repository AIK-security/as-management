// 右ペイン・下ペインのセクション見出し。帯にして区切りをはっきりさせる。
//
// 🔴 "use client" を付けない。中身は静的な markup だけなので、
//   サーバ側で使えばサーバ、クライアント側で使えばクライアントに寄る。
//   （page.tsx＝サーバ と BoardPanes.tsx＝クライアント の両方から使うため）

export function PaneHeading({
  title,
  sub,
  action,
}: {
  title: string;
  sub: string;
  /** 見出しの右端に置く操作（仕舞うボタンなど） */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 border-b-2 border-slate-300 bg-slate-100 px-3 py-1.5">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-800">{title}</h2>
      <span className="t-meta ml-auto text-slate-600">{sub}</span>
      {action}
    </div>
  );
}

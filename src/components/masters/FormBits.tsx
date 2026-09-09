// マスタ編集フォームの共通部品（2026-09-09）。
//
// 🔴 現場（S-10）・隊員（S-11）・得意先（S-12）の3画面で同じものを使う。
//   3か所に同じ Tailwind の文字列を書くと、片方だけ直したときに見た目が食い違い、
//   1名体制ではそれに気づけない（TwoDigitInput を共有したのと同じ理由）。
//
// ⚠️ 逆に「共通化しすぎない」線も引いておく：ここに置くのは**見た目だけ**。
//   保存の仕方・検査・削除の作法は画面ごとに違うので、各フォームに置いたままにする。
"use client";

/** 入力欄の共通クラス。高さは h-9（CLAUDE.md のデザイン規約） */
export const FIELD =
  "h-9 w-full rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-slate-500">
        {label}
        {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="mb-2 text-[13px] font-semibold tracking-tight text-slate-900">
        {title}
        {hint && <span className="ml-2 text-[11px] font-normal text-slate-400">{hint}</span>}
      </h2>
      {children}
    </section>
  );
}

/** 保存・エラーの表示帯。文言と色を3画面で揃える */
export function Notice({ kind, children }: { kind: "error" | "ok"; children: React.ReactNode }) {
  const cls =
    kind === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return <p className={`rounded-md border px-3 py-2 text-[13px] ${cls}`}>{children}</p>;
}

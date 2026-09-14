// NG を1件消すボタン（2026-09-08）。
//
// 🔴 window.confirm は使わない（2026-09-04 決定）。
//   代わりに**その場で確認帯に変わる**。押し間違いは1手で取り消せる。
"use client";

import { useState } from "react";
import { deleteNgEntry } from "@/app/masters/ng/actions";
import { callAction } from "@/lib/action-call";

export function NgDeleteButton({ id }: { id: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (error) {
    return <span className="t-meta text-rose-700">{error}</span>;
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="t-meta rounded border border-slate-300 px-1.5 py-0.5 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800"
      >
        削除
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const r = await callAction(() => deleteNgEntry({ id }));
          setPending(false);
          if (!r.ok) setError(r.message);
        }}
        className="t-meta rounded bg-rose-600 px-1.5 py-0.5 text-white transition-all duration-150 ease-in-out hover:bg-rose-700 disabled:opacity-50"
      >
        {pending ? "…" : "消す"}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="t-meta rounded border border-slate-300 px-1.5 py-0.5 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100"
      >
        やめる
      </button>
    </span>
  );
}

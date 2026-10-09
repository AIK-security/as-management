// 確認（第二の目・2026-10-09）。配置ボードのヘッダに置く。
//
// 🔴 確認担当（美土路さん）が、ボードで確定した配置を一度見て「確認しました」を残す。
//   単位は日付 × 管轄（日勤・夜勤の両方をまとめて1件）。
// 🔴 確認の後に配置が変わると DB が changed_at を入れる → 琥珀色で「確認後に変更あり」。
//   当日変更が常態なので、出るのは普通のこと。もう一度押せば付け直せる。
// 🔴 押したらすぐ記録せず、確認のダイアログを挟む（2026-10-09・柴山）。作法は一括確定（ConfirmAllButton）に揃える。
"use client";

import { useState, useTransition } from "react";
import { reviewBoard } from "@/app/board/actions";
import { callAction } from "@/lib/action-call";
import { HEADER_BTN } from "@/components/board/header-ui";
import { jstHm } from "@/lib/board-format";

type Review = { reviewedAt: string; reviewerName: string | null; changedAt: string | null };

/** 「10/9 10:32」。確認はその日のうちとは限らない（前日の夕方に翌日分を見る等）ので日付も出す */
function jstMdHm(iso: string): string {
  const md = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(
    new Date(iso),
  );
  return `${md} ${jstHm(iso)}`;
}

export function BoardReviewButton({
  workDate,
  dateLabel,
  jurisdictionId,
  review,
  editable,
}: {
  workDate: string;
  /** ダイアログに出す日付（2026/10/09（金） など） */
  dateLabel: string;
  jurisdictionId: string;
  review: Review | null;
  /** 管制・管理者だけが押せる（事務は見るだけ） */
  editable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  function handleReview() {
    setAsking(false);
    startTransition(async () => {
      const result = await callAction(() => reviewBoard({ workDate, jurisdictionId }));
      setError(result.ok ? null : result.message);
    });
  }

  // 🔴 表示とボタンを1つの札にまとめる（2026-10-09・柴山「独立して見える位置に」「表示がスマートでない」）。
  //   札そのものを押すと確認。確認済みで変更が無いときは押せない札にする（押す理由が無い）。
  const tone =
    review === null
      ? "border-slate-300 bg-white text-slate-700"
      : review.changedAt === null
        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
        : "border-amber-300 bg-amber-50 text-amber-900";
  const mark = review === null ? "○" : review.changedAt === null ? "✓" : "!";
  const status =
    review === null ? "未確認" : review.changedAt === null ? "確認済み" : "確認後に変更あり";
  const detail =
    review === null
      ? null
      : review.changedAt === null
        ? `${review.reviewerName ?? ""} ${jstMdHm(review.reviewedAt)}`.trim()
        : `${jstMdHm(review.changedAt)}〜`;
  const action = review === null ? "確認する" : review.changedAt === null ? null : "もう一度確認";
  const clickable = editable && action !== null && !pending;

  const body = (
    <>
      <span aria-hidden className="font-bold">
        {mark}
      </span>
      <span>{status}</span>
      {detail && <span className="t-meta font-normal opacity-80">{detail}</span>}
      {editable && action && (
        <span className="ml-1 border-l border-current/30 pl-2 text-indigo-700">{pending ? "記録中…" : action}</span>
      )}
    </>
  );

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {clickable ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          title="この日の配置（日勤・夜勤の両方）を確認したことを記録する"
          className={`${HEADER_BTN} flex items-center gap-1.5 ${tone} cursor-pointer hover:brightness-95`}
        >
          {body}
        </button>
      ) : (
        <span
          className={`${HEADER_BTN} flex items-center gap-1.5 ${tone}`}
          title={
            review && review.changedAt !== null
              ? `${review.reviewerName ?? ""} が ${jstMdHm(review.reviewedAt)} に確認した後、配置が変わりました`
              : undefined
          }
        >
          {body}
        </span>
      )}
      {error && <span className="t-meta text-rose-700">{error}</span>}

      {asking && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="board-review-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-8"
          onClick={() => setAsking(false)}
        >
          <div
            className="w-fit min-w-[520px] rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 文面は柴山の指定（2026-10-09）。見出しは赤で「配置の確認」＋日付 */}
            <h2
              id="board-review-title"
              className="flex items-baseline gap-2.5 text-[18px] font-semibold tracking-tight"
            >
              <span className="text-rose-700">配置の確認</span>
              <span className="text-slate-900 tabular-nums">{dateLabel}</span>
            </h2>
            <p className="mt-3 text-[15px] leading-snug text-slate-700">日勤・夜勤の配置を確認済みとして記録します。</p>
            <p className="mt-1.5 text-[13px] leading-snug whitespace-nowrap text-slate-500">
              確認したあとも配置は直せます。直すと「確認後に変更あり」に変わります。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="cursor-pointer rounded-md border-2 border-slate-300 bg-white px-3 py-1.5 text-[14px] font-semibold text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100"
              >
                やめる
              </button>
              <button
                type="button"
                onClick={handleReview}
                className="cursor-pointer rounded-md border-2 border-indigo-600 bg-indigo-600 px-3 py-1.5 text-[14px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-indigo-700"
              >
                確認済みにする
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

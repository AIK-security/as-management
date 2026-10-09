// 確認（第二の目・2026-10-09）。配置ボードのヘッダに置く。
//
// 🔴 確認担当（美土路さん）が、ボードで確定した配置を一度見て「確認しました」を残す。
//   単位は日付 × 管轄（日勤・夜勤の両方をまとめて1件）。
// 🔴 確認の後に配置が変わると DB が changed_at を入れる → 琥珀色で「確認後に変更あり」。
//   当日変更が常態なので、出るのは普通のこと。もう一度押せば付け直せる。
// 🔴 押すだけの操作で取り消しも要らない（付け直すだけ）ため、一括確定のような確認ダイアログは挟まない。
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

const CHIP = "flex shrink-0 items-baseline gap-1 rounded-md border px-2 py-1 text-[13px] whitespace-nowrap";

export function BoardReviewButton({
  workDate,
  jurisdictionId,
  review,
  editable,
}: {
  workDate: string;
  jurisdictionId: string;
  review: Review | null;
  /** 管制・管理者だけが押せる（事務は見るだけ） */
  editable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleReview() {
    startTransition(async () => {
      const result = await callAction(() => reviewBoard({ workDate, jurisdictionId }));
      setError(result.ok ? null : result.message);
    });
  }

  const button = (label: string) =>
    editable && (
      <button
        type="button"
        onClick={handleReview}
        disabled={pending}
        title="この日の配置（日勤・夜勤の両方）を確認したことを記録する"
        className={[
          HEADER_BTN,
          pending
            ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
            : "cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
        ].join(" ")}
      >
        {pending ? "記録中…" : label}
      </button>
    );

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {review === null ? (
        <>
          <span className={`${CHIP} border-slate-300 bg-white text-slate-500`}>未確認</span>
          {button("確認しました")}
        </>
      ) : review.changedAt === null ? (
        <span
          className={`${CHIP} border-emerald-300 bg-emerald-50 text-emerald-800`}
          title="この日の配置は、確認の後に変わっていません"
        >
          <span className="font-semibold">確認済み</span>
          <span className="t-meta text-emerald-700">
            {review.reviewerName ?? ""} {jstMdHm(review.reviewedAt)}
          </span>
        </span>
      ) : (
        <>
          <span
            className={`${CHIP} border-amber-300 bg-amber-50 text-amber-900`}
            title={`${review.reviewerName ?? ""} が ${jstMdHm(review.reviewedAt)} に確認した後、配置が変わりました`}
          >
            <span className="font-semibold">確認後に変更あり</span>
            <span className="t-meta text-amber-800">{jstMdHm(review.changedAt)}〜</span>
          </span>
          {button("もう一度確認")}
        </>
      )}
      {error && <span className="t-meta text-rose-700">{error}</span>}
    </div>
  );
}

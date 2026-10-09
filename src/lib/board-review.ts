// 確認（第二の目）の読み出し（2026-10-09）。
//
// 設計：docs/data-model.md §4-1b／DB：supabase/migrations/20261009000000_board_reviews.sql
// 単位は「日付 × 管轄」で1件。確認後に配置が変わると DB が changed_at を入れる。
import "server-only";
import { createClient } from "@/lib/supabase/server";

export type BoardReview = {
  reviewedAt: string;
  reviewerName: string | null;
  /** 確認の後に最初に配置が変わった時刻。null＝確認後に変更なし */
  changedAt: string | null;
};

/** その日その管轄の確認。まだ確認していなければ null */
export async function getBoardReview(workDate: string, jurisdictionId: string): Promise<BoardReview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_reviews")
    .select("reviewed_at, reviewer_name, changed_at")
    .eq("work_date", workDate)
    .eq("jurisdiction_id", jurisdictionId)
    .maybeSingle();
  if (error) throw new Error(`確認の記録の取得に失敗しました: ${error.message}`);
  if (!data) return null;
  return { reviewedAt: data.reviewed_at, reviewerName: data.reviewer_name, changedAt: data.changed_at };
}

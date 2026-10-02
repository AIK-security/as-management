// PostgREST の「1回 1,000行まで」を越えて、最後まで読む（2026-10-02）。
//
// 🔴 なぜ要るのか
//   Supabase（PostgREST）は既定で 1,000行までしか返さず、**超えてもエラーにならない**。
//   7月の実データ（配置 2,901件）を入れた日に、配置ボードの ★ が黙って欠けた。
//   ダミーの規模（配置 約140件）では一度も表に出なかった種類の壊れ方。
//   → 件数が育つ問い合わせは、ここを通して最後まで読む。
//
// 🔴 order を必ず付けること。順序が決まっていないと、ページの境目で行が重複・欠落する。
//   （取込の codeToId・guardsByStaffCode は 9/14 に同じ理由で範囲取得にしてある）

const PAGE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * `page(from, to)` を 1,000行ずつ呼び、足りなくなるまで続ける。
 * 返り値は supabase-js と同じ `{ data, error }` の形（呼び出し側の error 検査をそのまま使える）。
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => Page<T>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const data: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await page(from, from + PAGE - 1);
    if (error) return { data, error };
    data.push(...(rows ?? []));
    if ((rows?.length ?? 0) < PAGE) break;
  }
  return { data, error: null };
}

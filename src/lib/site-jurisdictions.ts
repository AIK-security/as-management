// 画面で切り替えに出す管轄を「現場を持つ管轄」に絞る（2026-10-02）。
//
// 🔴 なぜ絞るのか
//   9/24 に「有効な管轄が1つのあいだは切り替えを出さない」と決めた（s20-output-design.md §7）。
//   その「有効」を管轄の件数で数えていたため、社員マスター（250名）を入れると
//   管轄が4つ（東京・千葉・30・神奈川）になり、**現場が1件も無い管轄のタブ**が並ぶ。
//   7月実データの現場はすべて東京。タブを押しても空のボードが出るだけになる。
//   → 配置ボード・A表・一斉連絡は「現場を持つ管轄」だけを出す。
//
// 🔴 管轄そのものは消さない。隊員の所属・応援の可否（allow_cross_*）はこれまでどおり全管轄で効く。
//   ここで絞るのは**切り替えの選択肢と既定の管轄**だけ。
import "server-only";
import { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * 稼働中の現場を1件以上持つ管轄だけを残す（並び順は保つ）。
 * 1件も残らなければ（現場がまだ無い・取得に失敗）元の一覧をそのまま返す。
 */
export async function keepSiteJurisdictions<T extends { id: string }>(
  supabase: Supa,
  jurisdictions: T[],
): Promise<T[]> {
  if (jurisdictions.length <= 1) return jurisdictions;
  const { data, error } = await supabase
    .from("sites")
    .select("jurisdiction_id")
    .eq("status", "active");
  if (error) return jurisdictions;
  const used = new Set((data ?? []).map((r) => r.jurisdiction_id as string));
  const kept = jurisdictions.filter((j) => used.has(j.id));
  return kept.length > 0 ? kept : jurisdictions;
}

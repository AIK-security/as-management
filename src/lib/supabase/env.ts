// Supabase の接続情報を読む。未設定なら**何が足りないか**を日本語で言って落とす。
//
// 🔴 これが無いと supabase-js の "supabaseUrl is required" だけが出る。
//   セットアップ直後や 3か月後の自分がこれを見ても、
//   「.env.local を作っていない」だと気づくまでに時間を溶かす（設計原則3）。
const SETUP_HINT =
  ".env.local が未設定です。.env.example をコピーし、" +
  "Supabase ダッシュボード > Project Settings > API の値を入れてください。" +
  "（README.md「セットアップ」参照）";

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`環境変数が足りません: ${missing.join(", ")} / ${SETUP_HINT}`);
  }

  return { url: url!, anonKey: anonKey! };
}

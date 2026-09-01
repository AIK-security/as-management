-- =============================================================
-- RLS 監査クエリ（requirements.md §6 S-2 / 設計原則4「放置しない仕組み」）
--
-- 使い方：Supabase ダッシュボード > SQL Editor に貼って実行する。
-- 🔴 **テーブルを追加したら必ず走らせる。** 0行でなければ S-2 違反。
--
-- なぜ手動なのか：
--   ローカル Supabase（Docker）を使わない構成のため、CI から DB に繋ぐ経路が無い。
--   仕組みとして自動化するより、**1クエリで確実に分かる形**にして
--   段ごとの区切りで実行する運用にする（1名体制の現実解）。
-- =============================================================

-- ① RLS が無効なテーブル（あってはならない）
select
  c.relname                        as table_name,
  '🔴 RLS が無効'                  as problem
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity

union all

-- ② RLS は有効だがポリシーが1本も無いテーブル
--    （＝誰も読めない。安全側だが、たいていは付け忘れ）
select
  c.relname,
  '🟠 RLS 有効だがポリシーが無い'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
  )

order by 2, 1;

-- ③ 現在のポリシー一覧（目視確認用）
select tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

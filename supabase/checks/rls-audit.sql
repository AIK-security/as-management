-- =============================================================
-- RLS 監査クエリ（requirements.md §6 S-2 / 設計原則4「放置しない仕組み」）
--
-- 使い方：Supabase ダッシュボード > SQL Editor に貼って実行する。
-- 🔴 **テーブルを追加したら必ず走らせる。**
--    最後に出る「判定」が ✅ 1行でなければ S-2 違反。
--
-- 🔴 順番に意味がある。**SQL Editor は最後の文の結果しか表示しない。**
--    そのため「判定」を最後に置いてある。
--    ①のポリシー一覧を見たいときは、①だけを選択して実行する。
--
-- なぜ手動なのか：
--   ローカル Supabase（Docker）を使わない構成のため、CI から DB に繋ぐ経路が無い。
--   仕組みとして自動化するより、**1クエリで確実に分かる形**にして
--   段ごとの区切りで実行する運用にする（1名体制の現実解）。
-- =============================================================

-- ① 現在のポリシー一覧（目視確認用・ここだけ選択して実行する）
--
-- 期待値の数え方：profiles は 4本（select/insert/update/delete）、
-- それ以外の各テーブルは 2本（_select ＝ 閲覧 / _write ＝ 変更）。
select tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- ② 判定（🔴 これが最後。ここだけ見れば良い）
--
-- 問題が無ければ ✅ が1行だけ出る。
-- 🔴 「0行」を正常とすると、クエリを流し忘れたのか正常なのか区別できない。
--    正常であることを**明示的に1行で言わせる**。
with problems as (
  -- RLS が無効なテーブル（あってはならない）
  select
    c.relname       as table_name,
    '🔴 RLS が無効' as problem
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity

  union all

  -- RLS は有効だがポリシーが1本も無いテーブル
  -- （＝誰も読めない。安全側だが、たいていは付け忘れ）
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
),
-- 参考：テーブル数とポリシー数（数が合わないときの当たりを付けるため）
counts as (
  select
    (select count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r')                as tables,
    (select count(*) from pg_policies where schemaname = 'public')   as policies
)
select
  coalesce(p.table_name, '—')                       as table_name,
  coalesce(
    p.problem,
    '✅ 問題なし（RLS 未設定・ポリシー無しのテーブルは無い）'
  )                                                 as problem,
  'テーブル ' || c.tables || ' / ポリシー ' || c.policies as summary
from counts c
left join problems p on true
order by 1;

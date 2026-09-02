-- =============================================================
-- 認証土台の適用確認（supabase/migrations/ が正しく入ったか）
--   対象：20260901000000_auth_roles / 20260901120000_profiles_is_active
--
-- 使い方：Supabase ダッシュボード > SQL Editor に貼って実行する。
-- 🔴 **result 列がすべて ✅ になること。** 1つでも ❌ なら土台が入っていない。
--
-- いつ使うか：
--   ・新しい環境（本番・検証用）を作ったとき
--   ・「ログインできるのに画面に入れない」ときの切り分け
-- =============================================================

select 'profiles テーブル' as item,
       case when to_regclass('public.profiles') is not null
            then '✅ ある' else '❌ 無い' end as result

union all
select 'profiles の RLS',
       case when (select relrowsecurity from pg_class
                  where oid = to_regclass('public.profiles'))
            then '✅ 有効' else '❌ 無効' end

union all
select 'profiles のポリシー数（期待 4）',
       case when (select count(*) from pg_policies
                  where schemaname = 'public' and tablename = 'profiles') = 4
            then '✅ 4本' else '❌ ' ||
                 (select count(*)::text from pg_policies
                  where schemaname = 'public' and tablename = 'profiles') || '本' end

union all
select 'RLS ヘルパー関数（期待 4）',
       case when (select count(*) from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and p.proname in ('current_app_role','is_admin','can_edit','is_staff')) = 4
            then '✅ 4本' else '❌ 不足' end

union all
select 'ヘルパーが SECURITY DEFINER か',
       case when (select bool_and(p.prosecdef) from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and p.proname in ('current_app_role','is_admin','can_edit','is_staff'))
            then '✅ 全て definer' else '❌ 通常権限のものがある' end

union all
select '招待トリガー on_auth_user_created',
       case when exists (select 1 from pg_trigger
                         where tgname = 'on_auth_user_created' and not tgisinternal)
            then '✅ ある' else '❌ 無い' end

union all
select 'role の CHECK 制約',
       case when exists (
              select 1 from pg_constraint
              where conrelid = to_regclass('public.profiles')
                and contype = 'c'
                and pg_get_constraintdef(oid) like '%control%office%admin%')
            then '✅ ある' else '❌ 無い' end

-- ---- 20260901120000_profiles_is_active.sql ----

union all
select 'profiles.is_active 列',
       case when exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles'
                and column_name = 'is_active')
            then '✅ ある' else '❌ 無い（マイグレーション未適用）' end

union all
select 'current_app_role() が is_active を見ているか',
       case when (select p.prosrc from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'current_app_role')
                 like '%is_active%'
            then '✅ 見ている'
            else '❌ 旧定義のまま（無効化しても権限が残る）' end

union all
select '登録済みユーザー数（profiles）',
       '📊 ' || (select count(*)::text from public.profiles) || ' 件'

union all
-- 🔴 列名を直接書かない。列が無い環境では CASE では守れず、
--    クエリ全体が構文エラーになる（＝一番知りたい「未適用」で結果が出ない）。
select '  うち有効（is_active）',
       '📊 ' || (select count(*)::text from public.profiles p
                 where to_jsonb(p) ->> 'is_active' = 'true') || ' 件';

-- =============================================================
-- マイグレーションの適用確認（supabase/migrations/ が正しく入ったか）
--   対象：20260901000000_auth_roles / 20260901120000_profiles_is_active
--        20260902000000_board_core / 20260902120000_assignment_role_simplify
--        20260903000000_assignment_planned_times
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
                 where to_jsonb(p) ->> 'is_active' = 'true') || ' 件'

-- ---- 20260902000000_board_core.sql ----

union all
select '配置ボードのテーブル（期待 14）',
       case when (select count(*) from information_schema.tables
                  where table_schema = 'public'
                    and table_name in (
                      'jurisdictions','departments','companies','guards','guard_contacts',
                      'customers','sites','qualifications','guard_qualifications',
                      'site_required_qualifications','shifts','board_reviews',
                      'assignments','ng_entries')) = 14
            then '✅ 14本'
            else '❌ ' || (select count(*)::text from information_schema.tables
                           where table_schema = 'public'
                             and table_name in (
                               'jurisdictions','departments','companies','guards','guard_contacts',
                               'customers','sites','qualifications','guard_qualifications',
                               'site_required_qualifications','shifts','board_reviews',
                               'assignments','ng_entries')) || '本（未適用）' end

union all
-- 🔴 重複配置を止めている唯一の仕組み。これが無いと
--    同じ隊員を同じ時間帯の2枠に確定できてしまう
select '重複防止 assignments_no_overlap',
       case when exists (select 1 from pg_constraint
                         where conname = 'assignments_no_overlap')
            then '✅ ある' else '❌ 無い（重複配置を止められない）' end

-- ---- 20260902120000_assignment_role_simplify.sql ----

union all
select 'role が「隊長 / それ以外」の2値か',
       case when exists (
              select 1 from pg_constraint
              where conname = 'assignments_role_check'
                and pg_get_constraintdef(oid) not like '%sub%')
            then '✅ leader / member'
            else '❌ sub が残っている（未適用）' end

-- ---- 20260903000000_assignment_planned_times.sql ----

union all
-- 🔴 予定時刻が空の行は assignments_no_overlap の判定対象から外れる。
--    このトリガーが無いと、画面から入れた配置は重複チェックを素通りする
select '予定時刻の自動補完トリガー',
       case when exists (select 1 from pg_trigger
                         where tgname = 'assignments_fill_planned_times_trg'
                           and not tgisinternal)
            then '✅ ある' else '❌ 無い（画面から入れた配置が重複判定を素通りする）' end

union all
select '枠の時刻変更を配置へ写すトリガー',
       case when exists (select 1 from pg_trigger
                         where tgname = 'shifts_refill_assignment_times_trg'
                           and not tgisinternal)
            then '✅ ある' else '❌ 無い' end

union all
-- 🔴 seed 実行後に確認する。0 件でなければ、その行は重複判定の対象外になっている
select '予定時刻が空の現場配置（当日以降）',
       case when (select count(*) from public.assignments
                  where kind = 'site' and planned_start_at is null
                    and work_date >= current_date) = 0
            then '✅ 0 件'
            else '⚠️ ' || (select count(*)::text from public.assignments
                            where kind = 'site' and planned_start_at is null
                              and work_date >= current_date) || ' 件（重複判定の対象外）' end;

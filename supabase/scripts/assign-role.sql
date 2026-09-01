-- =============================================================
-- ユーザーにロールを割り当てる（＝profiles を作る / 変える）
--
-- 🔴 なぜ手作業の SQL なのか
--   Supabase ダッシュボードの「Create new user」には
--   **User Metadata の入力欄が無い**（Email / Password / Auto confirm のみ）。
--   メタデータを渡せるのは Admin API 経由の作成時だけで、
--   招待トリガー（handle_new_user）はそのときにしか発火しない。
--   → 実運用では「ダッシュボードで作る → このSQLでロールを付ける」の2手になる。
--
-- 使い方
--   1. Authentication > Users > Add user > Create new user
--      （Auto confirm user? に ✅ を入れる）
--   2. 下の【ここを書き換える】を直して SQL Editor で実行する
--
-- 🔴 このファイルに実アカウントのメールを書いたままコミットしない。
--    実行のたびに書き換えて使い、リポジトリには例のまま残す（requirements.md §6 S-3）。
-- =============================================================

-- 【ここを書き換える】--------------------------------------------
--   role は 'admin'（管理者）/ 'control'（管制）/ 'office'（事務）のいずれか。
--   それ以外を入れると CHECK 制約で弾かれる（＝打ち間違いが通らない）。
with target as (
  select
    'user@example.com'::text as email,        -- ← 作成したユーザーのメールアドレス
    'admin'::text            as role,         -- ← 付けたいロール
    '氏名'::text             as display_name  -- ← 画面ヘッダに出る名前
)
-- ----------------------------------------------------------------
insert into public.profiles (id, role, display_name)
select u.id, t.role, t.display_name
from auth.users u
join target t on u.email = t.email
on conflict (id) do update
  set role         = excluded.role,
      display_name = excluded.display_name;

-- 結果の確認（ロールが付いたユーザーの一覧）
select u.email, p.role, p.display_name, p.created_at
from public.profiles p
join auth.users u on u.id = p.id
order by p.created_at;

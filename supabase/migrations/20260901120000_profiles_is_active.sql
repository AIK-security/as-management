-- =============================================================
-- profiles に is_active を追加（2026-09-01）
--
-- 🔴 なぜ「削除」ではなく「無効化」なのか
--   profiles.id は auth.users への FK が on delete cascade。
--   退職者を Supabase 側で削除すると profiles ごと消え、
--   **監査ログから「誰がやったか」が辿れなくなる**（requirements.md §3 決定6）。
--
-- 🔴 前のマイグレーション（20260901000000）は実 DB へ適用済みのため書き換えない。
--   適用済みのファイルを直すと、環境ごとに中身が食い違う。
-- =============================================================

alter table public.profiles
  add column is_active boolean not null default true;

comment on column public.profiles.is_active is
  '退職・異動で止める場合は false。行は消さない（監査ログの追跡のため）。';

-- -------------------------------------------------------------
-- 🔴 無効なユーザーは「ロールが無い」ものとして扱う。
--
-- current_app_role() だけを直せば、これを使う is_admin() / can_edit() /
-- is_staff() がすべて false になる。**1か所で止まる**形にしておく
--  （止め忘れる場所を作らない）。
-- -------------------------------------------------------------
create or replace function public.current_app_role()
  returns text
  language sql
  security definer
  stable
  set search_path = public
as $$
  select role from public.profiles
  where id = auth.uid() and is_active;
$$;

-- profiles の SELECT ポリシーは変更しない。
-- 無効なユーザーも**自分の行だけは読める**必要がある
-- （/no-access で「無効になっています」と理由を出すため。
--   黙って弾くと、本人は何度もログインし直したうえで「壊れている」と受け取る）。

-- =============================================================
-- 認証・ロール・RLS の土台（2026-09-01）
--
-- 要件：docs/requirements.md §3（利用者と権限＝4ロール）／§6 S-2（RLS 全テーブル有効化）
--
-- 🔴 なぜ最初に入れるのか
--   テーブルが14個に育ってから RLS を有効化すると既存クエリが軒並み壊れる。
--   1名体制では取れないリスクのため、**段2（D&D）より前**に土台だけ通す。
--   （requirements.md §3 設計上の決定 #1）
--
-- 🔴 警備番頭からの流用だが、**マルチテナント（organizations / org_id）は落としている**。
--   このシステムを使うのは AS のみで、協力会社はログインしないため
--   （CLAUDE.md「委託先用画面は作らない」・2026-08-28 決定）。
--   org_id を持たない分、RLS の条件は「本人か / 管理者か / 編集権があるか」だけになる。
-- =============================================================

-- -------------------------------------------------------------
-- テーブル: profiles（auth.users と 1対1。ロールを保持）
--
-- ロールは text + CHECK にする（enum にしない）。
-- 理由：警備番頭と同じ書き方に揃えるため。第3弾で 'guard' を足すときも
--       このマイグレーションを読めば追加箇所が1つだと分かる（設計原則3）。
-- -------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  -- control=管制（配置の作成・確定・当日変更） / office=事務（閲覧＋出力のみ）
  -- admin=管理者（全機能＋ユーザー管理＋監査ログ）
  -- 🔴 guard=隊員 は第1弾では作らない（第3弾）。足すときはこの CHECK に1語追加する。
  role         text not null check (role in ('control', 'office', 'admin')),
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'ログインユーザーのロール。auth.users と 1対1。招待制（自由サインアップなし）。';

-- -------------------------------------------------------------
-- RLS ヘルパー関数
--
-- 🔴 SECURITY DEFINER にする理由：
--   profiles の RLS ポリシーの中で profiles を参照すると**無限再帰**になる。
--   SECURITY DEFINER 関数は RLS をバイパスするため、この再帰を断ち切れる。
--   （警備番頭で踏んだ問題。同じ形で回避する）
-- 🔴 search_path を固定する理由：
--   SECURITY DEFINER は定義者権限で動くため、search_path を汚染されると
--   意図しない関数・テーブルを掴まされる。関数定義時に固定しておく。
-- -------------------------------------------------------------

-- ログインユーザー自身のロールを返す（profile 未割当なら null）
-- 🔴 関数名を current_role にしない。PostgreSQL の予約語（current_user と同義）と衝突する。
create or replace function public.current_app_role()
  returns text
  language sql
  security definer
  stable
  set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- 管理者か
create or replace function public.is_admin()
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select public.current_app_role() = 'admin';
$$;

-- 配置データを**編集**してよいか（管制 or 管理者）
-- 🔴 事務は含めない。事務は「閲覧＋出力のみ」から始める（requirements.md §3 決定 #2）。
--    事務が何を見たいかは未確認（hearing-jimu.md）。器だけ作り、中身は判明してから足す。
create or replace function public.can_edit()
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select public.current_app_role() in ('control', 'admin');
$$;

-- AS の職員として登録済みか（＝profile がある）。閲覧可否の既定条件に使う。
create or replace function public.is_staff()
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select public.current_app_role() in ('control', 'office', 'admin');
$$;

-- -------------------------------------------------------------
-- updated_at の自動更新
-- -------------------------------------------------------------
create or replace function public.touch_updated_at()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row
  execute function public.touch_updated_at();

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.profiles enable row level security;

-- SELECT: 本人 / 管理者は全件
-- （管制が事務のロールを知る必要はないため、同僚の行は見せない）
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- 変更系: 管理者のみ。
-- 招待制のため通常はダッシュボード（service_role）から作られ、RLS を通らない。
-- ここは「アプリ側からユーザー管理画面を作ったとき」に効く。
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (public.is_admin());

create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- -------------------------------------------------------------
-- 招待トリガー（auth.users -> profiles 自動生成）
--
-- 招待制：ユーザー作成時の user_metadata に role があれば profile を作る。
-- 無ければ profile を作らない＝ログインはできてもどの画面にも入れない。
-- 🔴 role が CHECK 制約に反すればトリガーが失敗し、ユーザー作成ごと
--    ロールバックされる（不正ロールの混入を防ぐ）。
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.raw_user_meta_data ? 'role' then
    insert into public.profiles (id, role, display_name)
    values (
      new.id,
      new.raw_user_meta_data ->> 'role',
      new.raw_user_meta_data ->> 'display_name'
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- =============================================================
-- 初期管理者の作り方（このファイルには書かない）
--
-- Supabase ダッシュボード > Authentication > Users > Add user で
--   Email / Password を入れ、User Metadata に次を入れる：
--     { "role": "admin", "display_name": "柴山" }
--   → 上のトリガーが profiles を自動生成する。
--
-- 🔴 実アカウント・パスワードをこのリポジトリに書かない（S-3）。
-- =============================================================

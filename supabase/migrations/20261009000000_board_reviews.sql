-- =============================================================
-- 確認（チェック済みの記録）＝ 第二の目（2026-10-09）
--
-- 🔴 なぜ要るか
--   確認担当（美土路さん）の回答（10/9・hearing-jimu.md「確認・Slack 版」）：
--   「確定した配置がそのまま反映されるのであればよいですね。１回は確認して記録に残しておいた方が安心」。
--   確認の基準は A表ではなくホワイトボード（A表には書き漏らし・余分な書き込みがある）。
--   新システムの配置ボードは WB の代わりなので、**ボードで確定したものを確認する**。
--   設計は data-model.md §4-1b／要件は requirements.md §3「確認の位置づけ」・§4-3。
--
-- 🔴 単位は「日付 × 管轄」で1件（べんり君の入力単位・引き渡し単位と同じ）。
--   1枠ずつにしないのは、確認は**その日をまとめて見る**作業だから（data-model.md §4-1b）。
--
-- 🔴 確認の後に配置が変わったら、DB が changed_at を入れる（トリガー）。
--   画面は「確認後に変更あり」と出す。更新時刻の比較にしないのは、**削除が残らない**から。
--
-- 🔴 確認した人の名前（reviewer_name）は、確認した時点の表示名を写して持つ。
--   profiles は本人と管理者しか読めない（auth_roles）ため、管制から確認者の名前を引けない。
--   正は reviewed_by（RLS で本人しか入れられない）。名前は表示のためのスナップショット（s20 §6-1 原則3）。
-- =============================================================

-- 🔴 テーブル自体は 9/2 に作ってある（20260902000000_board_core.sql §4-1b・中身は空のまま未使用）。
--   ここでは列を2本足すだけ。id・note・updated_at・unique(work_date, jurisdiction_id) は既存のものを使う。
--   （10/9 に create table で書いて開発用 DB で「changed_at が無い」と落ちた。既存を確かめずに書いたため）
alter table public.board_reviews
  add column if not exists reviewer_name text,
  -- 確認の後に、その日その管轄の枠・配置が最初に変わった時刻。null＝確認後に変更なし
  add column if not exists changed_at timestamptz;

comment on table public.board_reviews is
  '確認（第二の目）。日付×管轄で1件。確認後に配置が変わると changed_at が入る（2026-10-09・トリガー）。updated_at の比較はやめた（削除が残らないため）';

-- -------------------------------------------------------------
-- 確認後の変更を記録する
--   🔴 security definer：枠を動かすのは管制。確認の行を書き換える権限の有無に左右させない
--   🔴 すでに changed_at があれば触らない（最初に変わった時刻を残す）
-- -------------------------------------------------------------
create or replace function public.mark_board_changed(p_date date, p_jurisdiction uuid)
  returns void
  language sql
  security definer
  set search_path = public
as $$
  update public.board_reviews
     set changed_at = now()
   where work_date = p_date
     and jurisdiction_id = p_jurisdiction
     and changed_at is null;
$$;

create or replace function public.shifts_mark_board_changed()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.mark_board_changed(old.work_date, old.jurisdiction_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.mark_board_changed(new.work_date, new.jurisdiction_id);
  end if;
  return null;
end;
$$;

create or replace function public.assignments_mark_board_changed()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  s record;
begin
  -- 現場の配置だけを見る（休み・貸出は配置ボードの確認の対象外）
  if tg_op in ('UPDATE', 'DELETE') and old.kind = 'site' and old.shift_id is not null then
    select work_date, jurisdiction_id into s from public.shifts where id = old.shift_id;
    -- 枠ごと消えたときは shifts 側のトリガーが記録している
    if found then perform public.mark_board_changed(s.work_date, s.jurisdiction_id); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.kind = 'site' and new.shift_id is not null then
    select work_date, jurisdiction_id into s from public.shifts where id = new.shift_id;
    if found then perform public.mark_board_changed(s.work_date, s.jurisdiction_id); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists shifts_mark_board_changed on public.shifts;
create trigger shifts_mark_board_changed
  after insert or update or delete on public.shifts
  for each row execute function public.shifts_mark_board_changed();

drop trigger if exists assignments_mark_board_changed on public.assignments;
create trigger assignments_mark_board_changed
  after insert or update or delete on public.assignments
  for each row execute function public.assignments_mark_board_changed();

-- -------------------------------------------------------------
-- RLS（9/2 に作ったポリシーを、自分の名前でしか入れられない形に置き換える）
--   閲覧：職員全員（事務も「確認済みか」は見られる）
--   確認：管制・管理者（確認担当は control ─ requirements.md §3）。**自分の名前でしか入れられない**
--   🔴 関数は (select …) で包む（20261005000000_rls_initplan.sql）
-- -------------------------------------------------------------
alter table public.board_reviews enable row level security;

drop policy if exists board_reviews_select on public.board_reviews;
create policy board_reviews_select on public.board_reviews
  for select to authenticated
  using ((select public.is_staff()));

drop policy if exists board_reviews_write on public.board_reviews;
create policy board_reviews_write on public.board_reviews
  for all to authenticated
  using ((select public.can_edit()))
  with check ((select public.can_edit()) and reviewed_by = (select auth.uid()));

-- 確認用（2 が出ればトリガーが2本ある）
select count(*) as board_review_triggers
  from pg_trigger
 where tgname in ('shifts_mark_board_changed', 'assignments_mark_board_changed');

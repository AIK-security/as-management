-- =============================================================
-- 確定後に配置が変わったら、その枠を「仮組み」に戻す（2026-09-03）
--
-- 🔴 何を変えたのか
--   これまでは `shifts.changed_after_confirm` を立て、画面に
--   「要 再引き渡し」バッジを出していた。**これをやめて列ごと捨てる。**
--
-- 🔴 なぜやめるのか（柴山の指摘・2026-09-03）
--   ・**まだ一度も引き渡していないのに「再度渡せ」と言っていた。**
--     引き渡し（べんり君への投入）は段3でこれから作るもので、
--     読んだ人が意味を取れない表示になっていた
--   ・状態を表す語が「仮組み / 確定 / 要 再引き渡し」と3つに増えていた。
--     実際に言いたいのは「確定したのに、その後で変わった」＝
--     **もう一度確定し直す必要がある**、ということでしかない
--   → **仮組みに戻せば足りる。** 覚える語が1つ減り、
--     左帯の橙とバッジで既に見えているものに合流する。
--
-- 🔴 引き渡しとの関係（段3の設計を狭めないか）
--   狭めない。段3 では「確定済みで、まだ渡していないもの」を渡す。
--   確定 → 変更 → 仮組み → 再確定 の流れなら、
--   再確定の時点で「未引き渡し」として自然に拾える。
--   引き渡し済みかどうかは、そのとき作る**引き渡し履歴**が持つべき情報であり、
--   shifts に立てるフラグで代用するものではなかった。
-- =============================================================

drop trigger if exists assignments_mark_shift_changed_ins_del on public.assignments;
drop trigger if exists assignments_mark_shift_changed_upd    on public.assignments;
drop function if exists public.mark_shift_changed_after_confirm();

create or replace function public.revert_shift_to_draft_on_change()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  targets uuid[];
begin
  -- 🔴 DELETE では NEW が未割当。PL/pgSQL は NEW.列 を触った時点でエラーになる
  --   （coalesce(new.x, old.x) と書いても評価前に落ちる）。TG_OP で分ける。
  -- 🔴 プレートを別の枠へ動かすと shift_id が変わる。**動かした先と元の両方**を
  --   戻す。人が減ったほうを「確定のまま」にすると、欠員に気づけない。
  if tg_op = 'DELETE' then
    targets := array[old.shift_id];
  elsif tg_op = 'INSERT' then
    targets := array[new.shift_id];
  else
    targets := array[old.shift_id, new.shift_id];
  end if;

  update public.shifts
     set status = 'draft',
         confirmed_at = null,
         confirmed_by = null
   where id = any (targets)
     and status = 'confirmed';

  return null;
end;
$$;

create trigger assignments_revert_shift_to_draft_ins_del
  after insert or delete on public.assignments
  for each row
  execute function public.revert_shift_to_draft_on_change();

-- 🔴 列を絞る理由：上の update は shifts_sync_assignment_confirmed を発火させ、
--   それが assignments.is_confirmed を書き換える。
--   is_confirmed を対象列に含めると、**確定を解いた瞬間にまた解こうとする**
--   （確定 → is_confirmed を写す → その UPDATE を変更とみなす、の自己ループ）。
--   `update of <列>` は「その列が UPDATE 文に現れたとき」だけ発火する。
create trigger assignments_revert_shift_to_draft_upd
  after update of
    guard_id, shift_id, work_date, kind,
    planned_start_at, planned_end_at, planned_break_min,
    role, is_long_distance, position, status,
    lent_to_company_id, external_site_name, external_case_no, off_kind, note
  on public.assignments
  for each row
  execute function public.revert_shift_to_draft_on_change();

comment on function public.revert_shift_to_draft_on_change() is
  '確定済みの枠の配置が変わったら仮組みへ戻す。'
  '🔴 当日変更は通常業務（8/27）なので編集は禁じない。'
  '「確定し直す必要がある」ことを、状態そのもので表す。';

-- -------------------------------------------------------------
-- 🔴 列を捨てる。
--   「埋める予定が無い列」を残すと、後から読む人が
--   「使っていないのか、入れ忘れなのか」で必ず止まる
--   （2026-09-02 §8-2 で単価・金額に対して下したのと同じ判断）。
--   必要になったら引き渡し履歴のテーブルとして作り直す。
-- -------------------------------------------------------------
alter table public.shifts drop column if exists changed_after_confirm;

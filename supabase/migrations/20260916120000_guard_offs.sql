-- 休みの管理（2026-09-16・9/16 MTG の決定②）
--
-- 🔴 新しいテーブルは作らない。
--   休みは `assignments.kind = 'off'` として**すでに器がある**（board_core.sql §4-2）。
--   同じ「その隊員のその日の予定」であり、別の表に分けると
--   「配置に入っているのに休み」が両方の表に立てられてしまう。
--
-- ここで足すのは2つだけ：
--   ① off_kind に 'day_off'（公休＝終日の休み）を足す
--   ② off_work_kind（**どの区分を休むか**）を足す
--
-- 🔴 ① の理由：既存の10種に「ただの休み」が無かった。
--   近いのは absent_self（自己都合欠勤）だが、**欠勤ではない**。
--   AS の隊員は固定給ではなく、有給以外の休みは欠勤ではなく
--   **勤務日数が減るだけ**（9/16 MTG）。欠勤として記録すると給与計算で意味が変わる。
--
-- 🔴 ② の理由：「一部勤務可」を表すため。
--   「日勤なら出られる」「A夜勤なら出られる」という休み方が実在する。
--   *出られるほう*ではなく **休むほう**を持つ ── 行が無い区分は出られる、で読めるため。
--   null = 終日休み。

-- -------------------------------------------------------------
-- ① off_kind に 'day_off' を足す
--
-- 🔴 制約名を決め打ちしない。インラインの check は自動命名で、
--   名前を推測して外すと「0件で成功した」ように見えて実際は何も外れていない。
-- -------------------------------------------------------------
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.assignments'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%off_kind%'
     and pg_get_constraintdef(oid) like '%paid_leave%';
  if c is not null then
    execute format('alter table public.assignments drop constraint %I', c);
  end if;
end $$;

alter table public.assignments
  add constraint assignments_off_kind_check check (off_kind in (
    'paid_leave', 'day_off', 'training', 'medical', 'absent_self',
    'absent_company', 'night_duty', 'substitute_holiday',
    'control', 'office', 'standby'));

comment on column public.assignments.off_kind is
  '非現場の区分。day_off=公休（2026-09-16 追加）。'
  '🔴 有給以外の休みは欠勤ではない ── 隊員は固定給ではなく勤務日数が減るだけ。';

-- -------------------------------------------------------------
-- ② off_work_kind（休む区分）
-- -------------------------------------------------------------
alter table public.assignments
  add column if not exists off_work_kind text
    check (off_work_kind in ('day', 'nightA', 'nightB'));

comment on column public.assignments.off_work_kind is
  '🔴 どの区分を休むか（2026-09-16）。null=終日。'
  'day/nightA/nightB は shifts.work_kind と同じ語。'
  '「出られる区分」ではなく「休む区分」を持つ ── 行の無い区分は出られる、と読めるため。';

-- 🔴 休み以外の行がこの列を持つと意味が無い。配置や貸出に紛れ込むのを止める
alter table public.assignments
  add constraint assignments_off_work_kind_only_off check (
    off_work_kind is null or kind = 'off'
  );

-- -------------------------------------------------------------
-- ③ 同じ隊員・同じ日・同じ区分の休みを二重に作らせない
--
-- 🔴 `nulls not distinct` が要る。既定では null 同士は「別物」と見なされ、
--   終日休み（off_work_kind = null）を何行でも作れてしまう。
-- 🔴 取り消した休み（status='canceled'）は数えない。
-- -------------------------------------------------------------
create unique index if not exists assignments_off_once_per_kind
  on public.assignments (guard_id, work_date, off_work_kind)
  nulls not distinct
  where (kind = 'off' and status = 'planned');

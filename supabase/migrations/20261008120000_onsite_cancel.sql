-- =============================================================
-- 現着中止を「人ごと」に持つ（2026-10-08）
--
-- 🔴 なぜ要るか（管制・美土路さん経由・2026-10-08）
--   「5名で手配したのが4名になり、1名現着中止」のように、**一部の隊員だけ**現着中止になることがある。
--   これまで現着中止は枠の区分（work_kind = dayCancel / nightCancel ＝「現中」）でしか表せず、
--   1人だけを現中にするには、同じ現場の現中の枠を別に立てて移すしかなかった。
--
-- 🔴 枠を分けず、**名札に印を付ける**形にした（柴山・2026-10-08）。
--   カードが増えると配置ボードが見づらくなるため（見やすさを優先）。
--   ・中の人も**配置人数に数える**（手配して現地まで行っている）
--   ・18列CSV では、その人の行だけ区分を「日勤現中／夜勤現中」にして出す（handoff.ts）
--   ・枠ごと全員が現着中止なら、今までどおり枠の区分を「現中」にしてもよい
--   ・取込済みの7〜9月は「現中の枠」のまま（2通りが混ざるのは集計側で吸収する）
--
-- 🔴 前日・当日朝の中止（shifts.cancelled_at）とは別物。あちらはべんり君から消すもの＝CSV に出さない。
-- =============================================================

alter table public.assignments
  add column if not exists onsite_cancelled boolean not null default false;

comment on column public.assignments.onsite_cancelled is
  '現着中止（現地に着いてから中止）。true=この人だけ現中。配置人数には数える。'
  '18列CSV では区分を日勤現中／夜勤現中にして出す（2026-10-08）';

-- ── 確定後に現着中止を付け外ししたら仮組みへ戻す（隊長・職種と同じ扱い）──
drop trigger if exists assignments_revert_shift_to_draft_upd on public.assignments;
create trigger assignments_revert_shift_to_draft_upd
  after update of
    guard_id, shift_id, work_date, kind,
    planned_start_at, planned_end_at, planned_break_min,
    role, job_type, onsite_cancelled, is_long_distance, position, status,
    lent_to_company_id, external_site_name, external_case_no, off_kind, note
  on public.assignments
  for each row
  execute function public.revert_shift_to_draft_on_change();

-- 確認用（1 が出れば列ができている）
select count(*) as onsite_cancelled_column
  from information_schema.columns
 where table_schema = 'public' and table_name = 'assignments' and column_name = 'onsite_cancelled';

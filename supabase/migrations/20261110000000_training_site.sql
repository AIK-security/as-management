-- =============================================================
-- 研修に「どの現場で・何時から何時まで」を持たせる（2026-11-10）
--
-- 🔴 なぜ要るか（確認担当・美土路さん・2026-11-10 Slack）
--   研修はべんり君で「得意先 And Security × 勤務 教育」の1行として入れ、
--   **勤務名に研修をした現場名・時刻はその現場の上下番時刻**を書いている
--   （芦花公園なら 8:00〜17:00、人形町なら 8:30〜17:30）。
--   ShiftMax は勤怠・給与の道具なので、時刻が無い行は渡せない。
--   これまで研修は assignments の休みの行（kind='off'・off_kind='training'）で、
--   現場も時刻も持っていなかった → 18列CSV に研修を出せなかった。
--
-- 🔴 planned_start_at / planned_end_at を使い回さない。
--   あちらは枠から DB が写す列で、重なりの判定（assignments_no_overlap）にも使っている。
--   研修の時刻をそこへ入れると、配置の判定に研修が混ざる。研修だけの列を別に持つ。
--
-- 🔴 現場は「研修をした場所」の記録であって配置ではない。
--   枠の必要人数・請求には数えない（A表の「37+1」の「+1」）。
-- =============================================================

alter table public.assignments
  add column if not exists duty_site_id   uuid references public.sites (id),
  add column if not exists duty_start_h   smallint check (duty_start_h between 0 and 29),
  add column if not exists duty_start_m   smallint check (duty_start_m between 0 and 59),
  add column if not exists duty_end_h     smallint check (duty_end_h between 0 and 29),
  add column if not exists duty_end_m     smallint check (duty_end_m between 0 and 59),
  add column if not exists duty_break_min smallint check (duty_break_min >= 0);

comment on column public.assignments.duty_site_id is
  '研修をした現場（2026-11-10）。off_kind=training の行だけが持つ。配置ではない＝人数・請求に数えない。'
  '18列CSV の勤務名（4列目）に現場名を出す';
comment on column public.assignments.duty_start_h is
  '研修の開始（時）。その現場の上下番時刻に従う（2026-11-10・確認担当）';

-- 🔴 研修の行以外はこれらの列を持たない（配置・休みに紛れ込ませない）
alter table public.assignments
  drop constraint if exists assignments_duty_site_only_training;
alter table public.assignments
  add constraint assignments_duty_site_only_training check (
    (duty_site_id is null
      and duty_start_h is null and duty_start_m is null
      and duty_end_h is null and duty_end_m is null
      and duty_break_min is null)
    or (kind = 'off' and off_kind = 'training')
  );

-- 🔴 現場と時刻は揃って入るか、揃って空か。片方だけの行を作らせない
alter table public.assignments
  drop constraint if exists assignments_duty_site_complete;
alter table public.assignments
  add constraint assignments_duty_site_complete check (
    (duty_site_id is null
      and duty_start_h is null and duty_start_m is null
      and duty_end_h is null and duty_end_m is null
      and duty_break_min is null)
    or (duty_site_id is not null
      and duty_start_h is not null and duty_start_m is not null
      and duty_end_h is not null and duty_end_m is not null
      and duty_break_min is not null)
  );

-- 確認用（6 が出れば列ができている）
select count(*) as duty_site_columns
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'assignments'
   and column_name in ('duty_site_id', 'duty_start_h', 'duty_start_m',
                       'duty_end_h', 'duty_end_m', 'duty_break_min');

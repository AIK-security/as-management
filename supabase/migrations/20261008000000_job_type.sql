-- =============================================================
-- 職種（検定・列車見張・ドライバー）を配置と枠に持たせる（2026-10-08）
--
-- 🔴 なぜ要るか（管制・2026-10-08）
--   A表の人数欄に `K1R1`（K＝検定・R＝列車・D＝ドライバー）と書いている。
--   この数は**必要人数の内数**（「5名 K1R1」＝5名のうち検定1・列車1）。
--   そして**その枠の誰が検定・列車なのかを決める必要がある** ─ 手当の支給に使うため。
--   ドライバーも警備をする（＝必要人数に入る）。
--   → `s20-output-design.md` §5 #1 の `job_type` を前倒しで作る。
--
-- 🔴 持ち方
--   ・人  … assignments.job_type。**空＝交通誘導**（大半がこれ。例外だけ付ける＝管制の手数を増やさない）
--   ・枠  … shifts.kentei_count / train_count / driver_count。A表の `K1R1` そのもの。
--           必要人数の内数なので、合計が headcount を超えたら DB が拒む。
--   ・7〜9月の取込済み分は空のまま（A表の写真は2週分しかなく、さかのぼれない・柴山）。
--
-- 🔴 資格の区分に 'kentei' を足す。「検定を付けたのに検定の資格が無い」を名札で知らせるため。
--   止めはしない（資格の登録漏れがありうる）。
--   既存の交1・交2（code = q-k1 / q-k2）に区分を付ける。コードが違えば0件更新で済み、
--   そのときは画面側が「検定の区分を持つ資格が1つも無い＝判定しない」に倒れる。
-- =============================================================

-- ── 人：その配置で何の役か ────────────────────────────────
alter table public.assignments
  add column if not exists job_type text
  check (job_type in ('kentei', 'train', 'driver'));

comment on column public.assignments.job_type is
  '予定の職種。null=交通誘導 / kentei=検定 / train=列車見張 / driver=ドライバー（2026-10-08）。'
  '手当の支給に使う。実績で変わったら assignment_actuals（S-20）側に持つ予定。';

-- ── 枠：A表の `K1R1` ──────────────────────────────────────
alter table public.shifts
  add column if not exists kentei_count smallint not null default 0 check (kentei_count >= 0),
  add column if not exists train_count  smallint not null default 0 check (train_count  >= 0),
  add column if not exists driver_count smallint not null default 0 check (driver_count >= 0);

alter table public.shifts
  drop constraint if exists shifts_job_counts_within_headcount;
alter table public.shifts
  add constraint shifts_job_counts_within_headcount
  check (kentei_count + train_count + driver_count <= headcount);

comment on column public.shifts.kentei_count is '必要人数のうち検定の人数（A表の K）。2026-10-08';
comment on column public.shifts.train_count  is '必要人数のうち列車見張の人数（A表の R）。2026-10-08';
comment on column public.shifts.driver_count is '必要人数のうちドライバーの人数（A表の D）。2026-10-08';

-- ── 確定後に職種を変えたら仮組みへ戻す ─────────────────────
-- 🔴 隊長（role）を変えたときと同じ扱いにする。職種は手当に効く＝確定した中身の一部。
--   列の一覧を書き直すため、トリガーを作り直す（関数は 20260903120000 のまま）。
drop trigger if exists assignments_revert_shift_to_draft_upd on public.assignments;
create trigger assignments_revert_shift_to_draft_upd
  after update of
    guard_id, shift_id, work_date, kind,
    planned_start_at, planned_end_at, planned_break_min,
    role, job_type, is_long_distance, position, status,
    lent_to_company_id, external_site_name, external_case_no, off_kind, note
  on public.assignments
  for each row
  execute function public.revert_shift_to_draft_on_change();

-- ── 資格の区分に「検定」を足す ────────────────────────────
alter table public.qualifications
  drop constraint if exists qualifications_category_check;
alter table public.qualifications
  add constraint qualifications_category_check
  check (category in ('train', 'kentei'));

comment on column public.qualifications.category is
  'train=列車見張（鉄道会社ごと）。名札では現場が必要とするものだけ出し、プールでは「列N」に畳む。'
  'kentei=交通誘導の検定（2026-10-08）。職種「検定」を付けた人が持っているかの判定に使う。'
  'null=今までどおり全部出す。';

update public.qualifications set category = 'kentei'
 where code in ('q-k1', 'q-k2') and category is null;

-- 確認用（職種の列が3本＋1本、検定の区分を持つ資格の件数）
select 'assignments.job_type' as item,
       count(*)::text as result
  from information_schema.columns
 where table_schema = 'public' and table_name = 'assignments' and column_name = 'job_type'
union all
select 'shifts の職種の人数（期待 3）', count(*)::text
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shifts'
   and column_name in ('kentei_count', 'train_count', 'driver_count')
union all
select '検定の区分を持つ資格', string_agg(short_label, '・')
  from public.qualifications where category = 'kentei';

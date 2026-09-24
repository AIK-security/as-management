-- =============================================================
-- 整合性の監査クエリ（docs/s20-output-design.md §6）
--
-- 使い方：Supabase ダッシュボード > SQL Editor に貼って実行する。
-- 🔴 **テーブル・写しを追加したら必ず走らせる。** rls-audit.sql と同じ運用。
--    最後に出る「判定」が ✅ 1行でなければ、どこかで写しが元とずれている。
--
-- 🔴 SQL Editor は最後の文の結果しか表示しない。
--    ずれた行そのものを見たいときは ① だけを選択して実行する。
--
-- 🔴 何を見るか ─ 「同じ事実が2か所にあるところ」すべて。
--    写しを足したら、ここにも1ブロック足す（足さなければ、ずれても誰も気づけない）。
--
--   | 写し                              | 元                    | 同期の仕組み                     |
--   |-----------------------------------|-----------------------|----------------------------------|
--   | shifts.jurisdiction_id（今日以降）| sites.jurisdiction_id | shifts_fill_jurisdiction ＋ sites_propagate_jurisdiction |
--   | assignments.work_date / planned_* | shifts の日付・時刻   | assignments_fill_planned_times ＋ shifts_refill_assignment_times |
--   | assignments.is_confirmed          | shifts.status         | sync_assignment_confirmed ＋ assignment_inherit_confirmed |
--   | 各マスタの管轄                    | 部署の所属管轄        | 複合外部キー（#2）               |
--   | guards.employment_type='partner'  | companies.kind        | guards_align_employment_type（#3）|
--
--   意図的なスナップショット（shifts の時刻・班名／notices.body）は**見ない**。
--   ずれていることが正しい（当時の値を残すため）。
-- =============================================================

-- ① ずれている行の一覧（目視確認用・ここだけ選択して実行する）
with problems as (
  -- 現場の管轄と、今日以降の枠の管轄
  select 'shifts.jurisdiction_id ≠ sites' as problem, sh.id::text as row_id,
         sh.work_date::text as detail
    from public.shifts sh
    join public.sites si on si.id = sh.site_id
   where sh.work_date >= (now() at time zone 'Asia/Tokyo')::date
     and sh.jurisdiction_id is distinct from si.jurisdiction_id

  union all

  -- 配置の日付と、枠の日付
  select 'assignments.work_date ≠ shifts', a.id::text, a.work_date::text
    from public.assignments a
    join public.shifts sh on sh.id = a.shift_id
   where a.kind = 'site'
     and a.work_date is distinct from sh.work_date

  union all

  -- 配置の予定時刻と、枠の時刻（assignments_fill_planned_times と同じ式）
  select 'assignments.planned_* ≠ shifts', a.id::text, a.work_date::text
    from public.assignments a
    join public.shifts sh on sh.id = a.shift_id
    cross join lateral (
      select sh.start_h * 60 + sh.start_m as s_min,
             case when sh.end_h * 60 + sh.end_m <= sh.start_h * 60 + sh.start_m
                  then sh.end_h * 60 + sh.end_m + 24 * 60
                  else sh.end_h * 60 + sh.end_m end as e_min
    ) m
   where a.kind = 'site'
     -- 🔴 過去の稼働履歴（★「行ったことがある」の元データ）は**わざと時刻を持たない**
     --   （20260903000000 の末尾・scripts/gen-seed.mts）。ずれではないので除く。
     --   ただし除くのは「過去日 かつ 時刻が空」だけ。今日以降で時刻が空の行は
     --   重複を止める EXCLUDE 制約が黙って外れている状態なので、**必ず拾う**。
     --   （2026-09-24：この除外が無く、ダミーの履歴47件を誤ってずれと数えた）
     and not (a.planned_start_at is null and a.planned_end_at is null
              and a.work_date < (now() at time zone 'Asia/Tokyo')::date)
     and (   a.planned_start_at is distinct from
               (sh.work_date::timestamp + make_interval(mins => m.s_min)) at time zone 'Asia/Tokyo'
          or a.planned_end_at is distinct from
               (sh.work_date::timestamp + make_interval(mins => m.e_min)) at time zone 'Asia/Tokyo'
          or a.planned_break_min is distinct from sh.break_min)

  union all

  -- 配置の確定フラグと、枠の状態
  select 'assignments.is_confirmed ≠ shifts.status', a.id::text, a.work_date::text
    from public.assignments a
    join public.shifts sh on sh.id = a.shift_id
   where a.kind = 'site'
     and a.is_confirmed is distinct from (sh.status = 'confirmed')

  union all

  -- 部署の所属管轄と、各マスタの管轄（#2。外部キーが効いていれば 0件）
  select 'guards: 部署の管轄と不一致', g.id::text, g.name
    from public.guards g
    join public.departments d on d.id = g.department_id
   where d.jurisdiction_id is distinct from g.jurisdiction_id

  union all

  select 'sites: 部署の管轄と不一致', s.id::text, s.name
    from public.sites s
    join public.departments d on d.id = s.department_id
   where d.jurisdiction_id is distinct from s.jurisdiction_id

  union all

  -- 🔴 customers は管轄が null 可。外部キーは null を含む行を検査しないため、
  --   「部署はあるが管轄が空」はここでしか拾えない
  select 'customers: 部署の管轄と不一致', c.id::text, c.name
    from public.customers c
    join public.departments d on d.id = c.department_id
   where d.jurisdiction_id is distinct from c.jurisdiction_id

  union all

  -- 協力会社かどうか（#3。トリガーが効いていれば 0件）
  select 'guards: 所属会社と雇用形態が不一致', g.id::text, g.name
    from public.guards g
    join public.companies co on co.id = g.company_id
   where (co.kind = 'partner') <> (g.employment_type = 'partner')
)
select * from problems order by problem, detail;

-- ② 判定（🔴 これが最後。ここだけ見れば良い）
--
-- 🔴 「0行」を正常とすると、流し忘れと区別できない。正常を明示的に1行で言わせる。
--    ① と同じ条件を件数だけで数え直している（① を変えたらここも変える）。
with counts as (
  select
    (select count(*) from public.shifts sh join public.sites si on si.id = sh.site_id
      where sh.work_date >= (now() at time zone 'Asia/Tokyo')::date
        and sh.jurisdiction_id is distinct from si.jurisdiction_id) as shift_jurisdiction,
    (select count(*) from public.assignments a join public.shifts sh on sh.id = a.shift_id
      where a.kind = 'site' and a.work_date is distinct from sh.work_date) as assignment_date,
    (select count(*) from public.assignments a join public.shifts sh on sh.id = a.shift_id
      cross join lateral (
        select sh.start_h * 60 + sh.start_m as s_min,
               case when sh.end_h * 60 + sh.end_m <= sh.start_h * 60 + sh.start_m
                    then sh.end_h * 60 + sh.end_m + 24 * 60
                    else sh.end_h * 60 + sh.end_m end as e_min) m
      where a.kind = 'site'
        and not (a.planned_start_at is null and a.planned_end_at is null
                 and a.work_date < (now() at time zone 'Asia/Tokyo')::date)
        and (   a.planned_start_at is distinct from
                  (sh.work_date::timestamp + make_interval(mins => m.s_min)) at time zone 'Asia/Tokyo'
             or a.planned_end_at is distinct from
                  (sh.work_date::timestamp + make_interval(mins => m.e_min)) at time zone 'Asia/Tokyo'
             or a.planned_break_min is distinct from sh.break_min)) as assignment_times,
    (select count(*) from public.assignments a join public.shifts sh on sh.id = a.shift_id
      where a.kind = 'site' and a.is_confirmed is distinct from (sh.status = 'confirmed')) as assignment_confirmed,
    (select count(*) from public.guards g join public.departments d on d.id = g.department_id
      where d.jurisdiction_id is distinct from g.jurisdiction_id)
    + (select count(*) from public.sites s join public.departments d on d.id = s.department_id
      where d.jurisdiction_id is distinct from s.jurisdiction_id)
    + (select count(*) from public.customers c join public.departments d on d.id = c.department_id
      where d.jurisdiction_id is distinct from c.jurisdiction_id) as department_jurisdiction,
    (select count(*) from public.guards g join public.companies co on co.id = g.company_id
      where (co.kind = 'partner') <> (g.employment_type = 'partner')) as partner_flag
)
select
  case
    when shift_jurisdiction + assignment_date + assignment_times + assignment_confirmed
         + department_jurisdiction + partner_flag = 0
      then '✅ 写しと元のずれは 0件'
    else '🔴 ずれあり ─ ① を選択して実行し、行を特定する'
  end as 判定,
  shift_jurisdiction      as 枠の管轄,
  assignment_date         as 配置の日付,
  assignment_times        as 配置の予定時刻,
  assignment_confirmed    as 配置の確定,
  department_jurisdiction as 部署と管轄,
  partner_flag            as 協力会社
from counts;

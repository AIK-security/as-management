-- =============================================================
-- assignments.planned_* を親の枠（shifts）から埋める（2026-09-03）
--
-- 🔴 なぜアプリではなく DB で埋めるのか
--   重複配置（同じ隊員を同じ時間帯の2枠に入れる）を止めているのは
--   `assignments_no_overlap`（EXCLUDE 制約）**だけ**である。
--   そしてこの制約は
--       planned_start_at is not null and planned_end_at is not null
--   を条件に持つ。つまり **時刻が入っていない行は判定対象から外れる**。
--
--   → アプリ側で埋める設計にすると、書き忘れ・別経路からの INSERT のたびに
--     **安全網が黙って外れる**。落ちるのではなく「止まらなくなる」ため、
--     壊れたことに誰も気づけない。これがいちばん危ない壊れ方。
--
--   予定時刻は枠から一意に決まる**派生値**であり、人が入れる値ではない。
--   既に同じ判断を2回している（shifts_fill_jurisdiction / sync_assignment_confirmed）。
--   ここでも同じ形に揃える。
--
-- 🔴 日跨ぎの規則は scripts/gen-seed.mts の shiftInterval() と一致させる：
--   **終了が開始以下なら翌日**（夜勤 20:00 → 06:00）。
--
-- 🔴 make_time ではなく make_interval を使う。
--   make_time は 0〜23 時しか受け付けず、「08:00〜24:00」の枠で落ちる。
--   分に直して足せばその制限が無くなり、日跨ぎも同じ式で書ける。
-- =============================================================

create or replace function public.assignments_fill_planned_times()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  s             public.shifts%rowtype;
  start_min     integer;
  end_min       integer;
begin
  -- 貸出・非現場は親の枠を持たない。予定時刻は入力されたものをそのまま使う
  if new.kind <> 'site' or new.shift_id is null then
    return new;
  end if;

  select * into s from public.shifts where id = new.shift_id;
  if not found then
    return new;   -- 外部キー制約が弾く。ここで例外にしても情報が増えない
  end if;

  start_min := s.start_h * 60 + s.start_m;
  end_min   := s.end_h * 60 + s.end_m;
  if end_min <= start_min then
    end_min := end_min + 24 * 60;   -- 日跨ぎ
  end if;

  -- 🔴 work_date も枠に合わせる。日跨ぎ勤務では「開始日」であり、
  --   ここがずれると1日ぶん違う枠として集計されてしまう
  new.work_date         := s.work_date;
  new.planned_start_at  := (s.work_date::timestamp + make_interval(mins => start_min))
                             at time zone 'Asia/Tokyo';
  new.planned_end_at    := (s.work_date::timestamp + make_interval(mins => end_min))
                             at time zone 'Asia/Tokyo';
  new.planned_break_min := s.break_min;

  return new;
end;
$$;

-- 🔴 発火する列を絞る。全列にすると、実績の入力（第2弾以降）のたびに
--   予定を上書きし直すことになる。予定が変わるのは「どの枠に居るか」が
--   変わったときだけ。
create trigger assignments_fill_planned_times_trg
  before insert or update of shift_id, kind on public.assignments
  for each row
  execute function public.assignments_fill_planned_times();

comment on function public.assignments_fill_planned_times() is
  '配置の予定時刻を枠から埋める。🔴 assignments_no_overlap（EXCLUDE）が見る列であり、'
  '空だと重複判定が黙って無効になるため、アプリに委ねずここで埋める。';

-- -------------------------------------------------------------
-- 枠の時刻が変わったら、その枠の配置に写し直す
--
-- 🔴 写しを持つ以上は必ずズレる。人が直す運用にしない。
-- 🔴 この UPDATE は assignments_mark_shift_changed_upd を発火させる
--   （planned_* が対象列に含まれている）。それは**正しい**：
--   確定済みの枠の時刻を変えたなら、べんり君へ渡し直す必要がある。
-- -------------------------------------------------------------
create or replace function public.shifts_refill_assignment_times()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  start_min integer;
  end_min   integer;
begin
  start_min := new.start_h * 60 + new.start_m;
  end_min   := new.end_h * 60 + new.end_m;
  if end_min <= start_min then
    end_min := end_min + 24 * 60;
  end if;

  update public.assignments a
     set work_date         = new.work_date,
         planned_start_at  = (new.work_date::timestamp + make_interval(mins => start_min))
                               at time zone 'Asia/Tokyo',
         planned_end_at    = (new.work_date::timestamp + make_interval(mins => end_min))
                               at time zone 'Asia/Tokyo',
         planned_break_min = new.break_min
   where a.shift_id = new.id
     and a.kind = 'site';

  return null;
end;
$$;

create trigger shifts_refill_assignment_times_trg
  after update of work_date, start_h, start_m, end_h, end_m, break_min
  on public.shifts
  for each row
  execute function public.shifts_refill_assignment_times();

-- -------------------------------------------------------------
-- 🔴 既存行の埋め直しはしない。
--
--   ・第1弾はまだ本番データを持っていない
--   ・開発環境は supabase/seed/20260902_dummy_board.sql が全件入れ直す
--   ・過去の稼働（★の元データ）は**時刻を持たない行のまま**が正しい。
--     同じ日に複数現場へ行った履歴に時刻を入れると EXCLUDE 制約に触れる。
--     履歴は「行ったことがある」を示すためだけの行であり、時刻は使わない
--
--   → 埋め直しの UPDATE を書くと、上の3つ目に必ずぶつかる。
--     seed 側で**過去稼働の INSERT のときだけこのトリガーを外す**
--     （scripts/gen-seed.mts）。既存の変更検知トリガーと同じ扱い。
-- -------------------------------------------------------------

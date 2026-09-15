-- =============================================================
-- 週表（S-07）を確かめるためのダミー（2026-09-15）
--
-- 🔴 なぜ要るのか
--   既存の seed（20260902_dummy_board.sql）は**枠が 2026-09-01 の1日分に集中**している。
--   日別の配置ボードはそれで検証できるが、**週表は7日に散っていないと検証にならない**。
--   CLAUDE.md の「密度が違うと画面設計の検証にならない」と同じ話で、
--   1日しか埋まっていない週表を見ても、詰まるかどうかが分からない。
--
-- 🔴 何度流してもよい（冪等）。
--   この SQL が作った行だけに目印を付け、先に消してから作り直す。
--     ・枠　　 shifts.billing_note = '[週ダミー]'
--     ・業務外 assignments.position = 99（off は枠を持たないため、これしか目印を置けない）
--   ⚠️ 既存の 9/01 のダミーや、画面から手で作った枠・配置には触らない。
--
-- 🔴 いつ流しても「その週」に入る。
--   date_trunc('week', …) は PostgreSQL では**月曜始まり**なので、
--   画面側の startOfWeek()（月曜始まり・screen-design.md §7-2-10）と揃う。
--   JST で今日を出してから週を切る（Supabase は UTC で動くため、
--   素の current_date では夜に流すと1日ずれる）。
--
-- 使い方：Supabase ダッシュボード > SQL Editor に貼って実行する。
--        最後に出る件数を目視で確認する。
--
-- 🔴 中身はすべて架空。実データは持ち込まない（CLAUDE.md）。
-- =============================================================

do $$
declare
  monday    date := date_trunc('week', (now() at time zone 'Asia/Tokyo')::date)::date;
  d         date;
  s         record;
  g         record;
  v_shift   uuid;
  v_kind    text;
  need      int;
  to_place  int;
  pos       int;
  used      uuid[];
begin
  -- ── 前回のぶんを消す（冪等）────────────────────────
  delete from public.assignments
   where shift_id in (select id from public.shifts where billing_note = '[週ダミー]');
  delete from public.shifts where billing_note = '[週ダミー]';
  delete from public.assignments
   where kind = 'off' and position = 99
     and work_date between monday and monday + 6;

  -- ── 7日ぶん作る ────────────────────────────────────
  for i in 0..6 loop
    d := monday + i;
    used := '{}';

    for s in
      select st.id,
             st.jurisdiction_id,
             st.band_name,
             coalesce(st.plan_start_h, 8)  as sh,
             coalesce(st.plan_start_m, 0)  as sm,
             coalesce(st.plan_end_h,  17)  as eh,
             coalesce(st.plan_end_m,   0)  as em,
             coalesce(st.plan_break,  60)  as bk,
             row_number() over (order by st.name) as rn
        from public.sites st
       where st.status = 'active'
    loop
      -- 🔴 現場ごとに「週に何日出るか」を変える。
      --   毎日ある現場・平日だけの現場・週3日・単発が混ざっていないと、
      --   週表で見たときの「歯抜けの見え方」が確かめられない。
      continue when not (
            (s.rn % 5 = 0)                                                   -- 毎日
         or (s.rn % 5 in (1, 2) and extract(isodow from d) <= 5)             -- 平日のみ
         or (s.rn % 5 = 3       and extract(isodow from d) in (1, 3, 5))     -- 月・水・金
         or (s.rn % 5 = 4       and extract(isodow from d) = 3)              -- 水のみ（単発）
      );

      -- 夜勤も少し混ぜる（夜勤タブが空だと切り替えの確認ができない）
      v_kind := case when s.rn % 6 = 0 then 'nightA' else 'day' end;

      -- 🔴 必要人数は 1〜3。実測は平均 2.0 名/枠（CLAUDE.md）。
      need := 1 + (s.rn % 3);

      insert into public.shifts (
        site_id, work_date, jurisdiction_id, work_kind, headcount,
        start_h, start_m, end_h, end_m, break_min,
        band_name, plan_comment, billing_note, status
      ) values (
        s.id, d, s.jurisdiction_id, v_kind, need,
        case when v_kind = 'nightA' then 20 else s.sh end, s.sm,
        case when v_kind = 'nightA' then  6 else s.eh end, s.em,
        s.bk,
        s.band_name,
        null,
        '[週ダミー]',
        -- 🔴 ここでは必ず draft で作る。確定にするのは**配置を入れ終わってから**
        --   （この do ブロックの最後）。理由は下の update のコメント。
        'draft'
      )
      returning id into v_shift;

      -- 🔴 7件に1件はわざと1名足りなくする。不足の赤字が出ることを確かめるため
      to_place := case when s.rn % 7 = 0 then need - 1 else need end;

      pos := 0;
      for g in
        select gd.id
          from public.guards gd
         where gd.status = 'active'
           and not (gd.id = any(used))
           -- 🔴 その日すでに稼働している隊員は使わない。
           --   使うと時間帯の重複で EXCLUDE 制約に当たり、この SQL ごと落ちる。
           --   画面から手で入れた配置も含めて避ける。
           and not exists (
             select 1 from public.assignments a
              where a.work_date = d and a.guard_id = gd.id
           )
         order by gd.staff_code
         limit greatest(to_place, 0)
      loop
        insert into public.assignments (
          guard_id, work_date, kind, shift_id, role, position, status
        ) values (
          g.id, d, 'site', v_shift,
          case when pos = 0 then 'leader' else 'member' end,
          pos, 'planned'
        );
        used := used || g.id;
        pos  := pos + 1;
      end loop;
    end loop;

    -- ── 業務外（有給・研修）を各日2名ずつ ────────────────
    --   A表の実物は下部に業務外の区画を持つ（2026-09-09 実物解析）。
    --   ここが空だと週表の下半分が確かめられない。
    for g in
      select gd.id, row_number() over (order by gd.staff_code desc) as rn
        from public.guards gd
       where gd.status = 'active'
         and not (gd.id = any(used))
         and not exists (
           select 1 from public.assignments a
            where a.work_date = d and a.guard_id = gd.id
         )
       order by gd.staff_code desc
       limit 2
    loop
      insert into public.assignments (
        guard_id, work_date, kind, off_kind, position, status
      ) values (
        g.id, d, 'off',
        case when g.rn = 1 then 'paid_leave' else 'training' end,
        99,                     -- 🔴 99 はこの SQL の目印（上の delete と対）
        'planned'
      );
      used := used || g.id;
    end loop;
  end loop;

  -- ── 最後に、週の前半2日を確定にする ──────────────────
  --
  -- 🔴 枠を作るときに 'confirmed' にしてはいけない（2026-09-15 に踏んだ）。
  --   assignments を INSERT すると revert_shift_to_draft_on_change
  --   （20260903120000）が働き、**確定済みの枠は仮組みに戻される**。
  --   「確定後に人が動いたら確定し直す」という正しい仕様なので、
  --   ダミー側が順序を合わせる ─ 配置を入れ終えてから確定にする。
  --
  --   A表の「仮組み（橙）／確定」の見え方を週表で確かめるために要る。
  update public.shifts
     set status = 'confirmed',
         confirmed_at = now()
   where billing_note = '[週ダミー]'
     and work_date < monday + 2;
end $$;

-- 確認用（🔴 SQL Editor は最後の文の結果しか出さないので、ここに置く）
--
-- 期待：日付が7行ならび、どの日にも枠がある。
--      「確定」は前半2日、「仮組み」は後半5日に寄る。
select
  s.work_date                                              as 日付,
  to_char(s.work_date, 'Dy')                               as 曜日,
  count(*)                                                 as 枠,
  sum(s.headcount)                                         as 必要人数,
  count(*) filter (where s.status = 'confirmed')            as 確定,
  count(*) filter (where s.status = 'draft')                as 仮組み,
  (select count(*) from public.assignments a
    where a.shift_id in (select id from public.shifts s2 where s2.work_date = s.work_date
                           and s2.billing_note = '[週ダミー]')) as 配置済み
from public.shifts s
where s.billing_note = '[週ダミー]'
group by s.work_date
order by s.work_date;

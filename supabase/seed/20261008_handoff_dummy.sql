-- =============================================================
-- べんり君への引き渡し（/handoff）を開発用で試すためのダミー（2026-10-08）
--
-- 🔴 開発用の Supabase 専用。本番には流さない（本番の勤務マスタは取込で入っている）。
-- 🔴 番号はすべて架空。ShiftMax の実際の番号とは関係ない。
--
-- なぜ要るか：ダミー（20260902_dummy_board.sql）には勤務マスタ（duty_codes）と
--   「応援」の隊員が無く、/handoff が「警備先番号が見つからない」で止まって CSV を試せなかった。
--
-- 使い方：20260902_dummy_board.sql の後に SQL Editor で流す。何度流しても同じ状態になる。
-- =============================================================

-- 〈得意先 × 区分〉ごとに架空の警備先番号を振る（区分は WORK_KIND_LABEL と同じ文字）
insert into public.duty_codes (guard_target_no, sm_site_code, kind_label, customer_staff_code)
select 'DMY-' || c.staff_code || '-' || k.n,
       'DS' || c.staff_code,
       k.label,
       c.staff_code
  from public.customers c
 cross join (values (1, '日勤'), (2, '夜A'), (3, '夜B'), (4, '日勤現中'), (5, '夜勤現中')) k(n, label)
on conflict (guard_target_no) do nothing;

-- 協力会社の隊員をまとめる「応援」の隊員（handoff.ts は名前が「応援」で始まる隊員を探す）
insert into public.guards (id, staff_code, guard_no, name, short_name, name_kana, jurisdiction_id, company_id, employment_type)
values ('60000000-0000-4000-8000-000000000999', '524', '524', '応援　東京', '応援', 'オウエン',
        '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'employee')
on conflict (id) do nothing;

-- 確認用
select (select count(*) from public.duty_codes where guard_target_no like 'DMY-%') as ダミーの警備先番号,
       (select count(*) from public.guards where name like '応援%') as 応援の隊員;

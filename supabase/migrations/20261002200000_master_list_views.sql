-- =============================================================
-- マスタ一覧（現場・隊員・得意先）のビュー（2026-10-02）
--
-- 🔴 なぜ要るのか（柴山：ソートや検索があったほうがいい）
--   一覧は「漢字の文字コード順・固定」で、並べ替えも絞り込みも無かった。
--   得意先名で並べる・得意先名で探す・所属で絞るには**別の表の列**が要る。
--   PostgREST の「関連表の列で並べる／絞る」に頼ると書き方が込み入るため、
--   一覧に出す列を**普通の列として持つビュー**にして、並べ替え・絞り込み・検索を単純に保つ。
--
-- 🔴 写しではなく結合のビュー。表を増やさないので同期の心配は無い（s20-output-design.md §6）。
-- 🔴 security_invoker：読む人の権限（RLS）で元の表を読む。
--
-- 🔴 並べ替え用の列
--   ・*_kana_sort … フリガナを NFKC で全角に揃えたもの。実データのフリガナは**すべて半角カナ**
--     （隊員250・得意先603 ─ 10/2 実測）。半角のままだと濁点が別文字になり五十音順にならない
--   ・*_code_sort … 数字のコードを12桁に0埋めしたもの。文字のままだと「100」が「20」より前に来る
-- =============================================================

create or replace view public.site_list
with (security_invoker = true) as
select s.id,
       s.site_code,
       s.name,
       s.short_name,
       s.name_kana,
       s.address,
       s.billing_no,
       s.status,
       s.plan_start_h, s.plan_start_m, s.plan_end_h, s.plan_end_m, s.plan_break,
       s.customer_id,
       c.name                                             as customer_name,
       normalize(coalesce(c.name_kana, ''), NFKC)         as customer_kana_sort,
       s.jurisdiction_id,
       j.code                                             as jurisdiction_code,
       j.name                                             as jurisdiction_name,
       d.name                                             as department_name
  from public.sites s
  left join public.customers c     on c.id = s.customer_id
  left join public.jurisdictions j on j.id = s.jurisdiction_id
  left join public.departments d   on d.id = s.department_id;

create or replace view public.guard_list
with (security_invoker = true) as
select g.id,
       g.staff_code,
       lpad(coalesce(g.staff_code, ''), 12, '0')          as staff_code_sort,
       g.guard_no,
       g.name,
       g.short_name,
       g.name_kana,
       normalize(coalesce(g.name_kana, ''), NFKC)         as name_kana_sort,
       g.email,
       g.employment_type,
       g.status,
       g.company_id,
       co.name                                            as company_name,
       co.kind                                            as company_kind,
       g.jurisdiction_id,
       j.code                                             as jurisdiction_code,
       j.name                                             as jurisdiction_name,
       d.name                                             as department_name
  from public.guards g
  left join public.companies co    on co.id = g.company_id
  left join public.jurisdictions j on j.id = g.jurisdiction_id
  left join public.departments d   on d.id = g.department_id;

create or replace view public.customer_list
with (security_invoker = true) as
select c.id,
       c.staff_code,
       lpad(c.staff_code, 12, '0')                        as staff_code_sort,
       c.name,
       c.name_kana,
       normalize(coalesce(c.name_kana, ''), NFKC)         as name_kana_sort,
       c.contact_name,
       c.billing_no,
       c.billing_name,
       c.jurisdiction_id,
       j.code                                             as jurisdiction_code,
       j.name                                             as jurisdiction_name,
       (select count(*) from public.sites s where s.customer_id = c.id)::int as site_count
  from public.customers c
  left join public.jurisdictions j on j.id = c.jurisdiction_id;

grant select on public.site_list, public.guard_list, public.customer_list to authenticated;

-- 確認用（7月分の実データなら 127 / 250 / 603）
select (select count(*) from public.site_list)     as 現場,
       (select count(*) from public.guard_list)    as 隊員,
       (select count(*) from public.customer_list) as 得意先;

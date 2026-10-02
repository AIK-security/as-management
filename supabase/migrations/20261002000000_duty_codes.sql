-- =============================================================
-- 警備先番号を現場から切り離す／現場コードを自動採番にする（2026-10-02）
--
-- 設計：docs/data-model.md §3-7・docs/data-gap-20260917.md §7（10/2 の決定）
--
-- 🔴 なぜやるのか
--   警備先番号（ShiftMax 勤務マスター 1,593件）の正体は「現場」ではなく
--   〈得意先 × 勤務区分〉の組み合わせだった（data-gap-20260917.md §2）。
--   7月実データでも〈得意先 × 区分〉→ 番号は 1:1（重複 0件・10/2 確認）。
--   にもかかわらず sites が警備先番号を必須で持っていたため、
--     ・同じ現場が日勤／夜A／夜B で別々の現場として並ぶ（7月で 25件）
--     ・新しい現場を作るたびに仮番号（TMP-）が要る
--   という形になっていた。
--   → 番号は**引き渡し（段3）のときに〈現場の得意先 × 枠の区分〉で引く**。
--     現場は番号を持たない（1つの事実は1か所 ─ s20-output-design.md §6）。
--
-- 🔴 段3（引き渡し）は未実装。この表を使う出力はまだ無い。
--   引き渡しの工程そのものが不要と決まったら、**この表ごと捨てられる**
--   （sites 側には何も残らない ─ 設計原則5「捨てやすく作る」）。
--
-- 🔴 現場コードは DB が振る（AS0001〜）。
--   意味を持たせない（得意先・地域・頻度を表さない）。重複しないことだけが約束。
--   ダミーの現場コードは ST0001 形式なので重ならない。
--
-- 適用後：
--   ・supabase/checks/rls-audit.sql → ✅ 1行（テーブルが1つ増える）
--   ・supabase/checks/consistency-audit.sql → ✅ 1行
-- =============================================================


-- =============================================================
-- 1. 勤務マスタ（警備先番号の対応表）
--
-- 🔴 ShiftMax の写しとして持つ。得意先は id ではなく**担当コードのまま**持つ。
--   得意先マスターを先に取り込んでいなくても入り、引くときに customers.staff_code で突き合わせる。
--   （id に解決して持つと、取込の順番で紐付けが落ちる ─ 9/14 の取込で踏んだ穴）
-- =============================================================
create table if not exists public.duty_codes (
  guard_target_no     text primary key,      -- 警備先番号（C列）
  sm_site_code        text not null,         -- ShiftMax の現場コード（B列）。投入CSVの2列目
  kind_label          text not null,         -- 区分（E列「略称」の中身＝日勤／夜A／夜B…）
  customer_staff_code text,                  -- 担当コード（T列）＝ customers.staff_code
  customer_code       text,                  -- 顧客コード（O列）
  customer_no         text,                  -- 得意先番号（P列）
  billing_no          text,                  -- 請求番号（U列）
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists duty_codes_customer_kind_idx
  on public.duty_codes (customer_staff_code, kind_label);

comment on table public.duty_codes is
  'ShiftMax 勤務マスターの写し。〈得意先×区分〉→ 警備先番号。引き渡し（段3）でだけ使う。';

drop trigger if exists duty_codes_touch on public.duty_codes;
create trigger duty_codes_touch before update on public.duty_codes
  for each row execute function public.touch_updated_at();

-- RLS：閲覧はスタッフ全員、書き込みは管制・管理者（取込画面が control にも開いているため）
alter table public.duty_codes enable row level security;

drop policy if exists duty_codes_select on public.duty_codes;
create policy duty_codes_select on public.duty_codes
  for select to authenticated using (public.is_staff());

drop policy if exists duty_codes_write on public.duty_codes;
create policy duty_codes_write on public.duty_codes
  for all to authenticated using (public.can_edit()) with check (public.can_edit());


-- =============================================================
-- 2. 現場コードの自動採番（AS0001〜）
--
-- 🔴 仮番号（TMP-）をやめる。番号を誰がいつ直すかという未決事項ごと消える。
--   4桁を超えたら AS10000 になるだけで、壊れない（lpad は切り詰めない書き方にしてある）。
-- =============================================================
create sequence if not exists public.sites_code_seq;

create or replace function public.next_site_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'AS' || lpad(n::text, greatest(4, length(n::text)), '0')
  from (select nextval('public.sites_code_seq') as n) s;
$$;

comment on function public.next_site_code() is
  '現場コードを振る（AS0001〜）。意味を持たせない連番。';

alter table public.sites alter column site_code set default public.next_site_code();

-- 既に AS で始まる番号があれば、その続きから振る（再実行しても重ならない）
select setval(
  'public.sites_code_seq',
  greatest(
    1,
    coalesce(
      (select max(substring(site_code from 3)::bigint)
         from public.sites
        where site_code ~ '^AS[0-9]+$'),
      0)
  ),
  exists (select 1 from public.sites where site_code ~ '^AS[0-9]+$')
);

-- 仮番号のまま残っている現場に、本番号を振る
update public.sites
   set site_code = public.next_site_code()
 where site_code like 'TMP-%';


-- =============================================================
-- 3. 現場から警備先番号を外す
--
-- 🔴 本番の現場はダミー（2026-10-02 時点）。失って困る値は無い。
--   索引 sites_guard_target_no_idx は列と一緒に消える。
-- =============================================================
alter table public.sites drop column if exists guard_target_no;


-- 確認用（この文の結果を目視する：guard_target_no が無く、site_code に default が付いていること）
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'sites'
  and column_name in ('site_code', 'guard_target_no');

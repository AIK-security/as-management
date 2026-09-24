-- =============================================================
-- 同じ事実の「写し」が元とずれる穴を3つ塞ぐ（2026-09-24）
--
-- 設計：docs/s20-output-design.md §6（データの整合性）
--
-- 🔴 なぜやるのか（柴山・2026-09-24）
--   AIK assign が複雑になった原因の1つは、テーブルが多く
--   **テーブル1で加えた変更が、同じ案件のテーブル2に反映されていなかった**こと。
--   本システムの原則：
--     ① 1つの事実は1か所にだけ書く
--     ② やむを得ず写しを持つなら、同期は DB にやらせる（人やアプリに合わせさせない）
--   既に4つの写しは DB で同期している（管轄・予定時刻・確定状態・仮組みへ戻す）。
--   ここで塞ぐのは、点検で見つかった残りの穴。
--
--   #1 現場の管轄を変えても、作成済みの枠が旧管轄のボードに残る
--   #2 部署と管轄を両方持ち、「千葉の部署なのに東京所属」を入れられる
--   #3 協力会社かどうかが guards.employment_type と companies.kind の2か所にある
--
-- 🟠 穴 #4（請求番号が sites と customers の2か所）はここでは塞がない。
--   どちらが正かを実データで確かめてから決める（推測で直さない）。
--
-- 🔴 適用前に supabase/checks/consistency-audit.sql を流し、#2・#3 が 0件であることを確かめる。
--   #2 は外部キーを張る時点で既存行が検査され、1件でも矛盾があれば**丸ごと失敗する**
--   （途中まで入ることはない）。#3 は下の do ブロックが同じく止める。
--
-- 適用後：
--   ・supabase/checks/rls-audit.sql → ✅ 1行（テーブルは増やしていない）
--   ・supabase/checks/consistency-audit.sql → ✅ 1行
-- =============================================================


-- =============================================================
-- #1 現場の管轄を変えたら、今日以降の枠へ写す
--
-- 🔴 shifts.jurisdiction_id は写しである（引き渡し・ボードの単位が「日付 × 管轄」のため）。
--   写すのは shifts_fill_jurisdiction（board_core.sql）だが、発火は
--   「枠の作成時」と「枠の現場を差し替えたとき」だけで、**現場側の変更を拾わない**。
--   → 現場を東京から神奈川へ移しても、来週の枠は東京のボードに出続ける。
--
-- 🔴 過去の枠は写さない。当時どの管轄で組んだかは記録であり、
--   後から書き換えると過去の確定・連絡の記録（日付 × 管轄）と食い違う。
--   「今日」は JST で数える（夜勤の日跨ぎは work_date＝開始日で持っている）。
-- =============================================================
create or replace function public.sites_propagate_jurisdiction()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if new.jurisdiction_id is distinct from old.jurisdiction_id then
    update public.shifts
       set jurisdiction_id = new.jurisdiction_id
     where site_id = new.id
       and work_date >= (now() at time zone 'Asia/Tokyo')::date
       and jurisdiction_id is distinct from new.jurisdiction_id;
  end if;
  return null;
end;
$$;

create trigger sites_propagate_jurisdiction_trg
  after update of jurisdiction_id on public.sites
  for each row
  execute function public.sites_propagate_jurisdiction();

comment on function public.sites_propagate_jurisdiction() is
  '現場の管轄変更を、今日（JST）以降の枠へ写す。過去の枠は当時のまま（2026-09-24）。';


-- =============================================================
-- #2 部署と管轄の組み合わせを DB が拒否する
--
-- 🔴 部署は管轄に属する（departments.jurisdiction_id NOT NULL）。
--   隊員・現場・得意先はその両方を持つため、食い違った組み合わせを入れられた。
--   画面（GuardEditForm 等）は管轄で部署を絞っているが、それは**画面の都合**であって、
--   CSV 取込や将来の別経路からは素通りする。
--
-- 🔴 トリガーではなく複合外部キーにする。宣言なので読めば規則が分かり、
--   既存行も張る時点で検査される。
--   ・部署が空（null）の行は検査しない（MATCH SIMPLE の既定）。部署なしは正常
--   ・on update cascade：部署の所属管轄を変えたら、所属する隊員・現場・得意先の管轄も追随する。
--     現場の管轄が変われば #1 のトリガーが今日以降の枠へ写す（写しの連鎖も DB で閉じる）
--
-- ⚠️ customers.jurisdiction_id は null 可。「部署はあるが管轄が空」の得意先は
--   外部キーでは拾えないため、consistency-audit.sql で見る。
-- =============================================================
alter table public.departments
  add constraint departments_id_jurisdiction_key unique (id, jurisdiction_id);

alter table public.guards
  add constraint guards_department_jurisdiction_fkey
  foreign key (department_id, jurisdiction_id)
  references public.departments (id, jurisdiction_id)
  on update cascade;

alter table public.sites
  add constraint sites_department_jurisdiction_fkey
  foreign key (department_id, jurisdiction_id)
  references public.departments (id, jurisdiction_id)
  on update cascade;

alter table public.customers
  add constraint customers_department_jurisdiction_fkey
  foreign key (department_id, jurisdiction_id)
  references public.departments (id, jurisdiction_id)
  on update cascade;


-- =============================================================
-- #3 「協力会社の隊員か」の正は companies.kind。employment_type はそれに従う
--
-- 🔴 画面の判定（プールの色・連絡の宛先・休み管理）は**すべて companies.kind を見ている**
--   （src/lib/board.ts・week-board.ts・notices.ts・offs.ts）。
--   employment_type = 'partner' はマスタ一覧に表示しているだけの写しで、
--   「自社所属なのに雇用形態は協力会社」を入れられた。
--   → S-20 で自社と外注を分けて出すとき、数がずれる。
--
-- 🔴 列を消さずに DB で揃える。employment_type は自社内で「社員／アルバイト」を分ける
--   意味をまだ持っており（給与は第3弾）、消すと取り戻せない。
--   ・所属が協力会社 → DB が 'partner' に揃える（人に選ばせない）
--   ・所属が自社なのに 'partner' → 拒否する（どちらが正しいか DB には分からない）
-- =============================================================

-- 既存行を先に確かめる。トリガーは既存行を検査しないため、ここで止めないと
-- 矛盾が黙って残る。
do $$
declare n integer;
begin
  select count(*) into n
    from public.guards g
    join public.companies c on c.id = g.company_id
   where c.kind = 'own' and g.employment_type = 'partner';
  if n > 0 then
    raise exception '自社所属なのに雇用形態が「協力会社」の隊員が % 名います。consistency-audit.sql で特定し、雇用形態を直してから流し直してください。', n;
  end if;
end $$;

-- 協力会社の所属なのに 'partner' でない行は、正が明らかなので揃える
update public.guards g
   set employment_type = 'partner'
  from public.companies c
 where c.id = g.company_id
   and c.kind = 'partner'
   and g.employment_type <> 'partner';

create or replace function public.guards_align_employment_type()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  company_kind text;
begin
  select kind into company_kind from public.companies where id = new.company_id;

  if company_kind = 'partner' then
    new.employment_type := 'partner';
  elsif new.employment_type = 'partner' then
    -- 🔴 日本語で落とす。取込・画面のエラー表示にそのまま出る
    raise exception '自社所属の隊員に雇用形態「協力会社」は設定できません（所属会社を協力会社にしてください）'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger guards_align_employment_type_trg
  before insert or update of company_id, employment_type on public.guards
  for each row
  execute function public.guards_align_employment_type();

comment on function public.guards_align_employment_type() is
  '協力会社かどうかの正は companies.kind。employment_type をそれに揃える（2026-09-24）。';

-- 会社の種別を変えたときも揃える
--   own → partner：所属隊員を 'partner' に揃える
--   partner → own：所属隊員を列の既定値 'employee' に戻す
--
-- 🔴 partner → own を「止める」にしてはいけない。協力会社の間は上のトリガーが
--   所属隊員を 'partner' に固定するため、**先に隊員側を直す手段が無く、永久に戻せなくなる**。
--   社員かアルバイトかは DB に分からないので既定値に寄せ、必要なら人が直す（稀な操作）。
create or replace function public.companies_align_guards_employment()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if new.kind = old.kind then
    return null;
  end if;

  update public.guards
     set employment_type = case when new.kind = 'partner' then 'partner' else 'employee' end
   where company_id = new.id
     and employment_type is distinct from
         case when new.kind = 'partner' then 'partner' else 'employee' end
     -- own へ戻すとき、自社側の区分（社員／アルバイト）が既に入っている人は触らない
     and (new.kind = 'partner' or employment_type = 'partner');
  return null;
end;
$$;

create trigger companies_align_guards_employment_trg
  after update of kind on public.companies
  for each row
  execute function public.companies_align_guards_employment();

comment on function public.companies_align_guards_employment() is
  '会社の種別変更を所属隊員の employment_type に反映する（2026-09-24）。';

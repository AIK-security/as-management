-- =============================================================
-- 配置ボードの中核テーブル（2026-09-02）＝ 段2 の土台
--
-- 定義の正本：docs/data-model.md §3（マスタ）・§4（配置）・§5（配置の制約）
-- 要件：docs/requirements.md §4-1／§4-2／§6 S-2（全テーブル RLS）
--
-- 🔴 なぜ D&D より先に DB を作るのか
--   完成条件1（§7-1）は「1日分の配置を、システム上だけで組める」＝**永続化が要る**。
--   クライアント状態だけで D&D を作ると、配置の更新ロジックを
--   state 版と DB 版で2度書くことになる（1名体制では割に合わない）。
--
-- 🔴 このファイルで作らないもの（意図的）
--   ・shiftmax_exports（引き渡し履歴）… 段3 で追加する
--   ・単価・金額の列 … requirements.md §8-2 で「第1弾では持たない」と決着。
--     🔴 **列だけ作って空にすることもしない。** 第2弾で足すときに
--     「書き忘れ」と読まれないよう、ここに理由ごと残す
--   ・実績の入力経路 … actual_* の器は作るが埋めない（同 §8-4／§8-5）
-- =============================================================

-- EXCLUDE 制約で「隊員IDが等しく、かつ時間帯が重なる」を禁じるために要る。
-- gist は範囲型しか扱えないため、uuid の等値比較を gist に載せる拡張を有効化する。
create extension if not exists btree_gist;

-- =============================================================
-- 3. マスタ（docs/data-model.md §3）
-- =============================================================

-- -------------------------------------------------------------
-- 3-1. jurisdictions（管轄）— ShiftMax 由来
--
-- 2つのフラグは ShiftMax に実在する列で、**業務側が既にこの考え方で
-- 運用している**ことの裏付けでもある（data-model.md §2）。
-- 応援（他管轄の貸し借り）は専用テーブルを作らず、この2フラグと
-- 「隊員の管轄 ≠ 現場の管轄」という差分だけで表す。
-- -------------------------------------------------------------
create table public.jurisdictions (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  -- 他管轄社員配置：他管轄の隊員を自管轄の現場へ受け入れてよいか
  allow_cross_staff boolean not null default true,
  -- 他管轄現場配置：自管轄の隊員を他管轄の現場へ出してよいか
  allow_cross_site  boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.jurisdictions is
  '管轄。ShiftMax 由来。応援の可否はこの2フラグで表す（専用テーブルを作らない）。';

-- -------------------------------------------------------------
-- 3-2. departments（部署）— 部署は管轄に属する
-- -------------------------------------------------------------
create table public.departments (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  jurisdiction_id uuid not null references public.jurisdictions (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -------------------------------------------------------------
-- 3-3. companies（会社）★新規 — ShiftMax に存在しない
--
-- 🔴 協力会社は ShiftMax に個人単位で存在しない（2026-08-31 実データで確認）。
--   新システムは個人単位で持ち、ShiftMax へは「応援」枠に寄せて渡す。
--   → 登録枠46人を1人も消費しない＝追加費用ゼロ（data-model.md §7）
-- -------------------------------------------------------------
create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_kana     text,
  -- own=AS 自社 / partner=協力会社
  kind          text not null check (kind in ('own', 'partner')),
  -- 業務委託書（S-04）の生成に使う
  contact_name  text,
  contact_phone text,
  status        text not null default 'active' check (status in ('active', 'inactive')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.companies is
  '自社（AS）と協力会社。ShiftMax に無く、新システムが持つ。';

-- -------------------------------------------------------------
-- 3-4. guards（隊員）— 警備番頭の guards を流用（org_id → company_id）
-- -------------------------------------------------------------
create table public.guards (
  id              uuid primary key default gen_random_uuid(),
  -- 🔴 協力会社の隊員は ShiftMax に登録が無いため両列とも null 可
  staff_code      text unique,   -- 個人コード（ShiftMax。投入CSV 必須）
  guard_no        text,          -- 隊員ナンバー（ShiftMax。投入CSV 必須）
  name            text not null,
  short_name      text not null, -- プレートに出す略称
  name_kana       text,
  jurisdiction_id uuid not null references public.jurisdictions (id),
  department_id   uuid references public.departments (id),
  company_id      uuid not null references public.companies (id),
  email           text,          -- ShiftMax にある唯一の連絡先
  employment_type text not null default 'employee'
                  check (employment_type in ('employee', 'part_time', 'partner')),
  status          text not null default 'active' check (status in ('active', 'inactive')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.guards.staff_code is
  '個人コード（ShiftMax）。🔴 協力会社の隊員は持たないため null 可。';

-- 🔴 資格は配列で持たない。有効期限が要るためテーブルにする（§5-2）。
--   請求時点で有効だったかを後から言えるようにするため。

-- -------------------------------------------------------------
-- 3-5. guard_contacts（連絡先）★新規
--
-- 🔴 ShiftMax に電話・LINE は無い（メールのみ）。
--   「LINE が繋がらない隊員が約4割」を扱うため reachable を持つ。
--   一斉連絡（S-03）は LINE 可／不可で宛先を分けて出す（requirements.md §4-4）。
-- -------------------------------------------------------------
create table public.guard_contacts (
  id         uuid primary key default gen_random_uuid(),
  guard_id   uuid not null references public.guards (id) on delete cascade,
  kind       text not null check (kind in ('phone', 'line', 'email', 'other')),
  value      text not null,
  -- 🔴 到達可否。false の隊員は「電話リスト」側へ回す
  reachable  boolean not null default true,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guard_contacts_guard_idx on public.guard_contacts (guard_id);

-- -------------------------------------------------------------
-- 3-6. customers（得意先）— ShiftMax 由来。主キーは顧客ではなく担当コード
-- -------------------------------------------------------------
create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  staff_code      text not null unique,  -- 担当コード（ShiftMax の実質キー）
  name            text not null,         -- 顧客名
  name_kana       text,
  contact_name    text,                  -- 担当名
  billing_no      text,                  -- 請求番号
  billing_name    text,                  -- 請求名
  jurisdiction_id uuid references public.jurisdictions (id),
  department_id   uuid references public.departments (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -------------------------------------------------------------
-- 3-7. sites（現場＝勤務マスタ）— ShiftMax 由来
--
-- ✅ 警備先番号を1つ打てば、現場名・時間・班・請求先が埋まる。
--   現行のべんり君の体験そのもの。**この入力キーの位置づけは維持する**
--   （要件は資産に合わせて曲げない）。
-- -------------------------------------------------------------
create table public.sites (
  id              uuid primary key default gen_random_uuid(),
  site_code       text not null unique,
  -- 🔴 警備先番号。べんり君の入力キー
  guard_target_no text not null,
  name            text not null,
  short_name      text not null,
  name_kana       text,
  address         text,
  band_name       text,                         -- 班名
  -- 予定値のひな形。shifts はここを既定値として取り込み、枠ごとに上書きできる
  plan_start_h    smallint,
  plan_start_m    smallint,
  plan_end_h      smallint,
  plan_end_m      smallint,
  plan_break      smallint,
  has_plan        boolean not null default true, -- 勤務予定フラグ
  customer_id     uuid references public.customers (id),
  billing_no      text,
  jurisdiction_id uuid not null references public.jurisdictions (id),
  department_id   uuid references public.departments (id),
  status          text not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index sites_guard_target_no_idx on public.sites (guard_target_no);
create index sites_jurisdiction_idx on public.sites (jurisdiction_id);

-- =============================================================
-- 5-2. 資格（docs/data-model.md §5-2）
-- =============================================================

create table public.qualifications (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  -- プレートのバッジに出す短い表記（例：交1／交2）
  short_label text not null,
  has_expiry  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.guard_qualifications (
  id               uuid primary key default gen_random_uuid(),
  guard_id         uuid not null references public.guards (id) on delete cascade,
  qualification_id uuid not null references public.qualifications (id),
  number           text,       -- 検定番号など
  issued_on        date,
  -- 🔴 期限。「請求時点で有効だったか」を後から言えるようにするための列
  expires_on       date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (guard_id, qualification_id)
);

-- 🟠 不要と分かれば後から消す（2026-08-28 判断）。現時点では持てるようにしておく。
create table public.site_required_qualifications (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.sites (id) on delete cascade,
  qualification_id uuid not null references public.qualifications (id),
  required_count   smallint not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (site_id, qualification_id)
);

-- =============================================================
-- 4. 配置（docs/data-model.md §4）
-- =============================================================

-- -------------------------------------------------------------
-- 4-1. shifts（配置枠）＝ A表の1行
--
-- ✅ 「A表は仮組みと確定の2役」を、別テーブルではなく status 1列で表す。
--   8/27 の「入力画面は1画面で仮組み→確定を扱う」に対応する。
-- -------------------------------------------------------------
create table public.shifts (
  id                    uuid primary key default gen_random_uuid(),
  site_id               uuid not null references public.sites (id),
  -- 🔴 日跨ぎ勤務では「開始日」
  work_date             date not null,
  -- 引き渡しが「日付 × 管轄」単位のため冗長に持つ（下のトリガーで sites から埋める）
  jurisdiction_id       uuid not null references public.jurisdictions (id),
  work_kind             text not null
                        check (work_kind in ('day', 'nightA', 'nightB', 'dayCancel', 'nightCancel')),
  headcount             smallint not null default 1 check (headcount > 0),
  start_h               smallint not null,
  start_m               smallint not null default 0,
  end_h                 smallint not null,
  end_m                 smallint not null default 0,
  break_min             smallint not null default 0,
  band_name             text,
  plan_comment          text,
  billing_note          text,
  -- 🔴 draft=仮組み / confirmed=確定
  status                text not null default 'draft' check (status in ('draft', 'confirmed')),
  confirmed_at          timestamptz,
  confirmed_by          uuid references public.profiles (id),
  -- 確定後に編集されたか。ShiftMax へ再度引き渡す必要があることを示す
  changed_after_confirm boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index shifts_date_jurisdiction_idx on public.shifts (work_date, jurisdiction_id);
create index shifts_site_date_idx on public.shifts (site_id, work_date);

comment on column public.shifts.status is
  'draft=仮組み / confirmed=確定。A表の2役を1列で表す（data-model.md §4-1）。';

-- 🔴 現中（現着中止）の扱いは未決（requirements.md §8-7 ①）。
--   work_kind の区分としては置くが、「中止でも稼働時間が立つ」場合の
--   持ち方は決まっていない。決まるまで中止時の運用ルールは確定させない。

-- -------------------------------------------------------------
-- 4-1b. board_reviews（確認）＝ 第二の目
--
-- 🔴 なぜ shifts の列にしないか。
--   確認は1行ごとではなく「その日その管轄をまとめて」見る作業。
--   61行に1つずつフラグを置くと、確認する側の作業が61倍になる。
-- -------------------------------------------------------------
create table public.board_reviews (
  id              uuid primary key default gen_random_uuid(),
  work_date       date not null,
  jurisdiction_id uuid not null references public.jurisdictions (id),
  reviewed_at     timestamptz not null default now(),
  reviewed_by     uuid not null references public.profiles (id),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- 1日1管轄につき1件
  unique (work_date, jurisdiction_id)
);

comment on table public.board_reviews is
  '確定した配置を別の人が見た記録（第二の目）。reviewed_at より後に配置が変わっていれば「要 再確認」と表示する（shifts/assignments の updated_at と比較）。';

-- -------------------------------------------------------------
-- 4-2. assignments（稼働）＝ 隊員がその日「何をしているか」
--
-- 🔴 自社現場・協力会社への貸出・非現場を1テーブルに統合する（2026-08-28 変更）。
--   これが2つの要件を同時に満たす：
--   ① 応援中と気づかず自社案件に配置する事故を防ぐ
--      → guard_id + work_date で1テーブルを引くだけで全部見える
--   ② 貸出を請求に使える形で抽出できる
--      → kind='lent_out' を期間で絞れば相手先・案件番号・時間・残業が揃う
-- -------------------------------------------------------------
create table public.assignments (
  id                 uuid primary key default gen_random_uuid(),
  guard_id           uuid not null references public.guards (id),
  -- 🔴 日跨ぎは開始日
  work_date          date not null,
  kind               text not null check (kind in ('site', 'lent_out', 'off')),
  shift_id           uuid references public.shifts (id) on delete cascade,

  -- 予定。全 kind 共通で持つ。第1弾で管制が組むのはここ
  planned_start_at   timestamptz,
  planned_end_at     timestamptz,
  planned_break_min  smallint,

  -- 🔴 実績。第1弾では空のまま（requirements.md §8-4 で「それでよい」と決めた）。
  --   予定を実績で上書きすると「予定と違った」が消え、突合も遅刻把握も
  --   請求の根拠も作れなくなる。列が数本増えるだけで、後付けよりはるかに安い。
  actual_start_at    timestamptz,
  actual_end_at      timestamptz,
  actual_break_min   smallint,
  -- 🔴 残業。実績側の値。第1弾では埋まらない（入力経路が未確定・§8-5）
  overtime_min       smallint,
  -- 🔴 実績を誰が入れたか。隊員が「違う」と申告する仕組みは、
  --   元の値の出どころが分からないと成立しない
  actual_source      text check (actual_source in ('leader', 'control', 'stamp')),

  role               text not null default 'member' check (role in ('leader', 'sub', 'member')),
  is_long_distance   boolean not null default false,
  position           smallint not null default 0,   -- プレートの並び順

  -- 貸出（kind='lent_out'）
  lent_to_company_id uuid references public.companies (id),
  external_site_name text,
  external_case_no   text,   -- 🔴 請求の突合キー

  off_kind           text check (off_kind in (
                       'paid_leave', 'training', 'medical', 'absent_self',
                       'absent_company', 'night_duty', 'substitute_holiday',
                       'control', 'office', 'standby')),
  status             text not null default 'planned' check (status in ('planned', 'canceled')),
  -- 🔴 親 shift が確定したかの写し。下のトリガーで同期する。
  --   EXCLUDE 制約は表の外を参照できないため、この列が要る（理由は制約の直前に詳述）。
  is_confirmed       boolean not null default false,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- kind ごとに埋まる列が違う。取り違えを DB で止める
  constraint assignments_kind_shape check (
    case kind
      when 'site'     then shift_id is not null
                       and off_kind is null and lent_to_company_id is null
      when 'lent_out' then lent_to_company_id is not null
                       and shift_id is null and off_kind is null
      when 'off'      then off_kind is not null
                       and shift_id is null and lent_to_company_id is null
    end
  )
);

create index assignments_guard_date_idx on public.assignments (guard_id, work_date);
create index assignments_shift_idx on public.assignments (shift_id);
create index assignments_date_kind_idx on public.assignments (work_date, kind);

comment on column public.assignments.overtime_min is
  '残業（実績側）。🔴 第1弾では埋まらない。入力経路が未確定（requirements.md §8-5）。空であることは想定どおりであり、実装漏れではない。';

-- -------------------------------------------------------------
-- 🔴 重複配置の防止（docs/data-model.md §4-2）
--
-- 「1隊員が同じ日に複数の配置を持つ」ため unique(guard_id, work_date) は張れない
-- （日勤＋夜勤・途中交代がある）。代わりに時間帯の重なりを EXCLUDE で禁じる。
--
-- ✅ アプリ側で重複チェックを書くより単純で、抜け道がない（設計原則1・2）。
-- ✅ 仮組み（draft）の段階では重ねられる。確定したものにだけ効かせる。
--    → 仮組み中は画面で警告を出すにとどめる（配置の自動化は目指さない・8/27 決定）
--
-- 🔴 data-model.md §4-2 のサンプル SQL は start_at / end_at と書かれているが、
--   実際の列は planned_start_at / planned_end_at（予定と実績を分けた 2026-09-01 決定の結果）。
--   ここでは**予定側**で判定する。実績は第1弾では空だから。
--
-- 🔴 時刻が入っていない行は判定対象から外す。
--   tstzrange(null, null) は「無限区間」となり**あらゆる行と重なる**。
--   有給（時刻なし）を1件入れた瞬間にその隊員の全配置が弾かれてしまう。
--   時刻が無ければ重なりは判定できない、が正しい。
-- -------------------------------------------------------------
alter table public.assignments
  add constraint assignments_no_overlap
  exclude using gist (
    guard_id with =,
    (tstzrange(planned_start_at, planned_end_at)) with &&
  )
  where (
    status = 'planned'
    and is_confirmed
    and planned_start_at is not null
    and planned_end_at is not null
  );

-- =============================================================
-- 5-1. ng_entries（NGリスト）★新規
--
-- 🔴 誰も仕様を持っておらず、現在は管制の頭の中にしかない（requirements.md §8-3）。
--   運用開始後に貯める前提で器だけ作る。
-- 🔴 NG は自動で弾かない。severity に応じて画面で警告を出すのが主用途
--   （配置の完全自動化は目指さない・8/27 決定）。
-- =============================================================
create table public.ng_entries (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('site_guard', 'guard_guard')),
  guard_id             uuid not null references public.guards (id) on delete cascade,
  site_id              uuid references public.sites (id) on delete cascade,
  counterpart_guard_id uuid references public.guards (id) on delete cascade,
  reason_kind          text not null default 'other'
                       check (reason_kind in ('supervisor_ng', 'conflict', 'other')),
  reason               text not null,
  severity             text not null default 'warn' check (severity in ('block', 'warn')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint ng_entries_kind_shape check (
    case kind
      when 'site_guard'  then site_id is not null and counterpart_guard_id is null
      when 'guard_guard' then counterpart_guard_id is not null and site_id is null
                          and counterpart_guard_id <> guard_id
    end
  )
);

create index ng_entries_guard_idx on public.ng_entries (guard_id);
create index ng_entries_site_idx on public.ng_entries (site_id);
create index ng_entries_counterpart_idx on public.ng_entries (counterpart_guard_id);

comment on table public.ng_entries is
  '🔴 「人 × 人」は対称として扱う。A と B が不仲なら B と A も不仲。保存は1行とし、検索時に両方向を見る（重複登録を防ぐ）。';

-- =============================================================
-- トリガー
-- =============================================================

-- updated_at の自動更新（touch_updated_at() は 20260901000000 で定義済み）
-- 🔴 board_reviews の「要 再確認」判定は shifts / assignments の updated_at を見る。
--    つまりこのトリガーの付け忘れは、確認が古いまま「確認済み」に見える事故になる。
create trigger jurisdictions_touch  before update on public.jurisdictions  for each row execute function public.touch_updated_at();
create trigger departments_touch    before update on public.departments    for each row execute function public.touch_updated_at();
create trigger companies_touch      before update on public.companies      for each row execute function public.touch_updated_at();
create trigger guards_touch         before update on public.guards         for each row execute function public.touch_updated_at();
create trigger guard_contacts_touch before update on public.guard_contacts for each row execute function public.touch_updated_at();
create trigger customers_touch      before update on public.customers      for each row execute function public.touch_updated_at();
create trigger sites_touch          before update on public.sites          for each row execute function public.touch_updated_at();
create trigger qualifications_touch before update on public.qualifications for each row execute function public.touch_updated_at();
create trigger guard_quals_touch    before update on public.guard_qualifications for each row execute function public.touch_updated_at();
create trigger site_req_quals_touch before update on public.site_required_qualifications for each row execute function public.touch_updated_at();
create trigger shifts_touch         before update on public.shifts         for each row execute function public.touch_updated_at();
create trigger board_reviews_touch  before update on public.board_reviews  for each row execute function public.touch_updated_at();
create trigger assignments_touch    before update on public.assignments    for each row execute function public.touch_updated_at();
create trigger ng_entries_touch     before update on public.ng_entries     for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------
-- shifts.jurisdiction_id は sites から埋める
--
-- 冗長に持つのは引き渡しが「日付 × 管轄」単位だから（data-model.md §4-1）。
-- 手で入れさせると必ずズレるので、常に現場側を正とする。
-- -------------------------------------------------------------
create or replace function public.shifts_fill_jurisdiction()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  select s.jurisdiction_id into new.jurisdiction_id
  from public.sites s where s.id = new.site_id;
  return new;
end;
$$;

create trigger shifts_fill_jurisdiction_trg
  before insert or update of site_id on public.shifts
  for each row
  execute function public.shifts_fill_jurisdiction();

-- -------------------------------------------------------------
-- 確定フラグを assignments へ写す
--
-- 🔴 なぜ写すのか。
--   EXCLUDE 制約は「その表の列」しか見られない。確定の状態は shifts にあるため、
--   参照するには assignments 側に写しが要る。
--   写しを持つ以上は必ずズレるので、**人が入れる余地を残さずトリガーで同期する**。
--
-- 🔴 貸出・非現場（kind='lent_out' / 'off'）は親 shift を持たない。
--   これらは確定という概念が無いので is_confirmed は false のまま。
--   ＝重複判定の対象外。「有給の人が現場に入っている」は
--   時間帯の重なりではなく**画面の警告**で拾う（自動で弾かない・8/27 決定）。
-- -------------------------------------------------------------
create or replace function public.sync_assignment_confirmed()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  update public.assignments a
     set is_confirmed = (new.status = 'confirmed')
   where a.shift_id = new.id
     and a.is_confirmed <> (new.status = 'confirmed');
  return null;
end;
$$;

create trigger shifts_sync_assignment_confirmed
  after update of status on public.shifts
  for each row
  when (old.status is distinct from new.status)
  execute function public.sync_assignment_confirmed();

-- 新しく足した稼働にも、その時点の親の状態を写す
create or replace function public.assignment_inherit_confirmed()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if new.shift_id is not null then
    select (s.status = 'confirmed') into new.is_confirmed
    from public.shifts s where s.id = new.shift_id;
  else
    new.is_confirmed := false;
  end if;
  return new;
end;
$$;

create trigger assignments_inherit_confirmed
  before insert or update of shift_id on public.assignments
  for each row
  execute function public.assignment_inherit_confirmed();

-- -------------------------------------------------------------
-- 確定後に配置が変わったら shifts.changed_after_confirm を立てる
--
-- ShiftMax へ再度引き渡す必要があることを示す（要 再引き渡し）。
-- board_reviews の「要 再確認」と同じ考え方。
--
-- 🔴 DELETE では NEW が未割当。PL/pgSQL は NEW.列 を触った時点でエラーになる
--   （coalesce(new.x, old.x) と書いても評価前に落ちる）。TG_OP で分ける。
-- 🔴 プレートを別の枠へ動かすと shift_id が変わる。**動かした先と元の両方**を
--   立てないと、人が減ったほうの枠が「変更なし」のまま引き渡される。
-- -------------------------------------------------------------
create or replace function public.mark_shift_changed_after_confirm()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  targets uuid[];
begin
  if tg_op = 'DELETE' then
    targets := array[old.shift_id];
  elsif tg_op = 'INSERT' then
    targets := array[new.shift_id];
  else
    targets := array[old.shift_id, new.shift_id];
  end if;

  update public.shifts
     set changed_after_confirm = true
   where id = any (targets)
     and status = 'confirmed'
     and not changed_after_confirm;

  return null;
end;
$$;

create trigger assignments_mark_shift_changed_ins_del
  after insert or delete on public.assignments
  for each row
  execute function public.mark_shift_changed_after_confirm();

-- 🔴 列を絞る理由：上の sync_assignment_confirmed() は is_confirmed だけを更新する。
--   これを拾ってしまうと、**枠を確定した瞬間に「確定後に変更あり」が立つ**
--   （確定 → is_confirmed を写す → その UPDATE を変更とみなす、の自己ループ）。
--   `update of <列>` は「その列が UPDATE 文に現れたとき」だけ発火するため、
--   is_confirmed のみの更新では発火しない。
create trigger assignments_mark_shift_changed_upd
  after update of
    guard_id, shift_id, work_date, kind,
    planned_start_at, planned_end_at, planned_break_min,
    role, is_long_distance, position, status,
    lent_to_company_id, external_site_name, external_case_no, off_kind, note
  on public.assignments
  for each row
  execute function public.mark_shift_changed_after_confirm();

-- =============================================================
-- RLS（requirements.md §6 S-2：全テーブルで有効化）
--
-- 権限の割り当ては requirements.md §3 の表に対応させる：
--   ・閲覧                     … is_staff()  … control / office / admin
--   ・配置の編集                … can_edit()  … control / admin（事務は閲覧＋出力のみ）
--   ・ShiftMax 由来マスタの編集  … is_admin()  … §3「マスタ一括取込は admin」
--   ・新規マスタの編集           … can_edit()  … §3「NG／資格／協力会社マスタの編集」は control
--
-- 🔴 ここが最後の砦。requireRole() は関門、proxy.ts は導線であって認可ではない。
-- 🔴 テーブルを追加したら supabase/checks/rls-audit.sql を実行する（0行になること）。
-- =============================================================

-- 全員が読めて、管理者だけが書けるもの（ShiftMax 由来のマスタ）
do $$
declare t text;
begin
  foreach t in array array['jurisdictions', 'departments', 'guards', 'customers', 'sites']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_staff())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_write', t);
  end loop;
end $$;

-- 全員が読めて、管制・管理者が書けるもの
-- （新規マスタ＋配置。§3 で control の権限として明記されているもの）
do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'guard_contacts', 'qualifications', 'guard_qualifications',
    'site_required_qualifications', 'shifts', 'assignments', 'ng_entries', 'board_reviews'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_staff())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_edit()) with check (public.can_edit())',
      t || '_write', t);
  end loop;
end $$;

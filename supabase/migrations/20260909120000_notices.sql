-- =============================================================
-- 一斉連絡（S-03）のテーブル（2026-09-09）
--
-- 🔴 この画面の価値は「送ること」ではない。
--   LINE が繋がらない隊員が約4割（2026-08-27 管制ヒアリング）。
--   **その約4割を取りこぼさないこと**が目的で、送信そのものは第1弾では作らない
--   （2026-08-27 決定：送信チャネル＝独自ツールは作らない）。
--
-- 🔴 暫定方針であり確定ではない（screen-design.md §4-1）。9/16 の管制ヒアリングで詰める。
--   ひっくり返りうるのは「連絡の単位」「テンプレの種類」「当日変更の扱い」。
--   → **そのときに捨てやすい形にしておく**。3テーブルとも他から参照されない末端に置く。
--
-- 適用後：supabase/checks/rls-audit.sql を実行して ✅ 1行になることを確認する
--        （テーブルを3つ増やすため、ポリシーの付け忘れがあると検出される）。
-- =============================================================

-- -------------------------------------------------------------
-- 1. 協力会社の連絡先（メール）
--
-- 🔴 協力会社の隊員へは**所属会社経由**で連絡する（2026-09-09 決定）。
--   本人へ直接送らない。ところが companies は contact_name / contact_phone しか
--   持っておらず、**会社宛てのメールアドレスが無い**。
-- -------------------------------------------------------------
alter table public.companies
  add column if not exists contact_email text;

comment on column public.companies.contact_email is
  '協力会社の連絡先メール。一斉連絡は協力会社の隊員ぶんを会社宛てにまとめて出す。';

-- -------------------------------------------------------------
-- 2. 文面のテンプレート
--
-- 🔴 「毎回手で書くのは論外」（柴山・2026-09-09）。前日連絡・当日変更・中止など
--   場面ごとに持つ。差し込みは {隊員名} {現場名} {開始} {終了} {集合} を想定。
--
-- 🔴 差し込みの記法はアプリ側で解釈する。DB は文字列として持つだけにして、
--   記法を変えたくなったときに DB を触らずに済むようにする。
-- -------------------------------------------------------------
create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- 用途。画面の初期選択を決めるのに使う（区分が増えても DB は変えない想定で text）
  kind        text not null default 'general'
              check (kind in ('advance', 'change', 'cancel', 'general')),
  body        text not null,
  -- 並び順。管制が使う順に並べたい（名前順だと毎回探すことになる）
  sort_order  smallint not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.message_templates is
  '一斉連絡の文面テンプレート（S-03）。kind: advance=前日連絡 / change=当日変更 / cancel=中止。';

-- -------------------------------------------------------------
-- 3. 連絡（1回＝1行）
--
-- 🔴 「大量に残るのはどうなのか」（柴山）への答え：
--   **連絡1回を1行にまとめ、宛先は明細へ逃がす**。一覧で見るのは常にこちらだけ。
--   さらに **保持期間を最初から決めておく**（下の注記）。
--
-- 🔴 「送信済にする」は**自己申告**である。実際の送信は外（LINE・電話）で行うため、
--   システムは「送ったと宣言した」ことしか知らない。それでも二重連絡は防げる。
-- -------------------------------------------------------------
create table if not exists public.notices (
  id              uuid primary key default gen_random_uuid(),
  -- 対象の絞り込み条件。あとから「何に対する連絡だったか」を読めるようにする
  work_date       date not null,
  jurisdiction_id uuid not null references public.jurisdictions (id),
  shift_group     text not null check (shift_group in ('day', 'night')),
  kind            text not null default 'advance'
                  check (kind in ('advance', 'change', 'cancel', 'general')),
  -- 実際に送った文面（テンプレは後から変わるので、そのときの本文を写して持つ）
  body            text not null,
  template_id     uuid references public.message_templates (id) on delete set null,
  -- 宛先の内訳。明細を消したあとも件数だけは残る
  target_count    smallint not null default 0,
  reachable_count smallint not null default 0,
  phone_count     smallint not null default 0,
  company_count   smallint not null default 0,
  sent_at         timestamptz,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index notices_date_idx on public.notices (work_date desc);

comment on table public.notices is
  '一斉連絡の履歴（1回＝1行）。sent_at は自己申告（実際の送信は外で行うため）。';

-- 🔴 保持期間：**13か月**。請求（第2弾）が1年サイクルで遡ることがあるため12か月では足りず、
--   1か月ぶんの余裕を足した。自動削除は入れていない（pg_cron を持ち込まない判断）。
--   → 古い履歴の削除は運用で行う。消す SQL は supabase/checks/ ではなく README に置く。

-- -------------------------------------------------------------
-- 4. 宛先の明細
--
-- 🔴 誰に送ったかが残らないと、取りこぼしも二重連絡も追えない。
--   一方でここが一番増えるので、**明細だけ先に消せる**ように親と分けてある。
-- -------------------------------------------------------------
create table if not exists public.notice_targets (
  id         uuid primary key default gen_random_uuid(),
  notice_id  uuid not null references public.notices (id) on delete cascade,
  guard_id   uuid not null references public.guards (id) on delete cascade,
  -- どの経路で出したか。line=LINE可 / phone=LINE不可（電話リスト） / company=協力会社経由
  channel    text not null check (channel in ('line', 'phone', 'company')),
  -- channel='company' のときの宛先会社
  company_id uuid references public.companies (id),
  created_at timestamptz not null default now(),
  unique (notice_id, guard_id)
);

create index notice_targets_notice_idx on public.notice_targets (notice_id);

-- -------------------------------------------------------------
-- 5. RLS
--
-- 🔴 連絡を作るのは管制（配置を組んだ人）。事務は見るだけ。
--   配置系（shifts / assignments）と同じ can_edit() に揃える。
-- -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['message_templates', 'notices', 'notice_targets']
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

-- -------------------------------------------------------------
-- 6. テンプレートの初期値
--
-- 🔴 中身は**仮**。9/16 に管制から実物の文面をもらって差し替える。
--   空で始めると「テンプレを選ぶ」体験そのものが確認できないため、3本だけ置く。
-- -------------------------------------------------------------
insert into public.message_templates (name, kind, body, sort_order)
select * from (values
  ('前日連絡', 'advance',
   E'{隊員名} さん\n\n明日の勤務をご連絡します。\n現場：{現場名}\n時間：{開始}〜{終了}\n集合：{集合}\n\nよろしくお願いします。', 1),
  ('当日変更', 'change',
   E'{隊員名} さん\n\n本日の勤務に変更があります。\n現場：{現場名}\n時間：{開始}〜{終了}\n集合：{集合}\n\nご確認をお願いします。', 2),
  ('中止連絡', 'cancel',
   E'{隊員名} さん\n\n本日の下記の現場は中止となりました。\n現場：{現場名}\n\n出勤は不要です。よろしくお願いします。', 3)
) as v(name, kind, body, sort_order)
where not exists (select 1 from public.message_templates);

-- 確認用（この文の結果を目視する）
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('message_templates', 'notices', 'notice_targets')
order by tablename, cmd;

-- 得意先の担当コードを任意にする（2026-11-16・赤尾さんの回答 ⑦）
--
-- 🔴 なぜ任意にするのか
--   新しい得意先は「案件が先にでき、稼働が始まってからべんり君に登録される」。
--   担当コードはべんり君（ShiftMax）側で登録のときに自動で振られるので、
--   **先に入力するこのシステムではコードを知りようがない**。
--   NOT NULL のままだと、管制は新しい得意先の現場を作れなかった。
--
-- 🔴 一意（unique）はそのまま残す。PostgreSQL の unique は NULL どうしを重複とみなさないので、
--   「コード無しは何件でも可・入っているコードは重複不可」になる。
--
-- 🔴 空文字（''）は入れさせない。アプリ側で null に寄せているが、
--   '' が入ると「コード無し」が2件目で一意制約に当たり、日本語でない失敗になる。
--
-- 影響：コードの無い得意先は引き渡し（18列）で警備先番号を引けない。
--   引き渡しの画面は既に「警備先番号が見つからない枠」で止まる作り（src/lib/handoff.ts）。

alter table public.customers
  alter column staff_code drop not null;

-- 既存行に '' は無いはず（NOT NULL 時代もアプリが空欄を止めていた）。念のため null に寄せてから制約を足す
update public.customers set staff_code = null where staff_code = '';

alter table public.customers
  add constraint customers_staff_code_not_blank check (staff_code is null or btrim(staff_code) <> '');

comment on column public.customers.staff_code is
  '担当コード（ShiftMax の実質キー）。べんり君で登録されたときに振られるため、それまでは null（2026-11-16）。';

-- ─────────────────────────────────────────────────────────
-- 確認クエリ（本番で流したら数字を見る）
--   ① is_nullable が YES
--   ② 制約 customers_staff_code_not_blank が1行
--   ③ コード無しの得意先の件数（流した直後は 0）
-- ─────────────────────────────────────────────────────────
-- select is_nullable from information_schema.columns
--  where table_schema = 'public' and table_name = 'customers' and column_name = 'staff_code';
-- select conname from pg_constraint where conname = 'customers_staff_code_not_blank';
-- select count(*) from public.customers where staff_code is null;

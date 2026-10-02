-- =============================================================
-- 班名（band_name）を消す（2026-10-02）
--
-- 🔴 なぜ消すのか
--   9/9 に「べんり君の入力欄（管制雛形 D〜U列）と投入CSV 5列目にあるから」という理由で足した。
--   **入れ物があったから合わせただけで、使われているかは確かめていなかった。**
--   実データでは使われていない：
--     ・日次シート（7月 1,899行）で班名が入っている行は 0行（10/2 集計）
--     ・ShiftMax 勤務マスターの班名欄は全行 空（data-gap-20260917.md §2）
--   引き渡し（段3）の投入CSV は5列目を空で出せば足りる。
--
-- 🔴 本番の現場・枠はダミー（2026-10-02 時点）。失って困る値は無い。
--   必要になったら列を足し直して画面に戻すだけでよい。
--
-- 🔴 適用したら**すぐ本番へデプロイする**。
--   旧コードは band_name を読みに行くため、間が空くとボード・週表・現場マスタが開けない。
--
-- 適用後：supabase/checks/rls-audit.sql → ✅ 1行（テーブルは増えていない）
-- =============================================================

alter table public.sites  drop column if exists band_name;
alter table public.shifts drop column if exists band_name;

-- 確認用（0行なら成功）
select table_name, column_name
from information_schema.columns
where table_schema = 'public' and column_name = 'band_name';

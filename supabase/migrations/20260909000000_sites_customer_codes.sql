-- =============================================================
-- 現場マスタに ShiftMax の不足2列を足す（2026-09-09）
--
-- 🔴 なぜ足すのか
--   ShiftMax の勤務マスターは 25項目（shiftmax-api-analysis.md §7-2）。
--   突き合わせたところ、こちらが持っていないのは次の2つだけだった。
--     O 顧客コード / P 得意先番号
--   どちらも**得意先マスター（11項目）には無く、勤務マスターにしか無い**。
--   ＝ 得意先側へ寄せると出どころが変わってしまうため、**現場が持つ**のが忠実。
--
-- 🔴 いま足す理由
--   マスタの CSV 取込（実データ 1,593件）で、この2列は**取り込む先が無いと落ちる**。
--   取込を作ってから列を足すと、取込コードとマイグレーションを2回書くことになる。
--
-- ⚠️ 第1弾の投入CSV（18列）にはこの2列は含まれない。
--   使うのは**第2弾（請求）**か、取込の突き合わせ。いまは「持つだけ」でよい。
--
-- 適用後：supabase/checks/rls-audit.sql を実行して ✅ 1行になることを確認する
--        （テーブルは増えていないので既存ポリシーがそのまま効く）。
-- =============================================================

alter table public.sites
  add column if not exists customer_code text,
  add column if not exists customer_no   text;

comment on column public.sites.customer_code is
  '顧客コード（ShiftMax 勤務マスター O列）。得意先マスターには無い列。';
comment on column public.sites.customer_no is
  '得意先番号（ShiftMax 勤務マスター P列）。担当コード（customers.staff_code）とは別物。';

-- 確認用（この文の結果を目視する）
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'sites'
order by ordinal_position;

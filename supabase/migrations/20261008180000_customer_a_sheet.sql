-- =============================================================
-- 得意先に「A表の紙（東京本部／神奈川支部）」を持たせる（2026-10-08）
--
-- 🔴 なぜ要るか
--   A表の日勤は**東京本部と神奈川支部で別の紙**、夜勤は1枚に上下で並べる（10/7 A表の実物）。
--   神奈川支部の紙は**場所ではなく得意先で分けている**（管制・2026-10-08）。
--   神奈川の紙に東京の現場が載っている＝住所や管轄からは決められない。
--
-- 🔴 管轄（jurisdiction）とは別物。べんり君では神奈川の現場も東京の管轄で入力している。
--   管轄を分けると配置ボードが別の画面に割れるので、管轄は触らず、**A表の分け方だけ**をここに持つ。
--   配置ボードでは使わない（見やすさ優先・柴山）。
--
-- 🔴 どの得意先が神奈川かは、このファイルには書かない（取引先名を Git に残さない）。
--   本番では別に SQL を流して設定し、以後は得意先の画面で直す。
-- =============================================================

alter table public.customers
  add column if not exists a_sheet text not null default 'tokyo'
  check (a_sheet in ('tokyo', 'kanagawa'));

comment on column public.customers.a_sheet is
  'A表の紙。tokyo=東京本部 / kanagawa=神奈川支部（2026-10-08）。週表の分け方にだけ使う。管轄とは別';

-- 確認用（1 が出れば列ができている）
select count(*) as a_sheet_column
  from information_schema.columns
 where table_schema = 'public' and table_name = 'customers' and column_name = 'a_sheet';

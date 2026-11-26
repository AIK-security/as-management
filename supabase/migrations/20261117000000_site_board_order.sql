-- 現場の並び順（2026-11-17・赤尾さんの要望②）
--
-- 🔴 なぜ要るのか
--   配置ボードの得意先の中は開始時刻順、週表は現場名順で、管制が並びを決められなかった。
--   管制は「いつもの順」でカードを見ている（紙の A表の並び）。
--
-- 🔴 現場に持たせる（枠には持たせない）。並べた順は毎日同じでよい（11/16 の既定・赤尾さんに未確認）。
--   日ごとに変えたいと言われたら、そのときに枠側へ移す。
--
-- 🔴 番号は得意先の中での順。null は「まだ決めていない」＝これまでどおり
--   （配置ボードは開始時刻順、週表は現場名順）で、番号のある現場の後ろに並ぶ。
--   振り直しはアプリ（reorderSites）が得意先の現場すべてに 1,2,3… と振る。
--
-- 影響：列を足すだけ。既存の行は null のまま＝見た目は変わらない。
--   sites の update ポリシー（can_edit）がそのまま効くので、ポリシーの追加は要らない。

alter table public.sites
  add column if not exists board_order integer
    check (board_order is null or board_order > 0);

comment on column public.sites.board_order is
  '得意先の中での並び順（2026-11-17）。null=未設定（配置ボードは開始時刻順・週表は現場名順で後ろに並ぶ）。';

-- ─────────────────────────────────────────────────────────
-- 確認クエリ（本番で流したら数字を見る）
--   ① data_type が integer・is_nullable が YES
--   ② 番号のある現場の件数（流した直後は 0）
-- ─────────────────────────────────────────────────────────
-- select data_type, is_nullable from information_schema.columns
--  where table_schema = 'public' and table_name = 'sites' and column_name = 'board_order';
-- select count(*) from public.sites where board_order is not null;

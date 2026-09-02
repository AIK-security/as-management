-- =============================================================
-- assignments.role を「隊長 / それ以外」の2値にする（2026-09-02）
--
-- 🔴 なぜ減らすのか
--   8/27 の管制ヒアリングでは配置の判断基準として
--   「**隊長・リーダー・サブ**の割り当て」が挙がっていた（logs/2026-08-27.md）。
--   これを `leader` / `sub` / `member` の3値に置いたが、
--   **隊長とリーダーが別物なのか同じものなのかを確認していなかった**。
--
--   柴山の判断（2026-09-02）：**一旦「隊長かそれ以外」でよい**。
--   → 誰も入れない値（`sub`）を CHECK に残すと、
--     後から読む人が「使われていないのか、入れ忘れなのか」で必ず止まる。
--     必要になったら CHECK に1語足すだけで戻せる（設計原則5：捨てやすく作る）。
--
-- 🟠 未決として残る：**リーダー**という役割が実在するか。
--   管制への追加ヒアリング項目（requirements.md §8-7）。
--
-- 🔴 適用済みの 20260902000000_board_core.sql は書き換えない。
--   環境ごとに中身が食い違うため。
-- =============================================================

-- 先に既存データを寄せる。制約を張ってから直すと弾かれる。
update public.assignments set role = 'member' where role = 'sub';

alter table public.assignments
  drop constraint if exists assignments_role_check;

alter table public.assignments
  add constraint assignments_role_check
  check (role in ('leader', 'member'));

comment on column public.assignments.role is
  'leader=隊長 / member=それ以外（2026-09-02）。'
  '🟠 「リーダー」「サブ」を分けるかは未確認。必要なら CHECK に1語足す。';

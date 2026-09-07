-- 枠の中止（2026-09-07・管制からの要望）
--
-- 🔴 なぜ work_kind の dayCancel / nightCancel を使わないか。
--   あの2つのラベルは「日勤現中 / 夜勤現中」＝**現着中止**であり、
--   隊員が現場に着いたあとの中止を指す。稼働が立つ＝請求対象になりうる。
--   ここで表したいのは**行く前の中止**で、隊員はまだ他の現場へ回せる。
--   別のものを同じ列に入れると、ShiftMax への引き渡し（段3）で
--   勤務区分が「現中」として出てしまい、請求が変わる。
--   → 現中の扱いは未決のまま（requirements.md §8-7 ①）。
--
-- 🔴 枠も配置も消さない。「中止になった」という状態を足すだけ。
--   誰を入れていたかが消えると、その人をどこへ回すかの判断ができなくなる。
--   （2026-09-07・管制「配置情報も予定のまま表示し、そこから移動できるとよい」）

alter table public.shifts
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles (id);

comment on column public.shifts.cancelled_at is
  '中止にした時刻。null=中止でない。枠と配置は残したまま状態だけを変える（2026-09-07）。
   現着中止（work_kind の dayCancel/nightCancel）とは別物。';

-- 中止の枠だけを引くことは少ないため、専用の索引は置かない。
-- 取得は常に work_date × jurisdiction_id で絞ったあとなので既存の索引で足りる。

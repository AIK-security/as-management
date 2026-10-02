-- =============================================================
-- 経験（★）を〈隊員 × 現場〉にまとめるビュー（2026-10-02）
--
-- 🔴 なぜ要るのか
--   配置ボードの ★（この現場に入ったことがある）は assignments を過去1年ぶん読んでいた。
--   PostgREST は既定で **1,000行までしか返さない**ため、7月の実データ（配置 2,901件）を入れた時点で
--   約1,900件が**黙って切り捨てられ**、★ が付くはずの隊員に付かなくなった（10/2 発覚）。
--   1年ぶん貯まると配置は数万件になり、全部を毎回読むこと自体が重い。
--   → 〈隊員 × 現場〉ごとに「最初に入った日・最後に入った日」へ畳む（7月分で 535 組）。
--
-- 🔴 写しではなく集計のビュー。表を増やさないので同期の心配が無い（s20-output-design.md §6）。
-- 🔴 security_invoker：読む人の権限（RLS）で元の表を読む。ビュー経由で RLS を素通りさせない。
--
-- 判定（src/lib/board.ts）：最初の日 < 表示日 かつ 最後の日 ≥ 表示日の1年前
--   （1年より前に1回だけ入った人には付かない。従来の「過去1年に1回でも」とほぼ同じ）
-- =============================================================

create or replace view public.guard_site_experience
with (security_invoker = true) as
select a.guard_id,
       s.site_id,
       min(a.work_date) as first_date,
       max(a.work_date) as last_date
  from public.assignments a
  join public.shifts s on s.id = a.shift_id
 where a.kind = 'site'
 group by a.guard_id, s.site_id;

comment on view public.guard_site_experience is
  '〈隊員×現場〉の経験（最初・最後に入った日）。配置ボードの ★ に使う。';

grant select on public.guard_site_experience to authenticated;

-- 確認用（7月分の実データなら 535 前後）
select count(*) as 隊員x現場の組 from public.guard_site_experience;

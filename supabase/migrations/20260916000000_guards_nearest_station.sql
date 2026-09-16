-- 隊員マスタに「最寄り駅」を持たせる（2026-09-16・管制の要望）
--
-- 🔴 これは配置を決めるときの判断材料。
--    「この現場ならあの隊員が近い」は管制の頭の中にしかなく、
--    システムのどこにも置き場が無かった。
--
-- 🔴 ShiftMax（べんり君）の社員マスターには無い列。
--    取込では一切埋まらず、AS が自分で入れていくことになる。
--    → 空のままの隊員が出るのは想定内なので NOT NULL にしない。
--
-- RLS：guards の既存ポリシー（列単位ではない）がそのまま効くため、追加は無い。

alter table public.guards
  add column if not exists nearest_station text;

comment on column public.guards.nearest_station is
  '最寄り駅（2026-09-16）。配置の判断材料。ShiftMax には無い列で、取込では埋まらない。';

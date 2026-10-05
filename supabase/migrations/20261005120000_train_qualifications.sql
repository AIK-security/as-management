-- =============================================================
-- 列車見張の資格（鉄道会社ごと）を足す（2026-10-05）
--
-- 🔴 列車見張は**鉄道会社ごとに別の資格**（2026-10-05 受領の「列車資格更新一覧_2026.xlsx」）。
--   9種類・64名・120件。1人で4〜5社持つ人もいる。
--   交1／交2 と同じ並びで名札に全部出すと、84px の名札からはみ出す。
--
-- 🔴 そこで資格に「区分」を持たせ、列車見張（category = 'train'）だけ出し方を変える（柴山・2026-10-05）：
--   ・枠の中の名札 … **その現場が必要とする鉄道会社のものだけ**出す（site_required_qualifications）
--   ・プール・A表 … 「列5」のように**1つに畳み**、乗せると中身が出る
--   区分を持たない資格（交1・交2 など）は今までどおり全部出す。
--
-- 🔴 名前に会社を入れ、短い表記は会社名だけにする。名札に出るのは
--   「その現場の会社」なので、「列」を付けなくても列車見張だと読める。
-- =============================================================

alter table public.qualifications
  add column if not exists category text check (category in ('train'));

comment on column public.qualifications.category is
  'train=列車見張（鉄道会社ごと）。名札では現場が必要とするものだけ出し、プールでは「列N」に畳む。null=今までどおり全部出す。';

insert into public.qualifications (code, name, short_label, has_expiry, category) values
  ('q-train-tokyu',     '列車見張（東急電鉄）',     '東急',   true, 'train'),
  ('q-train-keio',      '列車見張（京王電鉄）',     '京王',   true, 'train'),
  ('q-train-odakyu',    '列車見張（小田急電鉄）',   '小田急', true, 'train'),
  ('q-train-keikyu',    '列車見張（京急電鉄）',     '京急',   true, 'train'),
  ('q-train-sotetsu',   '列車見張（相模鉄道）',     '相鉄',   true, 'train'),
  ('q-train-jr',        '列車見張（JR）',           'JR',     true, 'train'),
  ('q-train-enoden',    '列車見張（江ノ島電鉄）',   '江ノ電', true, 'train'),
  ('q-train-yokohama',  '列車見張（横浜高速鉄道）', '横高',   true, 'train'),
  ('q-train-tobishima', '列車見張（飛島建設）',     '飛島',   true, 'train')
on conflict (code) do nothing;

-- 確認用（9行出れば成功）
select code, name, short_label, category from public.qualifications
 where category = 'train' order by code;

-- =============================================================
-- マスタを管制が編集できるようにする（2026-09-08）
--
-- 🔴 何を変えるのか
--   ShiftMax 由来のマスタ（jurisdictions / departments / guards / customers / sites）は
--   これまで **書き込みが admin 限定**だった（20260902000000_board_core.sql）。
--   これを **can_edit()（管制・管理者）** に開放する。
--
-- 🔴 なぜ変えるのか（2026-09-08・柴山の判断）
--   「いま作っている段階のものは、管制が追加・編集・削除を含む全ての操作を行える」。
--
--   実際に穴が空いていた：9/7 に「現場を追加」で仮番号（TMP-）の現場を
--   管制が作れるようにしたが、**その番号を本物の警備先番号に直すのは admin 限定**
--   だった。作れるのに直せない＝いちばん急いでいる場面で手が止まる。
--
-- ⚠️ 元の意図（取込済みマスタを書き換えると引き渡しの突き合わせが壊れる）は
--   消えたわけではない。**運用でどう守るかは、実データを入れる段で決め直す。**
--   その判断が要るときに、このコメントに戻ってくること。
--
-- 🔴 profiles は変えない。
--   ロールの付け替え（＝自分を admin にできてしまう）は業務の話ではなく
--   権限の境界そのもの。ここを開けると3枚重ねの意味が無くなる。
--
-- 適用後：supabase/checks/rls-audit.sql を実行して ✅ 1行になることを確認する。
-- =============================================================

-- -------------------------------------------------------------
-- 1. 一括で admin 限定だったもの（sites を除く4つ）
--    ※ sites は 20260907120000 で insert/update/delete に分かれているため下で扱う
-- -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['jurisdictions', 'departments', 'guards', 'customers']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_edit()) with check (public.can_edit())',
      t || '_write', t);
  end loop;
end $$;

-- -------------------------------------------------------------
-- 2. sites（insert は既に can_edit()。update / delete を揃える）
-- -------------------------------------------------------------
drop policy if exists sites_update on public.sites;
create policy sites_update on public.sites
  for update to authenticated
  using (public.can_edit())
  with check (public.can_edit());

drop policy if exists sites_delete on public.sites;
create policy sites_delete on public.sites
  for delete to authenticated
  using (public.can_edit());

-- -------------------------------------------------------------
-- 3. 確認用（この文の結果を目視する）
--    期待：ShiftMax 由来マスタの書き込み系がすべて can_edit() になっていること
-- -------------------------------------------------------------
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('jurisdictions', 'departments', 'guards', 'customers', 'sites')
order by tablename, cmd, policyname;

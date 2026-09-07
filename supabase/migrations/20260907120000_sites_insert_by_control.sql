-- 管制が新規現場を作れるようにする（2026-09-07）
--
-- 🔴 これは要件の変更にあたる。
--   requirements.md §3 では sites を「ShiftMax 由来のマスタ」として扱い、
--   編集を admin に限っていた（一括取込で入るものだから）。
--
--   しかし 2026-09-07 に前提が変わった。管制からの指摘：
--   **AIK assign が使われなくなった大きな原因が「忙しい中、案件を
--   いちいち作るのが面倒」だった。**
--   新しい仕事が入ったときに現場を作れるのが admin だけでは、
--   いちばん急いでいる場面で管制の手が止まる。第1弾の効果に直接効く。
--
-- 🔴 ただし「作れる」と「既存を書き換えられる」は分ける。
--   ・INSERT          … can_edit()（control / admin）… 新しい現場を作る
--   ・UPDATE / DELETE … is_admin()                  … 取込済みの値を守る
--   ShiftMax から取り込んだマスタを管制が書き換えられると、
--   引き渡し（段3）の突き合わせが壊れる。増やすのは許し、変えるのは許さない。
--
-- 🔴 SELECT は既存の sites_select（is_staff）のまま。ここでは触らない。

drop policy if exists sites_write on public.sites;

create policy sites_insert on public.sites
  for insert to authenticated
  with check (public.can_edit());

create policy sites_update on public.sites
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy sites_delete on public.sites
  for delete to authenticated
  using (public.is_admin());

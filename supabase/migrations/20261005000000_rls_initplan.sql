-- =============================================================
-- RLS の権限確認を「1行ごと」から「1問い合わせに1回」へ（2026-10-05）
--
-- 🔴 なぜ要るのか
--   ポリシーが `using (public.is_staff())` の形で書かれており、
--   security definer の関数はインライン展開されないため、**読む行ごとに呼ばれる**。
--   呼ばれるたびに profiles を引き直す（current_app_role()）。
--   8・9月分を入れて配置が約8,500件になったところで、経験（★）のビュー
--   guard_site_experience が 1回 2.1秒（explain analyze・2026-10-05 実測）になり、
--   配置ボードの日付送りが目に見えて遅くなった。ダミーや7月分の規模では出なかった。
--
-- 🔴 直し方は Supabase の推奨どおり、関数呼び出しを `(select ...)` で包む。
--   副問い合わせにすると initPlan として**1回だけ**評価され、結果を全行で使い回す。
--   誰が何を見られるか（権限の中身）は変わらない。
--
-- 🔴 ポリシーは7本のマイグレーションに散らばり、format() でまとめて作ったものもある。
--   1本ずつ書き直すと漏れるので、**いま DB にあるポリシーを pg_policies から読んで**
--   書き換える。既に (select ...) を含むものは触らない（2回流しても二重に包まない）。
--
-- 🔴 これから作るポリシーは最初から `(select public.is_staff())` の形で書くこと。
-- =============================================================

do $$
declare
  p   record;
  q   text;
  wc  text;
  pat constant text := '(public\.)?(is_staff|can_edit|is_admin)\(\)|auth\.uid\(\)';
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
  loop
    q  := p.qual;
    wc := p.with_check;

    if q is not null and q !~* 'select' and q ~ pat then
      q := regexp_replace(q, '(public\.)?(is_staff|can_edit|is_admin)\(\)', '(select public.\2())', 'g');
      q := regexp_replace(q, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    else
      q := null;   -- 変えない
    end if;

    if wc is not null and wc !~* 'select' and wc ~ pat then
      wc := regexp_replace(wc, '(public\.)?(is_staff|can_edit|is_admin)\(\)', '(select public.\2())', 'g');
      wc := regexp_replace(wc, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    else
      wc := null;
    end if;

    if q is not null and wc is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)',
                     p.policyname, p.schemaname, p.tablename, q, wc);
    elsif q is not null then
      execute format('alter policy %I on %I.%I using (%s)',
                     p.policyname, p.schemaname, p.tablename, q);
    elsif wc is not null then
      execute format('alter policy %I on %I.%I with check (%s)',
                     p.policyname, p.schemaname, p.tablename, wc);
    end if;
  end loop;
end $$;

-- 確認用（0行なら、包まれていない呼び出しは残っていない）
select tablename, policyname, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and (   (qual       ~ '(is_staff|can_edit|is_admin)\(\)|auth\.uid\(\)' and qual       !~* 'select')
        or (with_check ~ '(is_staff|can_edit|is_admin)\(\)|auth\.uid\(\)' and with_check !~* 'select'));

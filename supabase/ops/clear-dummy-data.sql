-- =============================================================
-- ダミーデータを消す（実データへの切り替え用・2026-10-02）
--
-- 手順書：docs/cutover-runbook.md（この SQL は手順 2）
--
-- 🔴 一度きり。実データを入れた後に流すと**実データが消える**。
--   流す前に、配置ボードに架空の現場名（「アルファ 跨線橋」など）が出ていることを確かめる。
--
-- 🔴 残すもの（消さない）
--   ・profiles           … ログインユーザー（管制・事務・管理者）
--   ・message_templates  … 一斉連絡のテンプレート（管制が作ったものを含む）
--   ・qualifications     … 資格の種類（交1・交2・雑2・施2）。実データの資格一覧を受け取ったら足す
--   ・companies の自社   … 社員マスターの取込が「自社」を必要とする（kind='own'）
--
-- 🔴 管轄・部署も消す。取込が CSV のコードと名前から作り直す
--   （ダミーの部署コード 101/102/201 は実データ 0〜9 と違い、残すと空の部署が並ぶ）。
--
-- cascade は使わない（消える範囲を明示する ─ ダミー投入 SQL と同じ方針）。
-- 失敗したら全部取り消される（begin〜commit）。
-- =============================================================

begin;

truncate table
  public.notice_targets,
  public.notices,
  public.assignments,
  public.ng_entries,
  public.board_reviews,
  public.shifts,
  public.site_required_qualifications,
  public.guard_qualifications,
  public.guard_contacts,
  public.sites,
  public.guards,
  public.customers,
  public.duty_codes;

-- 協力会社はダミー。自社だけ残す
delete from public.companies where kind <> 'own';

-- 管轄・部署（取込で作り直す）
delete from public.departments;
delete from public.jurisdictions;

-- 現場コードの採番を AS0001 から始め直す
alter sequence public.sites_code_seq restart with 1;

-- 確認用（この結果を目視する：残すもの以外は 0）
select
  (select count(*) from public.profiles)          as ユーザー_残す,
  (select count(*) from public.message_templates) as テンプレート_残す,
  (select count(*) from public.qualifications)    as 資格_残す,
  (select count(*) from public.companies)         as 会社_自社1件,
  (select count(*) from public.jurisdictions)     as 管轄_0,
  (select count(*) from public.sites)             as 現場_0,
  (select count(*) from public.guards)            as 隊員_0,
  (select count(*) from public.shifts)            as 枠_0;

commit;

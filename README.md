# AS 向け社内システム構築プロジェクト

グループ会社 **And Security（AS）** の管制・労務業務を対象とした社内システムを構築するプロジェクト。

## 目的

- AS の管制・給与計算等の労務業務における**負荷軽減・工数削減・アナログ作業の撲滅**
- 属人化した業務の解消
- 既存利用システムからインハウスシステムへの置き換え

## 現在のステータス

**開発フェーズ 段1**（2026-08-31 着手）

🔴 **要件の正本は `docs/requirements.md`。** 全体像（第1〜3弾）・権限・非機能・セキュリティ・完成条件はここ。
着手判断は `docs/gap-analysis.md`、実装順は `docs/screen-design.md` §9。

| | 決定内容 |
|---|---|
| 構築方式 | **①スクラッチ**（`docs/architecture-decision.md`） |
| スタック | Next.js 16 / React 19 / TypeScript 5 / Tailwind 4 / Supabase / @dnd-kit |
| 第1弾スコープ | **管制（配置管理）のみ**。請求・労務は第2弾 |
| 実装順 | `docs/screen-design.md` §9（段1〜7） |
| スケジュール | `docs/schedule-plan.md`（v2.0・2027/1/12 完全移行） |

### 認証・ロール（2026-09-01）

- Supabase Auth（招待制・自由サインアップ無し）／ロール `admin` `control` `office`
  - 🔴 **ロール名は所属ではなく権限の束。** `control` ＝「配置を編集できる人」<br>（管制メンバー全員＋事務の確認担当）
  - 退職・異動は**削除せず `profiles.is_active=false`**（削除すると監査ログを辿れない）
- **認可は3枚重ね**：RLS（最後の砦）／`requireRole()`（関門）／`proxy.ts`（導線）
- ✅ 実 DB へ適用済。ログイン〜`/board` 到達まで動作確認済
- 🟠 **未検証**：`office`（事務）ロールで編集ボタンが消えること

### 段1（表示のみ）の到達点

- `S-01` 配置ボード（1日 × 管轄 × 日勤/夜勤）の**表示**
- 隊員プレート（資格・経験・NG・協力会社・隊長）
  - 🔴 **記号の意味は `docs/screen-design.md` §2-4b が正本**
- 仮組み／確定の表示、未充足枠、警告一覧
- 🔴 **D&D と確定操作は段2-③**（未着手）

---

## 開発サーバ

```bash
npm install
npm run dev        # http://localhost:3000 → /board へリダイレクト
npm run build      # 本番ビルド
npm run lint
```

### 🔴 ログイン後に `HTTP ERROR 431` が出たら

**Request Header Fields Too Large。** 認証の失敗ではなく **Cookie の量**の問題。

**Cookie はポートで分離されない。** `localhost` は警備番頭など他プロジェクトと共有されるため、
Supabase の認証 Cookie（1プロジェクト 6〜7KB・JWT がチャンク分割される）が積み上がり、
Node の既定上限 16KB を超える。

| 対処 | 内容 |
|---|---|
| 恒久 | `npm run dev` を `node --max-http-header-size=32768` 経由で起動する（**対応済**） |
| 都度 | ブラウザで `localhost` の Cookie を消す（DevTools > Application > Cookies > localhost） |

> ⚠️ これは **localhost だけの現象**。本番は独自ドメインで動くため他プロジェクトと Cookie を共有しない。
> 逆に、**このアプリ単体の Cookie が 16KB に近づいたらそれは本物の不具合**（本番でも壊れる）。

---

> 🔴 **データはすべてダミー。** 氏名・現場名・得意先名は架空。
> **本番データは持ち込まない**（CLAUDE.md）。
> 規模だけは実測に寄せてある（現場42件・隊員104名・プレート75枚／平均2.0名/枠）。
> 密度が違うと画面設計の検証にならないため。
> 投入するのは `supabase/seed/20260902_dummy_board.sql`（下記 4-2）。

---

## 旧ステータス（参考）

構築方式は 2026-08-28 に①スクラッチで確定。以下は判断前の記述。

1. **スクラッチ**（現時点で有力）
2. AIK assign ベース（自社提供の管制システムを流用）
3. 既製 SaaS + 差分内製

> ⚠️ AS は過去に AIK assign の開発に関与したが、ほぼ利用されず離脱した経緯がある。
> **同じ失敗を繰り返さないこと**が本プロジェクトの最重要課題。

## 直近の予定

| 日付 | 内容 |
|---|---|
| 2026-08-26（水） | AS 全体MTG（管制・事務 全員） |
| 8/26 以降 | 個別ヒアリング |
| 9月上旬 | 構築方式の決定・スケジュール確定 |

## ドキュメント

| ファイル | 役割 |
|---|---|
| [`docs/mtg-agenda-20260826.md`](docs/mtg-agenda-20260826.md) | 全体MTG の進行台本・趣旨説明台本 |
| [`docs/hearing-sheet.md`](docs/hearing-sheet.md) | 個別ヒアリングシート（印刷して使用） |
| [`docs/vendor/tech-stack-checklist.md`](docs/vendor/tech-stack-checklist.md) | AIK assign 技術情報の確認リスト＋保守会社への依頼文 |
| [`docs/roi-estimate.md`](docs/roi-estimate.md) | ROI 試算枠 ⚠️**経営層限定** |
| [`docs/vendor/inhouse-maintenance-plan.md`](docs/vendor/inhouse-maintenance-plan.md) | 旧目的（AIK assign 保守内製化）の検討メモ。方式②の参照資料 |

## セットアップ

### 1. 依存のインストール

```bash
npm install
```

### 2. Supabase プロジェクトを作る

[app.supabase.com](https://app.supabase.com) で新規プロジェクトを作成する（リージョンは `Northeast Asia (Tokyo)`）。

### 3. 環境変数

`.env.example` をコピーして `.env.local` を作り、
**Supabase ダッシュボード > Project Settings > API** の値を入れる。

| キー | 取得場所 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key（**サーバ側専用**。ブラウザに出さない） |

> 🔴 `.env.local` は `.gitignore` 対象。**実値をコミットしない**（`docs/requirements.md` §6 S-3）。
> 🔴 べんり君（ShiftMax）の共有アカウントは**ここにも書かない**。新システムは ShiftMax と通信しない。

### 4. マイグレーションの適用

`supabase/migrations/` の SQL を、**古い順に** Supabase ダッシュボード > SQL Editor に貼って実行する。

> Docker が入っていないため `supabase start`（ローカルスタック）は使わない。
> CLI で流す場合は `npx supabase link --project-ref <ref>` のあと `npx supabase db push`。

| 順 | ファイル | 中身 |
|---|---|---|
| 1 | `20260901000000_auth_roles.sql` | `profiles`・4ロール・RLS ヘルパー・招待トリガー |
| 2 | `20260901120000_profiles_is_active.sql` | 退職・異動を「削除しない」で止めるための `is_active` |
| 3 | `20260902000000_board_core.sql` | 🔴 **配置ボードの中核**（マスタ＋`shifts`＋`assignments`＋NG＋RLS） |
| 4 | `20260902120000_assignment_role_simplify.sql` | 役割を「隊長 / それ以外」の2値に（`sub` を廃止） |
| 5 | `20260903000000_assignment_planned_times.sql` | 🔴 **配置の予定時刻を枠から自動で埋める**（重複防止の EXCLUDE 制約が見る列。空だと重複判定が黙って無効になる） |
| 6 | `20260903120000_revert_shift_to_draft_on_change.sql` | 🔴 **確定後に配置が変わったら枠を仮組みへ戻す**（`changed_after_confirm` 列と「要 再引き渡し」バッジは廃止） |

適用できたかは `supabase/checks/verify-setup.sql` を SQL Editor で実行して確かめる。
**`result` 列がすべて ✅ になること。**

### 4-2. ダミーデータの投入（開発環境のみ）

`supabase/seed/20260902_dummy_board.sql` を SQL Editor に貼って実行する。
**何度流しても同じ状態になる**（先頭で `truncate` する）。

🔴 **氏名・現場名・得意先名はすべて架空。** 本番データは持ち込まない。
規模だけ実測に寄せてある（現場42件／隊員104名／プレート75枚・平均2.0名/枠）。

🔴 **同じ隊員を同じ時間帯の2枠に入れたデータは作らない**（2026-09-04）。
DB の `assignments_no_overlap` が拒否するため、入っていると**一括確定が通らない**。
以前は必要人数が平均3.3名（実測は1.7名）で 104名では足りず、
生成側が隊員を使い回して重なりを作っていた。
密度が現実と違うと画面設計の検証にならないため。

このファイルは**手で編集しない**。生成元は `scripts/dummy-data.mts` で、
作り直すときは次を実行する：

```bash
node --experimental-strip-types scripts/gen-seed.mts
```

### 5. 初期ユーザーを作る（2手）

🔴 **ダッシュボードの「Create new user」には User Metadata の入力欄が無い**
（Email / Password / Auto confirm のみ）。メタデータを渡せるのは Admin API 経由だけなので、
招待トリガーには頼らず、**作成してからロールを付ける**。

1. **Authentication > Users > Add user > Create new user**
   - Email / Password を入れる
   - **「Auto confirm user?」に ✅**（確認メールを挟まない）
2. **SQL Editor** で `supabase/scripts/assign-role.sql` を開き、
   先頭の【ここを書き換える】をメール・ロール・氏名に直して実行する

`role` は `admin`（管理者）／`control`（管制）／`office`（事務）のいずれか。
それ以外は CHECK 制約で弾かれる。

🔴 **2 を忘れると `profiles` が作られず、ログインは通るのに `/no-access` で止まる。**

### 退職・異動でアカウントを止める

```sql
update public.profiles set is_active = false
where id = (select id from auth.users where email = 'user@example.com');
```

🔴 **ユーザーを削除しない。** `profiles.id` は `auth.users` へ `on delete cascade` のため、
削除すると監査ログから「誰がやったか」が辿れなくなる。

### 6. 確認

| 目的 | 実行するもの |
|---|---|
| 土台が正しく入ったか（新環境を作った直後） | `supabase/checks/verify-setup.sql` → **全行 ✅** になること |
| RLS の付け忘れが無いか（**テーブルを追加するたび**） | `supabase/checks/rls-audit.sql` → **0行**であること |

RLS が1つでも抜けていれば要件違反（`docs/requirements.md` §6 S-2）。

## Markdown の閲覧方法

本リポジトリのドキュメントは Markdown 形式。**VS Code** での閲覧を推奨。

| 操作 | ショートカット |
|---|---|
| プレビュー表示 | `Ctrl+Shift+V` |
| エディタとプレビューを並べる | `Ctrl+K` → `V` |
| PDF 出力 | 拡張機能「Markdown PDF」→ 右クリック → Export (pdf) |

## フォルダ構成

```
aik-assign/
├── CLAUDE.md      # プロジェクト固有の方針
├── README.md      # このファイル
├── .env.example   # 環境変数テンプレート（キー名のみ）
├── docs/          # 検討資料・ヒアリング資料
├── logs/          # セッションログ
└── source-code/   # 受領ソースコード（受領後に作成）
```

## 取り扱い注意

- **本番データを本リポジトリに持ち込まない**（個人情報保護）
- **環境変数はキー名のみ。実値は記載しない**
- `docs/roi-estimate.md` は**経営層限定**。AS 現場担当者には共有しない

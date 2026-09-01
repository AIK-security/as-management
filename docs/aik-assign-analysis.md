# AIK assign ソースコード分析レポート

**分析日**：2026-08-20
**対象**：`AIK-order/AIK-assign`（ローカルクローン取得日 2026-07-13）
**分析ブランチ**：**`origin/master`**（本番系・最新コミット 2026-06-25）
**目的**：AS 向け社内システムを「AIK assign ベース」で構築できるかの判断材料

---

## 🔴 最重要：本番ブランチは `main` ではなく `master` です

このリポジトリには **`main` と `master` の両方が存在**し、中身が大きく異なります。

| | `main` | `master` |
|---|---|---|
| 最新コミット | **2025-09-09** | **2026-06-25** |
| 状態 | **10か月分の開発が入っていない** | 本番系 |
| 差分 | ─ | **781 コミット / 1,024 ファイル先行** |
| 請求書発行機能 | **なし** | **あり** |
| 勤務情報出力 | **なし** | **あり** |
| 時給マスタ | **なし** | **あり** |

そして **リポジトリのデフォルトブランチが `main` に設定されています**（`origin/HEAD -> origin/main`）。
つまり **`git clone` を実行すると、自動的に古い `main` が取得されます。**

### ⚠️ 新保守会社への確認事項（最優先）

> 「コード解析の対象ブランチは `master` で間違いないでしょうか。
> デフォルトブランチが `main` になっていますが、`main` は2025年9月で止まっており、
> 請求書発行などの機能が含まれていません。」

新保守会社が `main` を解析していた場合、**10か月古く、請求機能が存在しないコード**を
前提に設計書を作成していることになります。**設計書を受領する前に確認すべき事項**です。

**あわせて提案**：デフォルトブランチを `master` に変更するか、`main` を整理する。
現状は誰がクローンしても間違える構造になっています。

---

## 結論

| 項目 | 判定 |
|---|---|
| **②AIK assign ベース案** | **推奨しない**（ただし理由は「構造不一致」ではない） |
| **①スクラッチ案** | **推奨。本システムの設計思想を「教科書」として活用する** |

推奨しない理由は3つ。

1. **規模と構成が一人体制と釣り合わない** ─ 13マイクロサービス／約10.5万行／Kubernetes 運用
2. **スタックが全面的に EOL（サポート終了）** ─ 流用するなら大規模アップグレードという別プロジェクトが発生
3. **給与計算機能は存在しない** ─ AS のスコープに含める場合、そこは結局ゼロから

> 📌 **「データモデルが AS の業務に合わない」は理由に含めません。**
> AS は8割が交通誘導・自社顧客の固定現場中心と判明しており、
> **AIK assign のモデルとむしろ近い**ことが分かったためです（5章参照）。

---

## 1. システム構成

### アーキテクチャ

**マイクロサービス（13サービス）／ Node.js 中心＋Rust 1本**

| サービス | 役割 | 行数（参考値） |
|---|---|---|
| `guard-management-ui` | 管制画面（メイン） | 34,292 |
| `user-service-ui` | ユーザー・組織管理画面 | 25,791 |
| `guard-management-api` | 管制API（**業務ロジックの中核**） | 12,694 |
| `guard-line-ui` | 警備員向け LINE アプリ画面（LIFF） | 11,680 |
| `guard-user-service-api` | 認証・ユーザーAPI | 9,399 |
| `blob-service` | ファイル保管 | 3,352 |
| `guard-line-api` | LINE 連携API | 2,565 |
| `configuration-service` | 設定管理 | 1,855 |
| `dependencies` | 共通モジュール群（5個） | 1,782 |
| `user-service-operation-logs` | 操作ログ（**Rust**） | 811 |
| `guard-scheduler` | バッチ処理 | 282 |
| `guards-deploy` | Helm チャート（K8s デプロイ定義） | ─ |
| `guards-infra` | Terraform（GCP インフラ定義） | ─ |
| | **合計** | **約 104,500 行** |

※ 行数は `main` 基準の計測値。`master` は 1,024 ファイル分先行しているため実際はこれより大きい。

### インフラ

- **GCP**（Cloud SQL / VPC / Artifact Registry / Container Registry）
- **Kubernetes + Helm**（本番デプロイ）／ **Terraform**（IaC）
- **PostgreSQL + PostGIS**（位置情報）／ Redis

### 外部サービス依存

| サービス | 用途 |
|---|---|
| **Auth0** | 認証基盤 |
| **LINE**（Bot SDK / LIFF） | **警備員への配置連絡・確認の中核** |
| **Twilio** | SMS 送信 |
| **New Relic** | 監視 |
| ExcelJS / csv | 帳票出力 |

---

## 2. ⚠️ EOL（サポート終了）状況 ─ `master` でも同じ

| サービス | 実行環境 | EOL 時期 | 経過 |
|---|---|---|---|
| guard-management-api / -ui、guard-line-ui | **Node.js 16** | 2023-09-11 | **2年11か月** |
| guard-user-service-api、user-service-ui、blob-service | **Node.js 14** | 2023-04-30 | **3年4か月** |
| guard-management-ui / guard-line-ui | Next.js 12.3.x | 2022年 | 4年前 |
| user-service-ui | **Next.js 11.1.0 / React 17** | 2021年 | 5年前 |
| ─ | axios 0.18.0 | 2018年 | 既知の脆弱性あり |

> 🔴 **3年以上、実行環境にセキュリティパッチが当たっていません。**
> これは AS 版とは無関係に、**外販システムとして現在進行形のリスク**です。
> 新保守会社にアップグレード計画の有無を確認することを強く推奨します。

---

## 3. ライセンス（GPL / AGPL 混入）

| 確認内容 | 結果 |
|---|---|
| 直接依存パッケージ数 | 228（ユニーク） |
| 明らかな GPL / AGPL 系 | **検出されず** |
| 商用ライセンスが必要なUI部品（Highcharts 等） | **なし** |
| ハードコードされた認証情報 | ソース内には**なし** |

**確定ではありません。** `node_modules`（推移的依存）は未取得のため、直接依存のみの確認です。
新保守会社へのライセンス一覧の依頼は引き続き有効。現時点の見通しは「問題が出る可能性は低い」。

---

## 4. データモデル（`master` 基準・37テーブル）

### 4-1. `project` は「マスタ＋日別コピー」構造

```
project（マスタ行： isCopy = false, workDate = NULL）  ← テンプレート
   └─ project（コピー行： isCopy = true, workDate = 2026-08-26）  ← 実際の1日分
   └─ project（コピー行： isCopy = true, workDate = 2026-08-27）
```

同一テーブル内で `isCopy` により master / by-day を区別。**「1日1行の案件」が業務単位**です。

### 4-2. 交通誘導警備（日々発注型）に最適化されたフィールド群

| フィールド | 意味 |
|---|---|
| `requiredGuardsPerDay` / `totalGuards` | 客先要求人数 / 自社決定人数 |
| `maleGuards` / `femaleGuards` / `maxAgeLimit` | 客先からの属性指定 |
| `reorderStatus` / `reorderLimitChange` / `cancelLimit` | **継続依頼（リオーダー）**の管理と締切 |
| `weatherDependent` | 雨天中止 |
| `payoutRate` | 中止時の日当支給率 |
| `unitPrice` | 1人日あたり単価 |
| `trainStation` / `trainLine` / `commuteType` | 最寄駅・通勤手段 |
| `allocationPriority` (A/B/C) | 配置優先度 |
| `shiftType` (day/night/all_day) | 勤務帯区分（日勤/夜勤/当務） |

### 4-3. 警備員（`guard`）

| フィールド | 意味 |
|---|---|
| `workStyle` | **常勤 / 非常勤** |
| `workSunday` 〜 `workSaturday` | 常勤者の既定勤務曜日 |
| `workShiftDay` / `Night` / `Long` | 基本シフト（日勤 / 夜勤 / **当務**） |
| `canBeSiteLeader` | 現場リーダー可否 |
| 社会保険・厚生年金・雇用保険・中退共・健康診断 | 労務管理項目は**一通り保持** |

### 4-4. ✅ 請求機能は `master` に存在します

画面（`master` にのみ存在）：

```
guard-management-ui/pages/invoiceIssuance/index.js              ← 請求書発行
guard-management-ui/pages/invoiceIssuance/invoiceDetails/       ← 請求明細
guard-management-ui/pages/WorkInformationOutput/index.js        ← 勤務情報出力
guard-management-ui/pages/clientCompany/[id]/hourlyWageMaster/  ← 時給マスタ（依頼会社別）
guard-management-ui/pages/projectWorkSheet/[id]/                ← 案件作業票
```

`master` で追加されたテーブル：

| テーブル | フィールド | 役割 |
|---|---|---|
| `workInformationManagement` | guardId, projectId, workDate, startTime, endTime, **overTimeLabour**, **overTimeBilling**, isHoliday, mainProjectId, **workEndDate** | **勤務情報（請求の計算基礎）** |
| `hourlyWageMaster` | type, name, regularAmount, overtimeAmount | **時給マスタ**（通常/残業） |
| `projectGuardUnitPrice` | projectId, type, name, regularAmount, overtimeAmount | 案件別の単価 |
| `projectMiscellaneous` | projectId, name, amount | 案件諸経費 |

> 📌 **設計として注目すべき2点**
> - **`overTimeLabour` と `overTimeBilling` を分けている** ─ 残業を「労務用」と「請求用」で別管理。
>   実務上ここは必ずズレるので、この分離は正しい設計
> - **`workEndDate` がある** ─ **日をまたぐ勤務（夜勤・当務）に対応**している

### 4-5. 🔴 給与計算は `master` にも存在しません

`payroll` / `給与計算` / `控除` / `源泉` に該当する実装は **`master` にも見つかりませんでした。**

あるのは **時給マスタ → 勤務情報 → 請求** までの流れです。
支給額の計算、社会保険料の控除、源泉徴収といった給与計算機能は範囲外です。

ただし `overTimeLabour`（労務側の残業時間）を保持しているため、
**給与計算に渡すための入力データは揃いつつある**設計になっています。

### 4-6. LINE 連携が配置フローの中核

`assignment` に配置連絡のライフサイクルが実装されています。

```
配置結果連絡（assignmentNoticedAt） → 確認（assignmentConfirmedAt）
中止連絡（cancelationNoticedAt）   → 確認（cancelationConfirmedAt）
配置取消連絡（dismissalNoticedAt） → 確認（dismissalConfirmedAt）
```

**LINE で警備員に配置を通知し、本人から確認を取る**フローが中心にあります。
設計思想として最も参考価値が高い部分です。

### 4-7. その他

- **資格管理**：`license` / `guardLicense` / `prefectureLicense`（都道府県別要件）
- **日報**：`dailyReport` / `dailyReportAssignment` / `dailyReportTotal`（3層）
- **希望・休暇**：`shiftRequest` / `leaveRequest`
- **移動経路**：`route` / `routeStep` / `drivingRoute` / `projectGuardDistance`（PostGIS）
- **マルチテナント**：`guardCompany` / `guardCompanyOffice` / `organization`

---

## 5. AS の業務との適合性（再評価）

### AS の業務形態（2026-08-20 判明）

- **8割が交通誘導**
- **自社顧客の固定現場が中心**
- **余剰人員が出た場合、単発の現場を探して配置する**

### 評価：構造は「むしろ近い」

当初「AS が施設警備中心なら構造的に不一致」という仮説を立てていましたが、
**AS は交通誘導中心と判明したため、この仮説は成立しません。**

| AS の業務 | AIK assign の対応 |
|---|---|
| 交通誘導が8割 | ✅ まさにこのモデル |
| 固定現場中心 | ✅ `project` マスタ＋日別コピーで表現可能。`reorder`（継続依頼）とも整合 |
| 余剰人員を単発現場へ | ✅ `allocationPriority`、`noAssignment`（未配置管理）が該当 |
| 日をまたぐ勤務 | ✅ `workEndDate` で対応 |
| 請求 | ✅ `master` に実装あり |
| **給与計算** | ❌ **機能なし** |

### ⇒ 定着しなかった理由の仮説を組み直す必要があります

構造的不一致が主因という当初の見立ては、**根拠が弱くなりました。** 残る候補：

| 仮説 | 検証方法 |
|---|---|
| **運用負荷・UX**（入力が多い、Excelの方が速い） | 8/26 ヒアリングで現行の作業時間と比較 |
| **導入時期の問題**（機能が未完成な時期に試した） | 当時は請求機能が無かった可能性が高い |
| **組織的要因**（推進役不在、教育不足） | 当時の状況を確認 |
| **給与計算が無いこと** | AS の業務範囲を確認 |

> 💡 **注目**：請求機能の開発ブランチは `feature_april/` `feature_july/` `invoice_june_request*` など
> **2025年4月〜7月頃**に集中しています。AS が試用した時期がそれ以前なら、
> **「請求ができないから使えなかった」**という単純な理由の可能性があります。
> → 8/26 で「いつ頃触ったか」を確認する価値があります。

---

## 6. 方式判断

### ② AIK assign ベース案 ─ 障壁は「構造」ではなく「規模・EOL・運用」

| 障壁 | 内容 |
|---|---|
| **規模** | 13サービス・10万行超。一人で全体を把握するのに数か月 |
| **運用** | Kubernetes + Helm + Terraform + GCP。**一人での本番運用は現実的でない** |
| **EOL** | Node 14/16、Next 11/12。**流用前に全面アップグレードが必須** |
| **給与** | 機能が存在しない。結局ゼロから作る |
| **権利** | 派生物作成権の確認が別途必要 |
| ~~構造~~ | ~~不一致~~ → **むしろ適合する。障壁ではない** |

### ① スクラッチ案 ＋ 設計思想の流用（推奨）

**流用すべきはコードではなく設計思想です。** 特に価値が高いのは：

- **LINE による配置連絡・本人確認のライフサイクル**（連絡→確認→中止→取消）
- **残業の「労務用」と「請求用」の分離**（`overTimeLabour` / `overTimeBilling`）
- **時給マスタ → 勤務情報 → 請求**のデータの流れ
- **`workEndDate` による日跨ぎ勤務の表現**
- 資格管理と**都道府県別の資格要件**（`prefectureLicense`）
- 中止・継続依頼の**締切管理**（`cancelLimit` / `reorderLimit`）
- 警備員マスタが持つべき労務項目一式

AS 一社向けなら**マイクロサービスは不要でモノリスで十分**。
機能を絞れば規模は**10分の1程度**に収まる見込みです。

---

## 7. 開発の経緯から読み取れること

- ブランチ名から、**請求機能は2025年4〜7月に開発**されたと推定される
  （`feature_april/invoice_generation`、`feature_july/invoice_generation`、`invoice_june_request1〜4`）
- `feature_july/invoice_generation_php_changes` という**PHP を示すブランチ名**が存在。
  請求まわりに別言語のコンポーネントがある可能性 → 新保守会社に確認の価値あり
- コード内に `TODO(dkg): unclear if...` 等、**仕様の未確定を示す記述が多数残存**
- 設計資料（design docs）とSlackでの確認記録への言及がコメント内にあり、
  **旧保守会社側に当時の資料が残っている可能性**がある
- 開発元と思われる組織名：`netsmile.jp`、`Eltes-ITS`
- ブランチが130本あり、`master-backup-2026-*` が複数。**ブランチ運用は整理されていない**

---

## 8. セキュリティ事項

| # | 事項 | 状態 |
|---|---|---|
| 1 | ローカルクローンの remote URL に PAT 平文保存 | **対処済**（2026-08-20） |
| 2 | `user-service-operation-logs/.env-prod` がコミットされている | **未確認**（中身の確認が必要） |
| 3 | `guards-infra/infra-gcp/terraform.tfstate` がコミットされている | **未対応**（機密情報を含む可能性） |
| 4 | Node.js 14/16 が EOL のまま本番稼働 | **未対応** |
| 5 | デフォルトブランチが古い `main` を指している | **未対応**（解析対象の取り違えを招く） |

2〜5 は AS 版とは独立した **AIK assign 自体の課題**です。
保守会社の切り替えという好機に、新保守会社へ申し送ることを推奨します。

---

## 9. 分析の限界

- ローカルクローンは **2026-07-13 取得**。それ以降の変更は反映されていない
- `node_modules` を含まないため、**推移的依存のライセンスは未確認**
- 画面の実際の挙動は未確認（コードとテーブル定義からの推定を含む）
- 初版（2026-08-20 作成）は `main` ブランチで分析したため「請求機能なし」等の誤りがあった。
  **本版で `origin/master` を対象に訂正済み**

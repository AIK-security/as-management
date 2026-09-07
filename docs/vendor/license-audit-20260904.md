# AIK assign ライセンス全数監査（2026-09-04）

**実施理由**：AIK assign は社外顧客へ**外販中**。第三者提供が既に発生しているため、
ソース公開義務の有無と著作権表示義務の履行状況を確認する。
新保守会社の調査は**直接依存176件のみ**だったため、**推移依存を含む全数**を自社で実施した。

## 結論

> ✅ **ソースコード公開義務が発生するライブラリは1件も無い。**
> ✅ **是正が必要な違反も無い。**
> 🟡 対応が望ましいのは「OSSライセンス表示ページの不在」と「`ua-parser-js` の将来リスク」の2点のみ。

---

## 1. 監査の範囲と方法

| 項目 | 内容 |
|---|---|
| 対象ブランチ | `origin/master`（2026-06-25 時点。**現行の稼働版**） |
| 対象ファイル | `yarn.lock` **14本** ＋ `Cargo.lock` **1本**（全サービス） |
| npm 側 | **4,508 件**（name@version のユニーク。パッケージ名では 2,660 種） |
| Rust 側 | **257 crate** |
| 手法 | ロックファイルを解析し、npm レジストリ／crates.io から各版のライセンスを取得。
未取得分は GitHub の LICENSE / README で個別確認 |
| 除外 | 内部パッケージ（`@netsmile/*` 等）は**公開レジストリに問い合わせていない**（内部の命名を外部へ出さないため） |
| 副作用 | **バックアップクローンは一切変更していない。** 解析はスクラッチパッドで実施 |

> 📌 ベンダ調査の **176件 → 今回 4,508件。実際に配布物へ入るものの約26倍**を確認した。
> なおこれはベンダの手抜きではなく、先方も備考に「推移依存まで機械出力が必要」と範囲を明示していた。

---

## 2. 結果：npm（4,508件）

| ライセンス | 件数 |
|---|---|
| MIT | 3,597 |
| ISC | 286 |
| BSD-3-Clause | 245 |
| Apache-2.0 | 125 |
| BSD-2-Clause | 94 |
| LINE Developers Agreement（`SEE LICENSE IN README.md`） | 42 |
| MPL-2.0 | 12 |
| CC0-1.0 | 10 |
| その他（Apache AND MIT／MIT OR CC0／0BSD 等） | 残り |

### コピーレフト系のヒット：**2件のみ。いずれも義務は発生しない**

| パッケージ | 版 | ライセンス | 使用箇所 | 判定 |
|---|---|---|---|---|
| `jszip` | 3.10.1 | **(MIT OR GPL-3.0-or-later)** | guard-management-api, guard-management-ui | ✅ **デュアルライセンス。MIT を選択すればよく、公開義務なし** |
| `node-forge` | 1.3.1 | **(BSD-3-Clause OR GPL-2.0)** | blob-service, configuration-service | ✅ **同上。BSD を選択すればよい** |

> デュアルライセンスは「どちらかを選んでよい」という意味。
> **GPL 側を選ばない限り公開義務は生じない。** 単独 GPL / LGPL / AGPL は **0件**。

### `ua-parser-js` の確認結果

ベンダ報告で唯一 AGPL の疑いが挙がっていた件。**レジストリ上のメタデータでも MIT と確定**。
`guard-line-ui` のみで使用、`package.json` は `"ua-parser-js": "1.0.32"` と**完全固定**、`yarn.lock` も 1.0.32。
**現時点で公開義務なし。** AGPL 化は v2 以降のため、危険なのは将来の更新時のみ。

---

## 3. 結果：Rust（257 crate）

| ライセンス | 件数 |
|---|---|
| MIT/Apache-2.0（表記ゆれ含め4種で計 183） | 183 |
| MIT 単独 | 42 |
| BSD-3-Clause | 7 |
| Unlicense/MIT ほか | 残り |

**コピーレフト系：0件。**

### 副産物：`netsmile-util` の所在が判明

ベンダが「Cargo.toml が git 参照のみでライセンス未確定」としていた件。
`Cargo.lock` の source を見たところ、**Bitbucket の `netsmile1` 組織**配下にホストされていた。
同様の内部 crate が計4件：

| crate | 所在 |
|---|---|
| `netsmile-util` | bitbucket.org/netsmile1/… |
| `configuration-service-module` | bitbucket.org/netsmile1/… |
| `service_discovery_module` | bitbucket.org/netsmile1/… |
| `user-service-operation-logs` | ローカル（本体） |

> 📌 **これらはOSSではなくベンダの内部ライブラリ。**
> したがって論点は「OSSライセンス」ではなく **著作権の所在・利用許諾**（＝契約側の話）。
> 依頼文 A-【3】(b) への回答は「参照先の教示」ではなく
> **「これらの内部ライブラリを自社が使い続ける／改変する権利があるか」**の確認に読み替えるべき。

---

## 4. 注意はいるが問題ではない層

| 分類 | 件数 | 中身 | 判定 |
|---|---|---|---|
| **LINE Developers Agreement** | 42 | `@line/liff` と `@liff/*` | LIFF SDK。OSSライセンスではなく LINE の利用規約に同意して使うもの。**コピーレフトではない**。LINE 連携をやめない限り論点にならない |
| **MPL-2.0** | 12 | `axe-core`, `ip6addr`, `lightningcss`（プラットフォーム別バイナリ含む） | **ファイル単位の弱いコピーレフト。** 当該ファイルを**改変して配布した場合のみ**そのファイルの開示義務。改変していないので**表示だけで足りる** |
| **CC-BY-4.0** | 1 | `caniuse-lite`（ブラウザ対応表データ） | ビルド時に使うデータ。**表示（アトリビューション）が必要** |
| **`SEE LICENSE IN LICENSE`** | 4 | `newrelic`, `@newrelic/aws-sdk`, `@newrelic/koa`, `@newrelic/superagent` | GitHub の LICENSE を確認 → **Apache-2.0**。問題なし |

---

## 5. 未確定として残ったもの：**1件のみ**

| パッケージ | 版 | 状況 |
|---|---|---|
| `buffers` | 0.1.1 | package.json にライセンス欄が無く、GitHub リポジトリも消失。2012年頃の小規模ユーティリティ（substack 製）。**コピーレフトとして報告された記録は無い** |

4,508件中1件（0.02%）。**実務上のリスクは無視できる水準**と判断する。

---

## 6. やること

| # | 対応 | 優先 | 手間 |
|---|---|---|---|
| 1 | **`ua-parser-js` を v2 に上げない**方針を改修ルールに明記。上げる必要が生じたら `Bowser`（MIT）へ置換 | 🔴 今すぐ | 5分 |
| 2 | **OSSライセンス表示ページの追加**。`pages/termsofusage` `pages/privacyPolicy` はあるが third-party notices が3つのUIいずれにも無い。**外販製品として本来あるべきものが欠けている**。MIT/BSD/Apache の表示義務と、CC-BY-4.0・MPL-2.0 の表示要求をまとめて満たせる | 🟠 次の改修のついで | 半日 |
| 3 | 内部ライブラリ（`@netsmile/*` と Bitbucket の Rust crate 4件）の**利用・改変の権利**を契約側で確認 | 🟠 | 契約確認と同時に |
| 4 | 本監査を**依存更新のたびに再実施**。今回が基準値 | 🟡 | 都度30分 |

> ⚠️ 2について：サーバ側コードは配布に当たらないが、
> **フロントエンドの JavaScript はブラウザへ配信される＝配布**のため表示義務が及ぶ。
> `yarn licenses generate-disclaimer` の出力を1ページ用意すれば足りる。

---

## 7. 再現手順

```
1. origin/master の全 yarn.lock / Cargo.lock を取得
2. yarn.lock を解析して name@version を抽出（内部パッケージは除外）
3. https://registry.npmjs.org/<name>/<version> から license を取得
4. Cargo.lock は https://crates.io/api/v1/crates/<name>/<version> から取得
5. 取得できないものは GitHub の LICENSE / README で個別確認
```

作業ファイル一式（`pkglist.json` / `npm_licenses.json` / `cargo_licenses.json` / 各スクリプト）は
セッションのスクラッチパッドに置いた。**恒久保存が必要なら `docs/` 配下へ移すこと**（未実施）。

---

## 8. 関連

- `additional-request-20260904.md` A-補足 — 監査前の整理と依頼文
- `tech-stack-checklist.md` F章 — 「第三者ライブラリのライセンス一覧」の回答欄。**本書の結果を転記する**
- `received-materials-inventory.md` — 受領資料の全目録

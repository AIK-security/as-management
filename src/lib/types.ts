// 第1弾（管制／配置管理）のドメイン型。
// 定義の根拠は docs/data-model.md。
//
// 🔴 **命名で出どころを分ける。**
//   ・`snake_case` … DB の列と**一対一**。supabase-js が返す形そのまま。変換層を作らない
//   ・`camelCase`  … 画面のために組み立てた形（DB のテーブルではない）
//   こう分けておくと、「この値は DB にあるのか、計算して作ったのか」が
//   型を見た瞬間に分かる（3か月後の自分のため・設計原則3）。

// ─────────────────────────────────────────────────────────
// DB 行（snake_case）
// ─────────────────────────────────────────────────────────

/** 管轄。ShiftMax の管轄マスタに対応（10:東京 / 20:千葉 …） */
export type Jurisdiction = {
  id: string;
  code: string;
  name: string;
  /** 他管轄の隊員を自管轄の現場へ入れてよいか（ShiftMax の「他管轄社員配置」） */
  allow_cross_staff: boolean;
  /** 自管轄の隊員を他管轄の現場へ出してよいか（ShiftMax の「他管轄現場配置」） */
  allow_cross_site: boolean;
};

/** 会社。自社（AS）と協力会社を区別する */
export type CompanyKind = "own" | "partner";

export type Company = {
  id: string;
  kind: CompanyKind;
  name: string;
};

/** 資格。有効期限を持つため配列ではなくテーブルで持つ（data-model.md §5-2） */
export type Qualification = {
  id: string;
  code: string;
  name: string;
  /** 配置ボードのバッジに出す短い表記（例: 交1, 交2） */
  short_label: string;
  /** 🔴 'train' = 列車見張（鉄道会社ごと）。名札での出し方が違う（qual-labels.ts） */
  category: "train" | null;
};

export type Guard = {
  id: string;
  /** 個人コード（ShiftMax）。🔴 協力会社の隊員は持たない */
  staff_code: string | null;
  name: string;
  short_name: string;
  company_id: string;
  jurisdiction_id: string;
  /** 🔴 並び順（フリガナ順）のためだけに引く。引いていない画面もあるので省略可 */
  name_kana?: string | null;
};

export type Customer = {
  id: string;
  /** 担当コード。ShiftMax では顧客名ではなくこれが実質のキー */
  staff_code: string;
  name: string;
  /** 五十音順に並べるためのフリガナ。無ければ name で代用する */
  name_kana: string | null;
};

export type Site = {
  id: string;
  site_code: string;
  name: string;
  short_name: string;
  customer_id: string;
  jurisdiction_id: string;
};

/** 勤務区分。5つで全部（as-genjo-kansei.md §4-4）。
 *  🟠 「現中」（現着中止）の扱いは未決（requirements.md §8-7 ①） */
export type WorkKind = "day" | "nightA" | "nightB" | "dayCancel" | "nightCancel";

/** 🔴 休む区分（2026-09-16）。WorkKind から「現中」を除いたもの ──
    現着中止は**枠の状態**であって、隊員の休み方ではない */
export type OffWorkKind = "day" | "nightA" | "nightB";

/** 配置枠 = A表の1行。仮組みと確定を status 1列で表す */
export type ShiftStatus = "draft" | "confirmed";

export type Shift = {
  id: string;
  site_id: string;
  /** 日跨ぎ勤務では「開始日」 */
  work_date: string;
  jurisdiction_id: string;
  work_kind: WorkKind;
  /** 必要人数 */
  headcount: number;
  start_h: number;
  start_m: number;
  end_h: number;
  end_m: number;
  break_min: number;
  plan_comment: string | null;
  billing_note: string | null;
  status: ShiftStatus;
  /**
   * 中止（行く前の中止）にした時刻。null=中止でない。
   * 🔴 現着中止（`work_kind` の `dayCancel`/`nightCancel`＝「現中」）とは別物。
   *   現中は稼働が立つため請求に効く。こちらは稼働しない。
   */
  cancelled_at: string | null;
};

/** 隊員の稼働。自社現場・協力会社への貸出・非現場を1テーブルに統合（data-model.md §4-2） */
export type AssignmentKind = "site" | "lent_out" | "off";

/**
 * 配置上の役割。
 * 🔴 「隊長かそれ以外」の2値（2026-09-02 決定）。
 *   8/27 ヒアリングでは「隊長・リーダー・サブ」と3つ挙がっていたが、
 *   隊長とリーダーが別物かを確認できていないため、一旦分けない。
 *   🟠 リーダーが実在するかは未決（requirements.md §8-7）。
 */
export type AssignmentRole = "leader" | "member";

export type OffKind =
  | "paid_leave"
  /** 🔴 公休（2026-09-16 追加）。有給でも欠勤でもない「ただの休み」。
      隊員は固定給ではないため、休んでも欠勤にはならず勤務日数が減るだけ */
  | "day_off"
  | "training"
  | "medical"
  | "absent_self"
  | "absent_company"
  | "night_duty"
  | "substitute_holiday"
  | "control"
  | "office"
  | "standby";

export type Assignment = {
  id: string;
  guard_id: string;
  work_date: string;
  kind: AssignmentKind;
  /** kind === "site" のときのみ */
  shift_id: string | null;
  role: AssignmentRole;
  is_long_distance: boolean;
  /** プレートの並び順 */
  position: number;
  off_kind: OffKind | null;
  /** 🔴 どの区分を休むか（2026-09-16）。null=終日。「一部勤務可」を表す */
  off_work_kind: OffWorkKind | null;
  /** 貸出先の協力会社（kind === "lent_out"） */
  lent_to_company_id: string | null;
  external_site_name: string | null;
  status: "planned" | "canceled";
};

/** NG（配置してはいけない組み合わせ）。現場×隊員 と 人×人 の両方を持つ */
export type NgKind = "site_guard" | "guard_guard";

export type NgEntry = {
  id: string;
  kind: NgKind;
  guard_id: string;
  /** 現場に対する NG（監督NG など） */
  site_id: string | null;
  /** 人に対する NG（不仲）。相手の隊員 */
  counterpart_guard_id: string | null;
  reason: string;
  /** 🔴 block でも DB は止めない。画面で警告を出すための強度（8/27 決定） */
  severity: "block" | "warn";
};

// ─────────────────────────────────────────────────────────
// 配置ボードが画面に出すためにまとめた形（camelCase ＝ DB のテーブルではない）
// ─────────────────────────────────────────────────────────

/** 資格バッジの文字（交1 など）。プレートを描くたびにマスタを引かずに済むよう畳んでおく */
export type QualLabels = string[];

/** 配置ボードのプレート1枚が知っている情報 */
export type PlateView = {
  assignmentId: string;
  guard: Guard;
  qualLabels: QualLabels;
  role: AssignmentRole;
  /** この現場に入った経験があるか（★の有無）。assignments の履歴から引く */
  experienced: boolean;
  /** この枠に対して成立している NG */
  ngReasons: string[];
  isPartner: boolean;
  isOtherJurisdiction: boolean;
};

/** プール（未配置）に並べる隊員 */
export type GuardView = {
  guard: Guard;
  qualLabels: QualLabels;
  isPartner: boolean;
  /** 🔴 反対側の区分に既に入っている（「日勤済」「夜勤済」）。配置ボードのプールだけで使う */
  doneLabel?: string;
  /** 🔴 持っている列車見張の会社（「列5」の中身）。ツールチップに出す */
  trainLabels?: string[];
};

/** 配置ボードの1行（現場 × 枠） */
export type ShiftRow = {
  shift: Shift;
  site: Site;
  customer: Customer | null;
  plates: PlateView[];
  /** 現場が求める資格のうち、誰も持っていないもの */
  missingQualifications: Qualification[];
};

export type BoardWarning = {
  kind: "shortage" | "qualification" | "overlap" | "ng";
  message: string;
};

/**
 * 得意先ごとのまとまり。
 * 🔴 並び順の決定は 2026-09-02：
 *   ・グループ＝**得意先名順（固定）**。毎日同じ場所に出るので探す位置を覚えられる。
 *     当日変更で配置が動いても、現場カードの位置がずれない
 *   ・グループの中＝**開始時刻順**
 */
export type BoardGroup = {
  customer: Customer | null;
  rows: ShiftRow[];
  /** 見出しに出す集計 */
  siteCount: number;
  placed: number;
  headcount: number;
};

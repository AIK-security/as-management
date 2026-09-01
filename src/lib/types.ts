// 第1弾（管制／配置管理）のドメイン型。
// 定義の根拠は docs/data-model.md。**列名は DB と一対一で対応させる**（変換層を作らない）。

/** 管轄。ShiftMax の管轄マスタに対応（10:東京 / 20:千葉 …） */
export type Jurisdiction = {
  id: string;
  code: string;
  name: string;
  /** 他管轄の隊員を自管轄の現場へ入れてよいか（ShiftMax の「他管轄社員配置」） */
  allowCrossStaff: boolean;
  /** 自管轄の隊員を他管轄の現場へ出してよいか（ShiftMax の「他管轄現場配置」） */
  allowCrossSite: boolean;
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
  /** 配置ボードのバッジに出す短い表記（例: 交1, 交2） */
  shortLabel: string;
  name: string;
};

export type Guard = {
  id: string;
  /** ShiftMax の個人コード。協力会社の隊員は持たない */
  personCode: string | null;
  name: string;
  shortName: string;
  companyId: string;
  jurisdictionId: string;
  qualificationIds: string[];
};

export type Customer = {
  id: string;
  name: string;
};

export type Site = {
  id: string;
  /** ShiftMax の警備先番号。べんり君の入力キーでもある */
  guardPostNo: string;
  name: string;
  shortName: string;
  customerId: string;
  jurisdictionId: string;
  requiredQualificationIds: string[];
};

/** 勤務区分。5つで全部（as-genjo-kansei.md §4-4） */
export type WorkKind = "day" | "nightA" | "nightB" | "dayCancel" | "nightCancel";

/** 配置枠 = A表の1行。仮組みと確定を status 1列で表す */
export type ShiftStatus = "draft" | "confirmed";

export type Shift = {
  id: string;
  siteId: string;
  /** 日跨ぎ勤務では「開始日」 */
  workDate: string;
  jurisdictionId: string;
  workKind: WorkKind;
  /** 必要人数 */
  headcount: number;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
  breakMin: number;
  bandName: string;
  planComment: string;
  billingNote: string;
  status: ShiftStatus;
  /** 確定後に編集されたか。ShiftMax へ再度引き渡す必要があることを示す */
  changedAfterConfirm: boolean;
};

/** 隊員の稼働。自社現場・協力会社への貸出・非現場を1テーブルに統合（data-model.md §4-2） */
export type AssignmentKind = "site" | "lent_out" | "off";

export type AssignmentRole = "leader" | "sub" | "member";

export type OffKind =
  | "paid_leave"
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
  guardId: string;
  workDate: string;
  kind: AssignmentKind;
  /** kind === "site" のときのみ */
  shiftId: string | null;
  role: AssignmentRole;
  isLongDistance: boolean;
  /** プレートの並び順 */
  position: number;
  offKind: OffKind | null;
  /** 貸出先の協力会社（kind === "lent_out"） */
  lentToCompanyId: string | null;
  externalSiteName: string | null;
  status: "planned" | "canceled";
};

/** NG（配置してはいけない組み合わせ）。現場×隊員 と 人×人 の両方を持つ */
export type NgEntry = {
  id: string;
  guardId: string;
  /** 現場に対する NG（監督NG など） */
  siteId: string | null;
  /** 人に対する NG（不仲）。相手の隊員 */
  counterpartGuardId: string | null;
  reason: string;
};

// ─────────────────────────────────────────────────────────
// 配置ボードが画面に出すためにまとめた形（DB のテーブルではない）
// ─────────────────────────────────────────────────────────

/** 配置ボードのプレート1枚が知っている情報 */
export type PlateView = {
  assignmentId: string | null;
  guard: Guard;
  role: AssignmentRole;
  /** この現場に入った経験があるか（★の有無） */
  experienced: boolean;
  /** この枠に対して成立している NG */
  ngReasons: string[];
  isPartner: boolean;
  isOtherJurisdiction: boolean;
};

/** 配置ボードの1行（現場 × 枠） */
export type ShiftRow = {
  shift: Shift;
  site: Site;
  customer: Customer;
  plates: PlateView[];
  /** 現場が求める資格のうち、誰も持っていないもの */
  missingQualifications: Qualification[];
};

export type BoardWarning = {
  kind: "shortage" | "qualification" | "overlap" | "ng";
  message: string;
};

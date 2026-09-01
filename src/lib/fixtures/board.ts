// 段1（表示のみ）用のダミーデータ。
//
// 🔴 **本番データは持ち込まない**（CLAUDE.md）。氏名・現場名・得意先名はすべて架空。
//    苗字に連番を付けてあるのは、実在の人物と取り違えないようにするため。
//
// 規模は実測に合わせる（as-genjo-kansei.md §5 / shiftmax-api-analysis.md §10-2）：
//   日勤の稼働 約68名 ／ 現場 40件超 ／ プレート 平日 約150枚
// **密度が現実と違うと画面設計の検証にならない**ため、件数だけは実物に寄せる。

import type {
  Assignment,
  Company,
  Customer,
  Guard,
  Jurisdiction,
  NgEntry,
  Qualification,
  Shift,
  Site,
} from "@/lib/types";

/** 決定的な擬似乱数。実行のたびに画面が変わると比較できないため seed 固定 */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export const JURISDICTIONS: Jurisdiction[] = [
  { id: "j-10", code: "10", name: "東京", allowCrossStaff: true, allowCrossSite: true },
  { id: "j-20", code: "20", name: "千葉", allowCrossStaff: true, allowCrossSite: false },
];

export const COMPANIES: Company[] = [
  { id: "c-own", kind: "own", name: "And Security" },
  { id: "c-p1", kind: "partner", name: "アルファ警備" },
  { id: "c-p2", kind: "partner", name: "ブラボー警備保障" },
  { id: "c-p3", kind: "partner", name: "チャーリーセキュリティ" },
];

export const QUALIFICATIONS: Qualification[] = [
  { id: "q-k1", shortLabel: "交1", name: "交通誘導警備業務検定 1級" },
  { id: "q-k2", shortLabel: "交2", name: "交通誘導警備業務検定 2級" },
  { id: "q-z2", shortLabel: "雑2", name: "雑踏警備業務検定 2級" },
  { id: "q-s2", shortLabel: "施2", name: "施設警備業務検定 2級" },
];

const SURNAMES = [
  "佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤",
  "吉田", "山田", "佐々木", "山口", "松本", "井上", "木村", "林", "斎藤", "清水",
];

const CUSTOMER_NAMES = [
  "アルファ建設", "ブラボー工業", "チャーリー電設", "デルタ土木", "エコー開発",
  "フォックス建機", "ゴルフ道路", "ホテル設備", "インディア建設", "ジュリエット工業",
];

const SITE_SUFFIX = [
  "駅前工区", "北口改良", "第二工区", "跨線橋", "上下水道", "本線切替",
  "南口広場", "地下埋設", "電線共同溝", "橋梁補修",
];

export const CUSTOMERS: Customer[] = CUSTOMER_NAMES.map((name, i) => ({
  id: `cu-${i + 1}`,
  name,
}));

const rng = makeRng(20260901);

export const SITES: Site[] = Array.from({ length: 42 }, (_, i) => {
  const customer = CUSTOMERS[i % CUSTOMERS.length];
  const suffix = SITE_SUFFIX[Math.floor(rng() * SITE_SUFFIX.length)];
  // 現場の 1/4 ほどに必要資格を設定する（全部に付けると警告だらけで検証にならない）
  const required =
    rng() < 0.25 ? [rng() < 0.5 ? "q-k2" : "q-k1"] : [];
  return {
    id: `s-${i + 1}`,
    guardPostNo: String(55000 + i * 7),
    name: `${customer.name.slice(0, 4)} ${suffix}`,
    shortName: suffix.slice(0, 4),
    customerId: customer.id,
    jurisdictionId: i % 9 === 0 ? "j-20" : "j-10",
    requiredQualificationIds: required,
  };
});

export const GUARDS: Guard[] = Array.from({ length: 104 }, (_, i) => {
  const isPartner = i >= 86; // 末尾18名を協力会社の隊員にする
  const company = isPartner ? COMPANIES[1 + (i % 3)] : COMPANIES[0];
  const surname = SURNAMES[i % SURNAMES.length];
  const num = String(i + 1).padStart(2, "0");
  const quals: string[] = [];
  if (rng() < 0.32) quals.push("q-k2");
  if (rng() < 0.12) quals.push("q-k1");
  if (rng() < 0.1) quals.push("q-z2");
  return {
    id: `g-${i + 1}`,
    // 🔴 協力会社の隊員は ShiftMax の個人コードを持たない（shiftmax-api-analysis.md §10-3）
    personCode: isPartner ? null : String(30000 + i * 3),
    name: `${surname}${num}`,
    shortName: `${surname}${num}`,
    companyId: company.id,
    jurisdictionId: i % 11 === 0 ? "j-20" : "j-10",
    qualificationIds: quals,
  };
});

const WORK_DATE = "2026-09-01";

/** 開始時刻から勤務区分と休憩を決める（as-genjo-kansei.md §4-4） */
function breakMinFor(startH: number, isNight: boolean): number {
  if (!isNight) return 60;
  return startH < 23 ? 60 : 0; // 夜A=60分 / 夜B=0分
}

export const SHIFTS: Shift[] = SITES.map((site, i) => {
  const isNight = i % 3 === 2;
  const startH = isNight ? (i % 6 === 5 ? 23 : 20) : 8 + (i % 2);
  const endH = isNight ? 6 : 17 + (i % 2);
  const headcount = 1 + Math.floor(rng() * 5);
  // 3分の2ほどを確定済みにする（仮組みと確定が混在した状態を見たい）
  const confirmed = rng() < 0.66;
  return {
    id: `sh-${i + 1}`,
    siteId: site.id,
    workDate: WORK_DATE,
    jurisdictionId: site.jurisdictionId,
    workKind: isNight ? (startH < 23 ? "nightA" : "nightB") : "day",
    headcount,
    startH,
    startM: 0,
    endH,
    endM: 0,
    breakMin: breakMinFor(startH, isNight),
    bandName: `班${String.fromCharCode(65 + (i % 8))}`,
    planComment: i % 7 === 0 ? "集合場所は現場事務所前" : "",
    billingNote: "",
    status: confirmed ? "confirmed" : "draft",
    changedAfterConfirm: confirmed && i % 13 === 0,
  };
});

/** 配置。枠の人数をだいたい満たすが、一部わざと不足させる */
export const ASSIGNMENTS: Assignment[] = (() => {
  const rows: Assignment[] = [];
  let guardCursor = 0;
  let seq = 1;

  for (const shift of SHIFTS) {
    // 5枠に1つは1名不足させる（未充足の見え方を確認するため）
    const filled = seq % 5 === 0 ? Math.max(0, shift.headcount - 1) : shift.headcount;
    for (let n = 0; n < filled; n++) {
      const guard = GUARDS[guardCursor % GUARDS.length];
      guardCursor++;
      rows.push({
        id: `a-${seq++}`,
        guardId: guard.id,
        workDate: WORK_DATE,
        kind: "site",
        shiftId: shift.id,
        role: n === 0 ? "leader" : n === 1 ? "sub" : "member",
        isLongDistance: false,
        position: n,
        offKind: null,
        lentToCompanyId: null,
        externalSiteName: null,
        status: "planned",
      });
    }
  }

  // 非現場ステータス
  const offKinds = [
    "paid_leave", "paid_leave", "paid_leave",
    "training", "training",
    "night_duty", "night_duty",
    "absent_self", "medical", "office", "standby", "control",
  ] as const;
  offKinds.forEach((offKind, i) => {
    const guard = GUARDS[(guardCursor + i * 3) % GUARDS.length];
    rows.push({
      id: `a-${seq++}`,
      guardId: guard.id,
      workDate: WORK_DATE,
      kind: "off",
      shiftId: null,
      role: "member",
      isLongDistance: false,
      position: 0,
      offKind,
      lentToCompanyId: null,
      externalSiteName: null,
      status: "planned",
    });
  });

  // 🔴 協力会社への貸出（AS の隊員を他社の現場へ出す）。請求に効くため第1弾から持つ
  [
    { companyId: "c-p1", site: "◯◯地区 交通規制" },
    { companyId: "c-p1", site: "◯◯地区 交通規制" },
    { companyId: "c-p2", site: "△△ビル 竣工警備" },
  ].forEach((lent, i) => {
    const guard = GUARDS[(guardCursor + 40 + i * 5) % GUARDS.length];
    rows.push({
      id: `a-${seq++}`,
      guardId: guard.id,
      workDate: WORK_DATE,
      kind: "lent_out",
      shiftId: null,
      role: "member",
      isLongDistance: false,
      position: 0,
      offKind: null,
      lentToCompanyId: lent.companyId,
      externalSiteName: lent.site,
      status: "planned",
    });
  });

  return rows;
})();

// NG（監督NG・不仲）。
// 🔴 実データが存在しないため（gap-analysis.md A-1 ⑬）、ここでは**実際の配置から導出**する。
//    固定の ID を書くと配置と噛み合わず1件も成立しないことがあり、画面の検証にならない。
export const NG_ENTRIES: NgEntry[] = (() => {
  const rows: NgEntry[] = [];
  const siteAssignments = ASSIGNMENTS.filter((a) => a.kind === "site" && a.shiftId);
  const shiftById = new Map(SHIFTS.map((s) => [s.id, s]));

  // 現場 × 隊員 の NG を3件（実際に配置されている組み合わせから採る）
  [4, 37, 61].forEach((idx, i) => {
    const a = siteAssignments[idx % siteAssignments.length];
    const shift = shiftById.get(a.shiftId!)!;
    rows.push({
      id: `ng-s${i + 1}`,
      guardId: a.guardId,
      siteId: shift.siteId,
      counterpartGuardId: null,
      reason: i === 1 ? "現場との相性" : "監督NG",
    });
  });

  // 人 × 人 の NG を2件（同じ枠に入っている2名から採る）
  const pairs = SHIFTS.map((shift) =>
    siteAssignments.filter((a) => a.shiftId === shift.id),
  ).filter((list) => list.length >= 2);
  [3, 12].forEach((idx, i) => {
    const list = pairs[idx % pairs.length];
    rows.push({
      id: `ng-p${i + 1}`,
      guardId: list[0].guardId,
      siteId: null,
      counterpartGuardId: list[1].guardId,
      reason: "不仲",
    });
  });

  return rows;
})();

/** 過去にその現場へ入ったことがあるか（★の元データ）。本来は assignments の履歴から引く */
export const SITE_EXPERIENCE: ReadonlySet<string> = new Set(
  ASSIGNMENTS.filter((a) => a.kind === "site" && a.shiftId)
    .map((a) => {
      const shift = SHIFTS.find((s) => s.id === a.shiftId)!;
      return `${a.guardId}:${shift.siteId}`;
    })
    // 6割ほどを「経験あり」にする
    .filter((_, i) => i % 10 < 6),
);

export const BOARD_DATE = WORK_DATE;

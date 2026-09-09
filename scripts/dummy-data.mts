// ダミーデータの定義。**seed SQL を作るためだけに使う**（アプリからは読まない）。
//
// 🔴 なぜ src/ ではなく scripts/ に置くのか（2026-09-02 移動）
//   段2 でアプリのデータ元を Supabase に移したため、src/ に置くと
//   **アプリが読まないコードを型検査し続ける**ことになる。
//   ここは開発ツールであって、システムの一部ではない。
//   → 使い方は scripts/gen-seed.mts のコメントを見る。
//
// 🔴 **本番データは持ち込まない**（CLAUDE.md）。氏名・現場名・得意先名はすべて架空。
//    苗字に連番を付けてあるのは、実在の人物と取り違えないようにするため。
//
// 規模は実測に合わせる（as-genjo-kansei.md §5 / shiftmax-api-analysis.md §10-2）：
//   日勤の稼働 約68名 ／ 現場 40件超 ／ プレート 平日 約150枚
// **密度が現実と違うと画面設計の検証にならない**ため、件数だけは実物に寄せる。
//
// 🔴 型はこのファイル内で完結させる（src/lib/types.ts を参照しない）。
//   あちらは **DB の列と一対一（snake_case）** に揃えてあり、
//   ここは「生成しやすい形」でよい。DB の列名への対応付けは gen-seed.mts が持つ。
//   道具がシステムの型に引きずられると、システム側を直すたびに道具が壊れる。

type Jurisdiction = {
  id: string; code: string; name: string;
  allowCrossStaff: boolean; allowCrossSite: boolean;
};
type Company = { id: string; kind: "own" | "partner"; name: string };
type Qualification = { id: string; shortLabel: string; name: string };
type Department = { id: string; code: string; name: string; jurisdictionId: string };
type Customer = {
  id: string; name: string; nameKana: string; contactName: string;
  billingNo: string; billingName: string; jurisdictionId: string;
};
type Site = {
  id: string; guardPostNo: string; name: string; shortName: string;
  nameKana: string; address: string; bandName: string; billingNo: string;
  // 🔴 予定のひな形。これが空だと「現場を選ぶと時刻・休憩が自動で入る」
  //   という中核の体験（べんり君の引き継ぎ）が一度も発動しない。
  // 🔴 ただし **null を許す**（2026-09-09）。実データには予定を持たない現場があり
  //   （ShiftMax の勤務予定フラグ＝`has_plan` がその証拠）、全件を埋めたダミーでは
  //   「予定が無い現場」の見え方も、そこで起きる不具合も検証できない。
  planStartH: number | null; planStartM: number | null;
  planEndH: number | null; planEndM: number | null; planBreak: number | null;
  hasPlan: boolean;
  customerId: string; jurisdictionId: string; departmentId: string;
  requiredQualificationIds: string[];
};
type Guard = {
  id: string; personCode: string | null; guardNo: string | null;
  name: string; shortName: string; nameKana: string; email: string | null;
  companyId: string; jurisdictionId: string; departmentId: string;
  qualificationIds: string[];
};
type Shift = {
  id: string; siteId: string; workDate: string; jurisdictionId: string;
  workKind: "day" | "nightA" | "nightB" | "dayCancel" | "nightCancel";
  headcount: number; startH: number; startM: number; endH: number; endM: number;
  breakMin: number; bandName: string; planComment: string; billingNote: string;
  status: "draft" | "confirmed";
};
type Assignment = {
  id: string; guardId: string; workDate: string;
  kind: "site" | "lent_out" | "off";
  shiftId: string | null;
  role: "leader" | "member";
  isLongDistance: boolean; position: number;
  offKind: string | null;
  lentToCompanyId: string | null; externalSiteName: string | null;
  status: "planned" | "canceled";
};
type NgEntry = {
  id: string; guardId: string; siteId: string | null;
  counterpartGuardId: string | null; reason: string;
};

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

// 🔴 部署。ShiftMax のマスタにある区分で、A表・引き渡しの単位ではないが
//   隊員と現場の両方に付く（data-model.md §3-2）。ダミーでも空にしない ─
//   空のままだと一覧に「—」が並び、画面の検証にならない。
export const DEPARTMENTS: Department[] = [
  { id: "d-1", code: "101", name: "第一警備部", jurisdictionId: "j-10" },
  { id: "d-2", code: "102", name: "第二警備部", jurisdictionId: "j-10" },
  { id: "d-3", code: "201", name: "千葉営業所", jurisdictionId: "j-20" },
];

/** 苗字とフリガナの対。SURNAMES と同じ並びにする */
const SURNAME_KANA = [
  "サトウ", "スズキ", "タカハシ", "タナカ", "イトウ", "ワタナベ", "ヤマモト", "ナカムラ",
  "コバヤシ", "カトウ", "ヨシダ", "ヤマダ", "ササキ", "ヤマグチ", "マツモト", "イノウエ",
  "キムラ", "ハヤシ", "サイトウ", "シミズ",
];

/** 現場の接尾辞のフリガナ。SITE_SUFFIX と同じ並びにする */
const SITE_SUFFIX_KANA = [
  "エキマエコウク", "キタグチカイリョウ", "ダイニコウク", "コセンキョウ", "ジョウゲスイドウ",
  "ホンセンキリカエ", "ミナミグチヒロバ", "チカマイセツ", "デンセンキョウドウコウ", "キョウリョウホシュウ",
];

/** 住所。架空の町名にする（実在の現場と取り違えないため） */
const WARDS = [
  "東京都千代田区", "東京都港区", "東京都江東区", "東京都大田区", "東京都足立区",
  "千葉県船橋市", "千葉県市川市",
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

/** 得意先のフリガナ。CUSTOMER_NAMES と同じ並びにする */
const CUSTOMER_KANA = [
  "アルファケンセツ", "ブラボーコウギョウ", "チャーリーデンセツ", "デルタドボク", "エコーカイハツ",
  "フォックスケンキ", "ゴルフドウロ", "ホテルセツビ", "インディアケンセツ", "ジュリエットコウギョウ",
];

export const CUSTOMERS: Customer[] = CUSTOMER_NAMES.map((name, i) => ({
  id: `cu-${i + 1}`,
  name,
  nameKana: CUSTOMER_KANA[i],
  // 得意先は「顧客名」より担当者で呼ばれることがあるため埋めておく
  contactName: `${SURNAMES[(i * 3) % SURNAMES.length]} 様`,
  billingNo: `B${String(9000 + i * 11)}`,
  billingName: name,
  jurisdictionId: i % 4 === 0 ? "j-20" : "j-10",
}));

const rng = makeRng(20260901);

/** 管轄に属する部署から1つ選ぶ（決定的） */
function departmentForJurisdiction(jurisdictionId: string, seed: number): string {
  const list = DEPARTMENTS.filter((d) => d.jurisdictionId === jurisdictionId);
  return list[seed % list.length].id;
}

/** "cu-3" → 3 */
function idNumOf(id: string): number {
  return Number(id.split("-").pop());
}

// 🔴 得意先の付き方は**均等ではない**（2026-09-02・管制の実感より）。
//   「毎日たくさん現場をくれる会社が1社あり、残りは数社」。
//   均等に配ると、実際に起きる「1社で20件超」の見え方を検証できない。
const DOMINANT_SITE_RATIO = 0.55;

function customerForSite(index: number, total: number) {
  // 過半を大口1社に寄せ、残りをその他へ回す
  if (index < Math.floor(total * DOMINANT_SITE_RATIO)) return CUSTOMERS[0];
  return CUSTOMERS[1 + ((index - Math.floor(total * DOMINANT_SITE_RATIO)) % (CUSTOMERS.length - 1))];
}

/** 予定のひな形。現場ごとに固定で、枠を作るときの既定値になる。
 *  🔴 全部を 8:00–17:00 にしない。同じ値ばかりだと
 *     「現場を選ぶと時刻が入れ替わる」ことが画面で確かめられない。 */
const PLAN_PATTERNS = [
  { sh: 8, sm: 0, eh: 17, em: 0, br: 60 },
  { sh: 8, sm: 30, eh: 17, em: 30, br: 60 },
  { sh: 7, sm: 0, eh: 16, em: 0, br: 45 },
  { sh: 9, sm: 0, eh: 18, em: 0, br: 90 },
  { sh: 20, sm: 0, eh: 5, em: 0, br: 60 },
];

export const SITES: Site[] = Array.from({ length: 42 }, (_, i) => {
  const customer = customerForSite(i, 42);
  const suffixIndex = Math.floor(rng() * SITE_SUFFIX.length);
  const suffix = SITE_SUFFIX[suffixIndex];
  // 現場の 1/4 ほどに必要資格を設定する（全部に付けると警告だらけで検証にならない）
  const required =
    rng() < 0.25 ? [rng() < 0.5 ? "q-k2" : "q-k1"] : [];
  const jurisdictionId = i % 9 === 0 ? "j-20" : "j-10";
  // 🔴 13件に1件を「予定を持たない現場」にする（i = 5, 18, 31 の3件）。
  //   rng() を使わないのは、**既存のダミーの並びを1件もずらさない**ため
  //   （乱数を1回余計に引くと、以降の資格・配置が全部変わる）。
  const noPlan = i % 13 === 5;
  const plan = PLAN_PATTERNS[i % PLAN_PATTERNS.length];
  return {
    id: `s-${i + 1}`,
    guardPostNo: String(55000 + i * 7),
    name: `${customer.name.slice(0, 4)} ${suffix}`,
    shortName: suffix.slice(0, 4),
    nameKana: `${CUSTOMER_KANA[idNumOf(customer.id) - 1].slice(0, 4)} ${SITE_SUFFIX_KANA[suffixIndex]}`,
    address: `${WARDS[i % WARDS.length]}${1 + (i % 5)}-${1 + (i % 9)}-${1 + (i % 20)}`,
    // 班名は A表のまとまりに出る（shifts 側にも持つが、現場の既定値をここに置く）
    bandName: `${["A", "B", "C"][i % 3]}班`,
    billingNo: `S${String(7000 + i * 3)}`,
    planStartH: noPlan ? null : plan.sh,
    planStartM: noPlan ? null : plan.sm,
    planEndH: noPlan ? null : plan.eh,
    planEndM: noPlan ? null : plan.em,
    planBreak: noPlan ? null : plan.br,
    hasPlan: !noPlan,
    customerId: customer.id,
    jurisdictionId,
    departmentId: departmentForJurisdiction(jurisdictionId, i),
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
  const jurisdictionId = i % 11 === 0 ? "j-20" : "j-10";
  return {
    id: `g-${i + 1}`,
    // 🔴 協力会社の隊員は ShiftMax の個人コード・隊員ナンバーを持たない
    //   （shiftmax-api-analysis.md §10-3）。持たないことが正常な状態。
    personCode: isPartner ? null : String(30000 + i * 3),
    guardNo: isPartner ? null : String(1000 + i),
    name: `${surname}${num}`,
    shortName: `${surname}${num}`,
    nameKana: `${SURNAME_KANA[i % SURNAME_KANA.length]}${num}`,
    // 🔴 ShiftMax にある唯一の連絡先がメール（電話・LINE は無い）
    email: isPartner ? null : `guard${num}@example.invalid`,
    companyId: company.id,
    jurisdictionId,
    departmentId: departmentForJurisdiction(jurisdictionId, i),
    qualificationIds: quals,
  };
});

const WORK_DATE = "2026-09-01";

/** 開始時刻から勤務区分と休憩を決める（as-genjo-kansei.md §4-4） */
function breakMinFor(startH: number, isNight: boolean): number {
  if (!isNight) return 60;
  return startH < 23 ? 60 : 0; // 夜A=60分 / 夜B=0分
}

// 🔴 必要人数は「平均 1.7名／1名の現場が相当数ある」に寄せる（2026-09-04 修正）。
//
//   それまでは `1 + floor(rng() * 5)`（1〜5の一様乱数・平均3.3）で、
//   **実測のほぼ2倍**だった。これが2つの実害を出していた：
//
//   ① 42枠の必要人数が 138名 になり、隊員 104名（うち15名は非現場・貸出）では
//      **どう配っても足りず、同じ人を同じ時間帯の2枠に入れるしかなかった**。
//      ＝ダミーの時点で `assignments_no_overlap` に触れる状態で、
//        一括確定が最初から通らなかった（2026-09-04・柴山の報告）
//   ② カードは「1名の枠が多い」前提で**箱**に組み替えてある（2026-09-02）。
//      平均3.3名では、その判断を確かめられる絵になっていない
//
//   → 実測（40現場・68名＝平均1.7）に寄せる。5名の枠も1割入れておく
//     ─ プレート3枚並びの折り返しを確かめる材料が要るため。
//   🔴 rng() の消費回数は1回のまま変えない。増減させると以降の乱数が全部ずれ、
//     現場名・確定/仮組み・資格の割り当てまで別物になる。
const HEADCOUNTS = [1, 1, 1, 1, 1, 1, 2, 2, 3, 5];

export const SHIFTS: Shift[] = SITES.map((site, i) => {
  const isNight = i % 3 === 2;
  const startH = isNight ? (i % 6 === 5 ? 23 : 20) : 8 + (i % 2);
  const endH = isNight ? 6 : 17 + (i % 2);
  const headcount = HEADCOUNTS[Math.floor(rng() * HEADCOUNTS.length)];
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
  };
});

/**
 * 配置。枠の人数をだいたい満たすが、一部わざと不足させる。
 *
 * 🔴 **1人が同じ時間帯に2か所へ入るデータを作らない**（2026-09-04 修正）。
 *   以前は隊員カーソルを `% GUARDS.length` で一巡させており、
 *   人数が足りなくなると**先頭に戻って同じ人をもう一度置いていた**。
 *   結果、ダミーの時点で 13件の重なりがあり、
 *   `assignments_no_overlap` に触れて**一括確定が最初から通らなかった**。
 *   （`gen-seed.mts` は「確定どうし」だけを落としていたため、
 *     仮組みを含む重なりが残り、確定した瞬間に表面化した）
 *
 * 🔴 重なりの規則は DB（`assignments_no_overlap`）と揃える。
 *   時刻は「その日の 0:00 からの分」で持ち、**終了が開始以下なら翌日**
 *   （夜勤 20:00 → 06:00）── `supabase/migrations/20260903000000_...` と同じ。
 *
 * 🟢 日勤と夜勤の掛け持ちは**禁じない**（8/27「日勤＋夜勤・途中交代がある」）。
 *   禁じるのは**時間帯が重なること**だけ。ただし掛け持ちは最後の手段にし、
 *   まだ何も入っていない人から先に配る（半分が掛け持ちでは実態と違う）。
 */
export const ASSIGNMENTS: Assignment[] = (() => {
  const rows: Assignment[] = [];
  let seq = 1;

  /** その日の 0:00 からの分。日跨ぎは +24h（DB のトリガーと同じ規則） */
  function spanOf(shift: Shift): [number, number] {
    const start = shift.startH * 60 + shift.startM;
    let end = shift.endH * 60 + shift.endM;
    if (end <= start) end += 24 * 60;
    return [start, end];
  }

  /** 現場に入っている時間帯（隊員ごと） */
  const busy = new Map<string, [number, number][]>();
  /** 非現場・貸出。その日は現場に立たない */
  const exclusive = new Set<string>();

  // ── 先に非現場・貸出の人を確保する ──
  //   後回しにすると、現場に配り終わったあとで空いている人が居なくなり、
  //   **有給の人が現場にも立っている**という有り得ないデータになる
  //   （以前は実際にそうなっていた）。
  //   7人おきに採るのは、連番で固まって「前のほうの人だけ休む」絵にしないため。
  const offKinds = [
    "paid_leave", "paid_leave", "paid_leave",
    "training", "training",
    "night_duty", "night_duty",
    "absent_self", "medical", "office", "standby", "control",
  ] as const;
  const lents = [
    { companyId: "c-p1", site: "◯◯地区 交通規制" },
    { companyId: "c-p1", site: "◯◯地区 交通規制" },
    { companyId: "c-p2", site: "△△ビル 竣工警備" },
  ];
  const reserved = [...offKinds, ...lents].map((_, i) => GUARDS[(i * 7) % GUARDS.length]);
  for (const g of reserved) exclusive.add(g.id);

  // ── 現場への配置 ──
  let cursor = 0;

  /** その時間帯に入れる隊員を1人返す。誰も居なければ null（＝その枠は埋まらない） */
  function take(span: [number, number]): (typeof GUARDS)[number] | null {
    const fits = (id: string) =>
      (busy.get(id) ?? []).every(([s, e]) => span[0] >= e || span[1] <= s);

    // ① まだ何も入っていない人から配る
    for (let k = 0; k < GUARDS.length; k++) {
      const g = GUARDS[(cursor + k) % GUARDS.length];
      if (exclusive.has(g.id) || busy.has(g.id)) continue;
      cursor = (cursor + k + 1) % GUARDS.length;
      return g;
    }
    // ② 全員に1件入っている。ここで初めて掛け持ちを許す（重ならない場合だけ）
    for (let k = 0; k < GUARDS.length; k++) {
      const g = GUARDS[(cursor + k) % GUARDS.length];
      if (exclusive.has(g.id) || !fits(g.id)) continue;
      cursor = (cursor + k + 1) % GUARDS.length;
      return g;
    }
    return null;
  }

  SHIFTS.forEach((shift, shiftNo) => {
    const span = spanOf(shift);
    // 5枠に1つは1名不足させる（未充足の見え方を確認するため）。
    // 🔴 判定に seq（行の通し番号）を使っていたのを枠の番号に直した（2026-09-04）。
    //   seq は枠ごとに人数ぶん進むため、「5枠に1つ」と書いてありながら
    //   実際は 42枠中15枠が不足していた。コメントと動きが違っていた。
    const filled = shiftNo % 5 === 4 ? Math.max(0, shift.headcount - 1) : shift.headcount;
    for (let n = 0; n < filled; n++) {
      const guard = take(span);
      if (!guard) break; // 人が尽きた。埋まらない枠が出るのは実際に起きること
      busy.set(guard.id, [...(busy.get(guard.id) ?? []), span]);
      rows.push({
        id: `a-${seq++}`,
        guardId: guard.id,
        workDate: WORK_DATE,
        kind: "site",
        shiftId: shift.id,
        role: n === 0 ? "leader" : "member",
        isLongDistance: false,
        position: n,
        offKind: null,
        lentToCompanyId: null,
        externalSiteName: null,
        status: "planned",
      });
    }
  });

  // 非現場ステータス
  offKinds.forEach((offKind, i) => {
    rows.push({
      id: `a-${seq++}`,
      guardId: reserved[i].id,
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
  lents.forEach((lent, i) => {
    rows.push({
      id: `a-${seq++}`,
      guardId: reserved[offKinds.length + i].id,
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

/**
 * 隊員の連絡先（2026-09-09 追加）。
 *
 * 🔴 これが空だと一斉連絡（S-03）の中核 ─ LINE 可／不可の振り分け ─ が
 *   一度も発動しない。全員が「連絡先未登録」になり、画面の検証にならない。
 *   9/8 に「情報が少ない原因は画面ではなくデータだった」を踏んだので、同じ轍を踏まない。
 *
 * 🔴 比率は実測に寄せる：**LINE が繋がらない隊員が約4割**（2026-08-27 管制ヒアリング）。
 *   ここでは 5人に2人（i % 5 が 0 または 1）を LINE 不可にしている。
 *
 * 🔴 rng() を使わない。乱数を1回でも余計に引くと、既存のダミー（資格・配置）が
 *   すべてずれる。並びを1件も動かさないため、添字だけで決める。
 */
export type GuardContact = {
  guardId: string;
  kind: "phone" | "line";
  value: string;
  reachable: boolean;
  isPrimary: boolean;
};

export const GUARD_CONTACTS: GuardContact[] = GUARDS.flatMap((g, i) => {
  // 17人に1人は連絡先そのものが無い ─ 取りこぼしが画面で見えるようにする
  if (i % 17 === 3) return [];

  const tail = String(1000 + i).slice(-4);
  const rows: GuardContact[] = [
    {
      guardId: g.id,
      kind: "phone",
      value: `090-${String(1000 + i * 7).slice(-4)}-${tail}`,
      reachable: true,
      isPrimary: true,
    },
  ];

  const mod = i % 5;
  if (mod === 0) {
    // LINE は登録してあるが繋がらない（機種変・未設定など）。これが4割の片方
    rows.push({
      guardId: g.id,
      kind: "line",
      value: `line-${g.id}`,
      reachable: false,
      isPrimary: false,
    });
  } else if (mod >= 2) {
    // LINE が繋がる
    rows.push({
      guardId: g.id,
      kind: "line",
      value: `line-${g.id}`,
      reachable: true,
      isPrimary: false,
    });
  }
  // mod === 1 は LINE を持たない（電話のみ）。4割のもう片方
  return rows;
});

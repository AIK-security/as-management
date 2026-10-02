// マスタの新規登録フォーム（2026-09-09）。現場・隊員・得意先の3本。
//
// 🔴 入れるのは最小限だけ。
//   詳細画面は「項目を隠さない」方針だが、**作るときは速さが要る**。
//   全項目を並べると、当日の飛び込みで手が止まる。
//   足りないぶんは、作成後に飛ばされる詳細画面で埋める。
//
// 🔴 成功時の遷移は**この画面側**が `useRouter()` で行う（2026-09-14 変更）。
//   以前は Server Action の `redirect()` に任せていたが、Next 16 は内部リダイレクトを
//   クライアント側の Promise の reject で返すだけで、素の `onClick` から `await` している
//   呼び出しには届かない。＝**現場や隊員は作られるのに画面が動かず、
//   ボタンが「作成中…」のまま固まる**。経緯は `src/lib/action-call.ts`。
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSite } from "@/app/masters/sites/actions";
import { createGuard } from "@/app/masters/guards/actions";
import { createCustomer } from "@/app/masters/customers/actions";
import { FIELD, Field, Notice, Section } from "@/components/masters/FormBits";
import { callAction } from "@/lib/action-call";

type Created = { ok: true; id: string } | { ok: false; message: string };

const SUBMIT =
  "rounded-md bg-indigo-600 px-4 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:opacity-50";

/** 3本で共通の「送信して、作れたら詳細へ、失敗したら理由を出す」 */
function useCreate(basePath: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<Created>) {
    setPending(true);
    setError(null);
    const r = await callAction(fn);
    if (!r.ok) {
      setPending(false);
      setError(r.message);
      return;
    }
    // 🔴 成功しても pending は戻さない。**二重に作らせないため。**
    //   ここから詳細画面へ切り替わるので、押せないままで困らない。
    router.push(`${basePath}/${r.id}`);
  }
  return { pending, error, run };
}

// ─────────────────────────────────────────────────────────
// 現場
// ─────────────────────────────────────────────────────────

export function SiteCreateForm({
  options,
}: {
  options: {
    customers: { id: string; name: string }[];
    jurisdictions: { id: string; name: string }[];
  };
}) {
  const { pending, error, run } = useCreate("/masters/sites");
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [jurisdictionId, setJurisdictionId] = useState(options.jurisdictions[0]?.id ?? "");
  const [customerId, setCustomerId] = useState("");

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Section title="新しい現場" hint="残りの項目は作成後の画面で埋めます">
        <div className="grid grid-cols-2 gap-2">
          <Field label="現場名" hint="必須">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </Field>
          <Field label="略称" hint="空なら現場名の先頭8字。プレート・A表に出る">
            <input
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder={name.slice(0, 8)}
              className={FIELD}
            />
          </Field>
          <Field label="管轄" hint="必須">
            <select
              value={jurisdictionId}
              onChange={(e) => setJurisdictionId(e.target.value)}
              className={FIELD}
            >
              {options.jurisdictions.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="得意先" hint="あとで設定してよい">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={FIELD}
            >
              <option value="">（未設定）</option>
              {options.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {error && <Notice kind="error">{error}</Notice>}

      <div>
        <button
          type="button"
          disabled={pending || name.trim() === ""}
          onClick={() =>
            run(() => createSite({ name, shortName, jurisdictionId, customerId }))
          }
          className={SUBMIT}
        >
          {pending ? "作成中…" : "作成して続きを入力"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 隊員
// ─────────────────────────────────────────────────────────

const EMPLOYMENT = [
  { value: "employee", label: "社員" },
  { value: "part_time", label: "パート" },
  { value: "partner", label: "協力会社" },
];

export function GuardCreateForm({
  options,
}: {
  options: {
    companies: { id: string; name: string; kind: string }[];
    jurisdictions: { id: string; name: string }[];
  };
}) {
  const { pending, error, run } = useCreate("/masters/guards");
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [nameKana, setNameKana] = useState("");
  const [staffCode, setStaffCode] = useState("");
  const [companyId, setCompanyId] = useState(options.companies[0]?.id ?? "");
  const [jurisdictionId, setJurisdictionId] = useState(options.jurisdictions[0]?.id ?? "");
  const [employmentType, setEmploymentType] = useState("employee");

  const isPartner = options.companies.find((c) => c.id === companyId)?.kind === "partner";

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Section title="新しい隊員" hint="資格・連絡先は作成後の画面で登録します">
        <div className="grid grid-cols-2 gap-2">
          <Field label="氏名" hint="必須">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </Field>
          <Field label="略称" hint="空なら氏名の先頭4字。プレートに出る">
            <input
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder={name.slice(0, 4)}
              className={FIELD}
            />
          </Field>
          <Field label="フリガナ">
            <input
              value={nameKana}
              onChange={(e) => setNameKana(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Field
            label="個人コード"
            hint={isPartner ? "協力会社は空でよい" : "ShiftMax の実質キー"}
          >
            <input
              value={staffCode}
              onChange={(e) => setStaffCode(e.target.value)}
              className={FIELD + " font-mono"}
            />
          </Field>
          <Field label="会社" hint="必須">
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={FIELD}
            >
              {options.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.kind === "partner" ? "（協力）" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="管轄" hint="必須">
            <select
              value={jurisdictionId}
              onChange={(e) => setJurisdictionId(e.target.value)}
              className={FIELD}
            >
              {options.jurisdictions.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="雇用区分">
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              className={FIELD}
            >
              {EMPLOYMENT.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {error && <Notice kind="error">{error}</Notice>}

      <div>
        <button
          type="button"
          disabled={pending || name.trim() === ""}
          onClick={() =>
            run(() =>
              createGuard({
                name,
                shortName,
                nameKana,
                staffCode,
                companyId,
                jurisdictionId,
                employmentType,
              }),
            )
          }
          className={SUBMIT}
        >
          {pending ? "作成中…" : "作成して続きを入力"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 得意先
// ─────────────────────────────────────────────────────────

export function CustomerCreateForm() {
  const { pending, error, run } = useCreate("/masters/customers");
  const [name, setName] = useState("");
  const [staffCode, setStaffCode] = useState("");
  const [nameKana, setNameKana] = useState("");
  const [contactName, setContactName] = useState("");

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Section title="新しい得意先" hint="請求番号などは作成後の画面で埋めます">
        <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[12px] leading-snug text-amber-900">
          得意先は ShiftMax 由来のマスタで、
          <span className="font-semibold">請求（第2弾）の突き合わせに使います</span>。
          既にあるものを重複して作らないよう、先に一覧で探してください。
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="顧客名" hint="必須">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </Field>
          <Field label="担当コード" hint="必須・重複不可">
            <input
              value={staffCode}
              onChange={(e) => setStaffCode(e.target.value)}
              className={FIELD + " font-mono"}
            />
          </Field>
          <Field label="フリガナ">
            <input
              value={nameKana}
              onChange={(e) => setNameKana(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Field label="担当名">
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className={FIELD}
            />
          </Field>
        </div>
      </Section>

      {error && <Notice kind="error">{error}</Notice>}

      <div>
        <button
          type="button"
          disabled={pending || name.trim() === "" || staffCode.trim() === ""}
          onClick={() => run(() => createCustomer({ name, staffCode, nameKana, contactName }))}
          className={SUBMIT}
        >
          {pending ? "作成中…" : "作成して続きを入力"}
        </button>
      </div>
    </div>
  );
}

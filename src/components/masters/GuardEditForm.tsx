// 隊員マスタの編集フォーム（2026-09-09）。
//
// 🔴 現場（S-10）と同じ作法で書く。項目を隠さない／window.confirm は使わない／
//   削除は件数を出してから。画面ごとに作法が違うと 1名体制では覚えていられない。
//
// 🔴 個人コードは「空でよい」ことを画面で言う。
//   協力会社の隊員は ShiftMax に個人単位で存在せず、コードを持たない（CLAUDE.md）。
//   空欄が**異常ではない**と分からないと、管制が埋めようとして偽の値が入る。
"use client";

import { useState } from "react";
import { deleteGuard, updateGuard } from "@/app/masters/guards/actions";
import type { GuardDetail, GuardRefs } from "@/lib/masters";
import { FIELD, Field, Section } from "@/components/masters/FormBits";

const EMPLOYMENT: { value: string; label: string }[] = [
  { value: "employee", label: "社員" },
  { value: "part_time", label: "パート" },
  { value: "partner", label: "協力会社" },
];

export function GuardEditForm({
  guard,
  options,
  refs,
}: {
  guard: GuardDetail;
  options: {
    companies: { id: string; name: string; kind: string }[];
    jurisdictions: { id: string; name: string }[];
    departments: { id: string; name: string; jurisdiction_id: string }[];
  };
  refs: GuardRefs;
}) {
  const [staffCode, setStaffCode] = useState(guard.staff_code ?? "");
  const [guardNo, setGuardNo] = useState(guard.guard_no ?? "");
  const [name, setName] = useState(guard.name);
  const [shortName, setShortName] = useState(guard.short_name);
  const [nameKana, setNameKana] = useState(guard.name_kana ?? "");
  const [email, setEmail] = useState(guard.email ?? "");
  const [companyId, setCompanyId] = useState(guard.company_id);
  const [jurisdictionId, setJurisdictionId] = useState(guard.jurisdiction_id);
  const [departmentId, setDepartmentId] = useState(guard.department_id ?? "");
  const [employmentType, setEmploymentType] = useState(guard.employment_type);
  const [status, setStatus] = useState(guard.status);
  const [note, setNote] = useState(guard.note ?? "");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);

  // 🔴 直したら「保存しました」を消す（S-10 と同じ。未保存が保存済みに見えないように）
  function edit<T>(set: (v: T) => void): (v: T) => void {
    return (v) => {
      setSaved(false);
      set(v);
    };
  }

  // 部署は管轄にぶら下がる。管轄を変えたら選び直し
  const departments = options.departments.filter((d) => d.jurisdiction_id === jurisdictionId);
  const company = options.companies.find((c) => c.id === companyId);
  const isPartner = company?.kind === "partner";

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    const r = await updateGuard({
      id: guard.id,
      staffCode,
      guardNo,
      name,
      shortName,
      nameKana,
      email,
      companyId,
      jurisdictionId,
      departmentId,
      employmentType,
      status,
      note,
    });
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 🔴 保存・削除は**画面の上**に置く（2026-09-09・柴山の指摘）。
          「データの途中に保存ボタンがあるUIは聞いたことがない」── そのとおりで、
          項目の間に挟まっていた。下に置くと項目が増えるほど遠くなるので、
          上に置いて sticky で貼り付ける（スクロールしても押せる）。 */}
      <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 border-b border-slate-200 bg-slate-100/95 px-1 py-2 backdrop-blur">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存する"}
        </button>

        <div className="ml-auto">
          {!asking ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-medium text-rose-700 transition-all duration-150 ease-in-out hover:bg-rose-50"
            >
              この隊員を削除
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5">
              <span className="text-[13px] text-rose-900">
                {!refs.ok ? (
                  // 🔴 数えられなかったときに「0件」と出して押させない（S-10 と同じ）
                  <>
                    <span className="font-semibold">
                      関連するデータの件数を確認できませんでした。
                    </span>
                    画面を開き直してください。
                  </>
                ) : refs.assignments > 0 ? (
                  <>
                    <span className="font-semibold">
                      稼働が {refs.assignments} 件あるため削除できません。
                    </span>
                    状態を「停止」にしてください。
                  </>
                ) : (
                  <>
                    削除すると
                    <span className="font-semibold">
                      資格 {refs.qualifications} 件・連絡先 {refs.contacts} 件・NG {refs.ngEntries}{" "}
                      件
                    </span>
                    も一緒に消えます。戻せません。
                  </>
                )}
              </span>
              {refs.ok && refs.assignments === 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    const r = await deleteGuard({ id: guard.id });
                    setPending(false);
                    // 成功時は Server Action 側で一覧へ戻すため、ここに来るのは失敗のとき
                    if (r && !r.ok) setError(r.message);
                  }}
                  className="rounded-md bg-rose-600 px-2.5 py-1 text-[13px] font-semibold text-white transition-all duration-150 ease-in-out hover:bg-rose-700 disabled:opacity-50"
                >
                  削除する
                </button>
              )}
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
              >
                やめる
              </button>
            </div>
          )}
        </div>

        {/* 🔴 結果はボタンの隣に出す。離れた場所に出すと、押したのに気づかれない */}
        {error && (
          <span className="ml-3 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[13px] text-rose-700">
            {error}
          </span>
        )}
        {saved && !error && (
          <span className="ml-3 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[13px] text-emerald-700">
            保存しました。
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Section title="識別">
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="個人コード"
              hint={isPartner ? "協力会社は空でよい" : "ShiftMax の実質キー"}
            >
              <input
                value={staffCode}
                onChange={(e) => edit(setStaffCode)(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="隊員No">
              <input
                value={guardNo}
                onChange={(e) => edit(setGuardNo)(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="雇用区分">
              <select
                value={employmentType}
                onChange={(e) => edit(setEmploymentType)(e.target.value)}
                className={FIELD}
              >
                {EMPLOYMENT.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="状態">
              <select
                value={status}
                onChange={(e) => edit(setStatus)(e.target.value)}
                className={FIELD}
              >
                <option value="active">在籍</option>
                <option value="inactive">停止</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section title="名称">
          <div className="grid grid-cols-2 gap-2">
            <Field label="氏名">
              <input
                value={name}
                onChange={(e) => edit(setName)(e.target.value)}
                className={FIELD}
              />
            </Field>
            <Field label="略称" hint="プレートに出る">
              <input
                value={shortName}
                onChange={(e) => edit(setShortName)(e.target.value)}
                className={FIELD}
              />
            </Field>
            <Field label="フリガナ">
              <input
                value={nameKana}
                onChange={(e) => edit(setNameKana)(e.target.value)}
                className={FIELD}
              />
            </Field>
            <Field label="メール" hint="ShiftMax にある唯一の連絡先">
              <input
                value={email}
                onChange={(e) => edit(setEmail)(e.target.value)}
                className={FIELD}
              />
            </Field>
          </div>
        </Section>

        <Section title="所属">
          <div className="grid grid-cols-2 gap-2">
            <Field label="会社">
              <select
                value={companyId}
                onChange={(e) => edit(setCompanyId)(e.target.value)}
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
            <Field label="管轄">
              <select
                value={jurisdictionId}
                onChange={(e) => {
                  edit(setJurisdictionId)(e.target.value);
                  setDepartmentId(""); // 管轄が変われば部署は選び直し
                }}
                className={FIELD}
              >
                {options.jurisdictions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="部署">
              <select
                value={departmentId}
                onChange={(e) => edit(setDepartmentId)(e.target.value)}
                className={FIELD}
              >
                <option value="">（未設定）</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="備考">
              <input
                value={note}
                onChange={(e) => edit(setNote)(e.target.value)}
                className={FIELD}
              />
            </Field>
          </div>
        </Section>
      </div>

    </div>
  );
}

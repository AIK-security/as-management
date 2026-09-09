// 得意先マスタの編集フォーム（2026-09-09）。
//
// 🔴 現場（S-10）・隊員（S-11）と同じ作法。項目を隠さない／window.confirm は使わない／
//   削除は件数を出してから。
//
// 🔴 状態（稼働・停止）の欄は無い。customers に status 列が存在しないため
//   （2026-09-08 に確認）。無い列の欄を描くと、押しても効かない欄になる。
"use client";

import { useState } from "react";
import { deleteCustomer, updateCustomer } from "@/app/masters/customers/actions";
import type { CustomerDetail, CustomerRefs } from "@/lib/masters";
import { FIELD, Field, Section } from "@/components/masters/FormBits";

export function CustomerEditForm({
  customer,
  options,
  refs,
}: {
  customer: CustomerDetail;
  options: {
    jurisdictions: { id: string; name: string }[];
    departments: { id: string; name: string; jurisdiction_id: string }[];
  };
  refs: CustomerRefs;
}) {
  const [staffCode, setStaffCode] = useState(customer.staff_code);
  const [name, setName] = useState(customer.name);
  const [nameKana, setNameKana] = useState(customer.name_kana ?? "");
  const [contactName, setContactName] = useState(customer.contact_name ?? "");
  const [billingNo, setBillingNo] = useState(customer.billing_no ?? "");
  const [billingName, setBillingName] = useState(customer.billing_name ?? "");
  const [jurisdictionId, setJurisdictionId] = useState(customer.jurisdiction_id ?? "");
  const [departmentId, setDepartmentId] = useState(customer.department_id ?? "");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);

  function edit<T>(set: (v: T) => void): (v: T) => void {
    return (v) => {
      setSaved(false);
      set(v);
    };
  }

  const departments = options.departments.filter((d) => d.jurisdiction_id === jurisdictionId);

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    const r = await updateCustomer({
      id: customer.id,
      staffCode,
      name,
      nameKana,
      contactName,
      billingNo,
      billingName,
      jurisdictionId,
      departmentId,
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
              この得意先を削除
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5">
              <span className="text-[13px] text-rose-900">
                {!refs.ok ? (
                  <>
                    <span className="font-semibold">現場の件数を確認できませんでした。</span>
                    画面を開き直してください。
                  </>
                ) : refs.sites > 0 ? (
                  <>
                    <span className="font-semibold">
                      この得意先の現場が {refs.sites} 件あるため削除できません。
                    </span>
                    先に現場の得意先を付け替えてください。
                  </>
                ) : (
                  <>
                    現場が付いていない得意先です。
                    <span className="font-semibold">削除すると戻せません。</span>
                  </>
                )}
              </span>
              {refs.ok && refs.sites === 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    const r = await deleteCustomer({ id: customer.id });
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
        <Section title="識別・名称">
          <div className="grid grid-cols-2 gap-2">
            <Field label="担当コード" hint="ShiftMax の実質キー">
              <input
                value={staffCode}
                onChange={(e) => edit(setStaffCode)(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="顧客名">
              <input
                value={name}
                onChange={(e) => edit(setName)(e.target.value)}
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
            <Field label="担当名" hint="得意先はこの名で呼ばれることがある">
              <input
                value={contactName}
                onChange={(e) => edit(setContactName)(e.target.value)}
                className={FIELD}
              />
            </Field>
          </div>
        </Section>

        <Section title="請求" hint="第2弾（請求）で使う">
          <div className="grid grid-cols-2 gap-2">
            <Field label="請求番号">
              <input
                value={billingNo}
                onChange={(e) => edit(setBillingNo)(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="請求名" hint="顧客名と違うことがある">
              <input
                value={billingName}
                onChange={(e) => edit(setBillingName)(e.target.value)}
                className={FIELD}
              />
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
                <option value="">（未設定）</option>
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
          </div>
        </Section>
      </div>

    </div>
  );
}

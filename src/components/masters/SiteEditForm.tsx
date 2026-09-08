// 現場マスタの編集フォーム（2026-09-08）。
//
// 🔴 項目を隠さない。
//   「その場で必ず要る情報／後で埋めればいい情報」の線引きは 9/16 に管制へ聞くが、
//   それは**新規作成の速さ**の話。既にある現場を直す画面で項目を伏せると、
//   直したい値に辿り着けない。速さが要るのは作るときで、ここではない。
//
// 🔴 window.confirm は使わない（2026-09-04 決定）。削除はその場で確認帯に変わる。
"use client";

import { useState } from "react";
import { TwoDigitInput } from "@/components/TwoDigitInput";
import { deleteSite, updateSite } from "@/app/masters/sites/actions";
import type { SiteDetail } from "@/lib/masters";

const FIELD =
  "h-9 w-full rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-slate-500">
        {label}
        {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="mb-2 text-[13px] font-semibold tracking-tight text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export function SiteEditForm({
  site,
  options,
  refs,
}: {
  site: SiteDetail;
  options: {
    customers: { id: string; name: string }[];
    jurisdictions: { id: string; name: string }[];
    departments: { id: string; name: string; jurisdiction_id: string }[];
  };
  refs: { shifts: number; requiredQualifications: number; ngEntries: number };
}) {
  const [siteCode, setSiteCode] = useState(site.site_code);
  const [guardTargetNo, setGuardTargetNo] = useState(site.guard_target_no);
  const [name, setName] = useState(site.name);
  const [shortName, setShortName] = useState(site.short_name);
  const [nameKana, setNameKana] = useState(site.name_kana ?? "");
  const [address, setAddress] = useState(site.address ?? "");
  const [bandName, setBandName] = useState(site.band_name ?? "");
  const [billingNo, setBillingNo] = useState(site.billing_no ?? "");
  const [startH, setStartH] = useState(site.plan_start_h ?? 8);
  const [startM, setStartM] = useState(site.plan_start_m ?? 0);
  const [endH, setEndH] = useState(site.plan_end_h ?? 17);
  const [endM, setEndM] = useState(site.plan_end_m ?? 0);
  const [breakMin, setBreakMin] = useState(site.plan_break ?? 60);
  const [hasPlan, setHasPlan] = useState(site.has_plan);
  const [customerId, setCustomerId] = useState(site.customer_id ?? "");
  const [jurisdictionId, setJurisdictionId] = useState(site.jurisdiction_id);
  const [departmentId, setDepartmentId] = useState(site.department_id ?? "");
  const [status, setStatus] = useState(site.status);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);

  // 🔴 部署は管轄にぶら下がる。管轄を変えたら選べる部署も変わる。
  //   全部署を出すと、別管轄の部署を付けられてしまう。
  const departments = options.departments.filter((d) => d.jurisdiction_id === jurisdictionId);
  const isTemporary = guardTargetNo.startsWith("TMP-") || siteCode.startsWith("TMP-");

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    const r = await updateSite({
      id: site.id,
      siteCode,
      guardTargetNo,
      name,
      shortName,
      nameKana,
      address,
      bandName,
      billingNo,
      planStartH: startH,
      planStartM: startM,
      planEndH: endH,
      planEndM: endM,
      planBreak: breakMin,
      hasPlan,
      customerId,
      jurisdictionId,
      departmentId,
      status,
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
      {isTemporary && (
        // 🔴 仮番号のままでは段3（べんり君への引き渡し）に出せない。
        //   9/7 に「新規現場は仮番号で通す」と決めた代わりに、ここで必ず気づかせる。
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          🔴 <span className="font-semibold">仮番号のままです。</span>
          この現場は「現場を追加」で作られ、警備先番号が決まっていません。
          <span className="font-semibold">本番号に直すまで、ShiftMax への引き渡しには出せません。</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Section title="識別">
          <div className="grid grid-cols-2 gap-2">
            <Field label="警備先番号" hint="べんり君の入力キー">
              <input
                value={guardTargetNo}
                onChange={(e) => setGuardTargetNo(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="現場コード">
              <input
                value={siteCode}
                onChange={(e) => setSiteCode(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="状態">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={FIELD}
              >
                <option value="active">稼働</option>
                <option value="inactive">停止</option>
              </select>
            </Field>
            <Field label="請求番号">
              <input
                value={billingNo}
                onChange={(e) => setBillingNo(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
          </div>
        </Section>

        <Section title="名称">
          <div className="grid grid-cols-2 gap-2">
            <Field label="現場名">
              <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
            </Field>
            <Field label="略称" hint="プレート・A表に出る">
              <input
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
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
            <Field label="班">
              <input
                value={bandName}
                onChange={(e) => setBandName(e.target.value)}
                className={FIELD}
              />
            </Field>
          </div>
        </Section>

        <Section title="所属">
          <div className="grid grid-cols-2 gap-2">
            <Field label="得意先">
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
            <Field label="管轄">
              <select
                value={jurisdictionId}
                onChange={(e) => {
                  setJurisdictionId(e.target.value);
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
                onChange={(e) => setDepartmentId(e.target.value)}
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
            <Field label="住所">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={FIELD}
              />
            </Field>
          </div>
        </Section>

        <Section title="予定のひな形">
          <p className="mb-2 text-[12px] leading-snug text-slate-500">
            「現場を追加」でこの現場を選んだときに、
            <span className="font-medium text-slate-600">時刻と休憩の初期値</span>
            として入ります。
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="開始">
              <div className="flex items-center gap-1">
                <TwoDigitInput value={startH} onChange={setStartH} max={23} />
                <span className="text-slate-400">:</span>
                <TwoDigitInput value={startM} onChange={setStartM} max={59} />
              </div>
            </Field>
            <Field label="終了">
              <div className="flex items-center gap-1">
                <TwoDigitInput value={endH} onChange={setEndH} max={23} />
                <span className="text-slate-400">:</span>
                <TwoDigitInput value={endM} onChange={setEndM} max={59} />
              </div>
            </Field>
            <Field label="休憩（分）">
              <input
                type="text"
                inputMode="numeric"
                value={breakMin}
                onChange={(e) =>
                  setBreakMin(Number(e.target.value.replace(/[^0-9]/g, "") || 0))
                }
                className={FIELD + " w-20 text-right font-mono"}
              />
            </Field>
            <label className="flex items-center gap-1.5 pb-1.5 text-[13px] text-slate-700">
              <input
                type="checkbox"
                checked={hasPlan}
                onChange={(e) => setHasPlan(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              勤務予定あり
            </label>
          </div>
        </Section>
      </div>

      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
          保存しました。
        </p>
      )}

      <div className="flex items-center gap-2">
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
              この現場を削除
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5">
              {/* 🔴 押す前に「何が起きるか」を出す。件数を出さずに押させない */}
              <span className="text-[13px] text-rose-900">
                {refs.shifts > 0 ? (
                  <>
                    <span className="font-semibold">配置枠が {refs.shifts} 件あるため削除できません。</span>
                    状態を「停止」にしてください。
                  </>
                ) : (
                  <>
                    削除すると
                    <span className="font-semibold">
                      必要資格 {refs.requiredQualifications} 件・NG {refs.ngEntries} 件
                    </span>
                    も一緒に消えます。戻せません。
                  </>
                )}
              </span>
              {refs.shifts === 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    const r = await deleteSite({ id: site.id });
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
      </div>
    </div>
  );
}

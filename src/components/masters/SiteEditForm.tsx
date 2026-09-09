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
import type { SiteDetail, SiteRefs } from "@/lib/masters";
import { FIELD, Field, Section } from "@/components/masters/FormBits";

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
  refs: SiteRefs;
}) {
  const [siteCode, setSiteCode] = useState(site.site_code);
  const [guardTargetNo, setGuardTargetNo] = useState(site.guard_target_no);
  const [name, setName] = useState(site.name);
  const [shortName, setShortName] = useState(site.short_name);
  const [nameKana, setNameKana] = useState(site.name_kana ?? "");
  const [address, setAddress] = useState(site.address ?? "");
  const [bandName, setBandName] = useState(site.band_name ?? "");
  const [billingNo, setBillingNo] = useState(site.billing_no ?? "");
  // 🔴 ShiftMax 勤務マスターの O列・P列（2026-09-09 追加）。
  //   突き合わせたら、25項目のうち持っていなかったのはこの2つだけだった。
  const [customerCode, setCustomerCode] = useState(site.customer_code ?? "");
  const [customerNo, setCustomerNo] = useState(site.customer_no ?? "");
  // 🔴 `?? 8` のような既定値を置かない。
  //   予定を持たない現場（`has_plan` が false・実データに存在する）を開いて「保存する」を押すと、
  //   **触ってもいないのに 08:00–17:00・休憩60分が書き込まれる**。
  //   マスタの CSV 取込で実データを入れた時点で 1,593 件ぶん発動しうる。
  //   → 未設定は未設定のまま持ち、空欄で見せ、空欄のまま保存する。
  const [startH, setStartH] = useState(site.plan_start_h);
  const [startM, setStartM] = useState(site.plan_start_m);
  const [endH, setEndH] = useState(site.plan_end_h);
  const [endM, setEndM] = useState(site.plan_end_m);
  const [breakMin, setBreakMin] = useState(site.plan_break);
  const [hasPlan, setHasPlan] = useState(site.has_plan);
  const [customerId, setCustomerId] = useState(site.customer_id ?? "");
  const [jurisdictionId, setJurisdictionId] = useState(site.jurisdiction_id);
  const [departmentId, setDepartmentId] = useState(site.department_id ?? "");
  const [status, setStatus] = useState(site.status);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);

  // 🔴 どれか1つでも直したら「保存しました」を消す。
  //   出したままにすると、**未保存の変更が保存済みに見える**。
  //   全項目の onChange に2行ずつ書くと書き漏らすので、setter のほうを包む。
  function edit<T>(set: (v: T) => void): (v: T) => void {
    return (v) => {
      setSaved(false);
      set(v);
    };
  }

  // 🔴 部署は管轄にぶら下がる。管轄を変えたら選べる部署も変わる。
  //   全部署を出すと、別管轄の部署を付けられてしまう。
  const departments = options.departments.filter((d) => d.jurisdiction_id === jurisdictionId);
  // 🔴 どちらが仮のままかを**名指しする**（2026-09-09）。
  //   「仮番号のままです」とだけ出していたため、警備先番号を本番号に直しても
  //   現場コードが TMP- のまま消えず、**何を直せば消えるのか分からなかった**（柴山の指摘）。
  //
  // 🔴 なぜ2つとも要るのか
  //   投入CSV は 2列目に**現場コード**、3列目に**警備先番号**を載せる
  //   （shiftmax-api-analysis.md §3）。べんり君は警備先番号で勤務マスターを引き、
  //   **未登録ならエラーで送信を中止する**。どちらか片方が仮のままでは引き渡せない。
  const tmpFields = [
    guardTargetNo.startsWith("TMP-") || guardTargetNo.trim() === "" ? "警備先番号" : null,
    siteCode.startsWith("TMP-") || siteCode.trim() === "" ? "現場コード" : null,
  ].filter((v): v is string => v !== null);
  const isTemporary = tmpFields.length > 0;

  async function save() {
    // 🔴 時と分は組。片方だけ入った状態で保存させない
    //   （「8」だけ入れて分を空にしたまま押す＝0分のつもり、という取り違えを防ぐ）。
    if ((startH === null) !== (startM === null) || (endH === null) !== (endM === null)) {
      setError("開始・終了の時刻は、時と分の両方を入れてください（未設定にするなら両方を空に）。");
      setSaved(false);
      return;
    }
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
      customerCode,
      customerNo,
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
              この現場を削除
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5">
              {/* 🔴 押す前に「何が起きるか」を出す。件数を出さずに押させない */}
              <span className="text-[13px] text-rose-900">
                {!refs.ok ? (
                  // 🔴 数えられなかったときに「0件」と出して押させない。
                  //   一緒に消えるもの（必要資格・NG）が見えないまま消すことになる。
                  <>
                    <span className="font-semibold">
                      関連するデータの件数を確認できませんでした。
                    </span>
                    画面を開き直してください。
                  </>
                ) : refs.shifts > 0 ? (
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
              {refs.ok && refs.shifts === 0 && (
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
      {isTemporary && (
        // 🔴 仮番号のままでは段3（べんり君への引き渡し）に出せない。
        //   9/7 に「新規現場は仮番号で通す」と決めた代わりに、ここで必ず気づかせる。
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-snug text-amber-900">
          🔴 <span className="font-semibold">{tmpFields.join("・")} が仮のままです。</span>
          <span className="ml-1">
            この2つ（警備先番号・現場コード）が
            <span className="font-semibold">どちらも ShiftMax の本番の値</span>
            になると、この表示は消えます。
          </span>
          <span className="ml-1">
            引き渡しの CSV は現場コードと警備先番号の両方を載せ、べんり君が
            <span className="font-semibold">警備先番号で ShiftMax の勤務マスターを引く</span>
            ため、仮の値のままでは送信がエラーで止まります。
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Section title="識別">
          <div className="grid grid-cols-2 gap-2">
            <Field label="警備先番号" hint="べんり君の入力キー">
              <input
                value={guardTargetNo}
                onChange={(e) => edit(setGuardTargetNo)(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="現場コード">
              <input
                value={siteCode}
                onChange={(e) => edit(setSiteCode)(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="状態">
              <select
                value={status}
                onChange={(e) => edit(setStatus)(e.target.value)}
                className={FIELD}
              >
                <option value="active">稼働</option>
                <option value="inactive">停止</option>
              </select>
            </Field>
            <Field label="請求番号">
              <input
                value={billingNo}
                onChange={(e) => edit(setBillingNo)(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="顧客コード" hint="ShiftMax 勤務マスター O列">
              <input
                value={customerCode}
                onChange={(e) => edit(setCustomerCode)(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
            <Field label="得意先番号" hint="担当コードとは別物（P列）">
              <input
                value={customerNo}
                onChange={(e) => edit(setCustomerNo)(e.target.value)}
                className={FIELD + " font-mono"}
              />
            </Field>
          </div>
        </Section>

        <Section title="名称">
          <div className="grid grid-cols-2 gap-2">
            <Field label="現場名">
              <input value={name} onChange={(e) => edit(setName)(e.target.value)} className={FIELD} />
            </Field>
            <Field label="略称" hint="プレート・A表に出る">
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
            <Field label="班">
              <input
                value={bandName}
                onChange={(e) => edit(setBandName)(e.target.value)}
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
                onChange={(e) => edit(setCustomerId)(e.target.value)}
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
            <Field label="住所">
              <input
                value={address}
                onChange={(e) => edit(setAddress)(e.target.value)}
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
                <TwoDigitInput value={startH} onChange={edit(setStartH)} max={23} allowEmpty />
                <span className="text-slate-400">:</span>
                <TwoDigitInput value={startM} onChange={edit(setStartM)} max={59} allowEmpty />
              </div>
            </Field>
            <Field label="終了">
              <div className="flex items-center gap-1">
                <TwoDigitInput value={endH} onChange={edit(setEndH)} max={23} allowEmpty />
                <span className="text-slate-400">:</span>
                <TwoDigitInput value={endM} onChange={edit(setEndM)} max={59} allowEmpty />
              </div>
            </Field>
            <Field label="休憩（分）">
              <input
                type="text"
                inputMode="numeric"
                value={breakMin ?? ""}
                onChange={(e) => {
                  const d = e.target.value.replace(/[^0-9]/g, "");
                  edit(setBreakMin)(d === "" ? null : Number(d));
                }}
                className={FIELD + " w-20 text-right font-mono"}
              />
            </Field>
            <label className="flex items-center gap-1.5 pb-1.5 text-[13px] text-slate-700">
              <input
                type="checkbox"
                checked={hasPlan}
                onChange={(e) => edit(setHasPlan)(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              勤務予定あり
            </label>
          </div>
        </Section>
      </div>

    </div>
  );
}

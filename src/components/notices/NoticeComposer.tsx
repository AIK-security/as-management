// S-03 一斉連絡（2026-09-09）。
//
// 🔴 この画面の価値は「送信」ではない。
//   LINE が繋がらない隊員が約4割（2026-08-27 管制ヒアリング）。
//   **その約4割を取りこぼさないこと**が目的なので、宛先を経路ごとに分けて出し、
//   LINE はコピー、電話は**リストとして印刷**できるようにする。
//   送信そのものは第1弾では作らない（2026-08-27 決定）。
//
// 🔴 協力会社の隊員は**所属会社経由**（2026-09-09 決定）。本人宛ての行は作らず、
//   会社ごとにまとめ、対象の隊員名を文面に列挙する。
//
// ⚠️ 暫定方針であり確定ではない（screen-design.md §4-1）。9/16 の管制ヒアリングで詰める。
"use client";

import { useMemo, useState } from "react";
import { recordNotice } from "@/app/notices/actions";
// 🔴 "@/lib/notices" ではなく notice-format から読む。
//   あちらは next/headers に依存しており、client から import するとビルドが落ちる。
import { fillTemplate, type MessageTemplate, type NoticeTarget } from "@/lib/notice-format";

const FIELD =
  "h-9 rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";
const BTN =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 transition-all duration-150 ease-in-out hover:bg-slate-100 disabled:opacity-40";

const CHANNEL_LABEL: Record<string, string> = {
  line: "LINE可",
  phone: "電話",
  company: "会社経由",
};

export function NoticeComposer({
  workDate,
  jurisdictionId,
  shiftGroup,
  targets,
  templates,
}: {
  workDate: string;
  jurisdictionId: string;
  shiftGroup: "day" | "night";
  targets: NoticeTarget[];
  templates: MessageTemplate[];
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [body, setBody] = useState(templates[0]?.body ?? "");
  // 🔴 当日変更の連絡は「動いた人だけ」に出せる必要がある。
  //   漏れる原因は誰が動いたかを人が拾えないことなので、ここが自動で絞れるのが本体。
  //
  // ⚠️ ただし「確定後に変更された」は直接は知れない（notice-format.ts の注記）。
  //   **今日この枠が動いたか（updated_at）**で近似している。
  const [changedOnly, setChangedOnly] = useState(false);
  const [siteFilter, setSiteFilter] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const sites = useMemo(
    () => [...new Set(targets.map((t) => t.siteName))].sort((a, b) => a.localeCompare(b)),
    [targets],
  );

  const visible = targets.filter(
    (t) =>
      (!changedOnly || t.updatedToday || t.cancelled) &&
      (siteFilter === "" || t.siteName === siteFilter),
  );
  const selected = visible.filter((t) => !excluded.has(t.guardId));

  const byChannel = {
    line: selected.filter((t) => t.channel === "line"),
    phone: selected.filter((t) => t.channel === "phone"),
    company: selected.filter((t) => t.channel === "company"),
  };

  function toggle(guardId: string) {
    const next = new Set(excluded);
    if (next.has(guardId)) next.delete(guardId);
    else next.add(guardId);
    setExcluded(next);
    setDone(null);
  }

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setBody(t.body);
    setDone(null);
  }

  /** LINE 用。1人1通ぶんを続けて並べる（そのまま貼れる形） */
  function lineText() {
    return byChannel.line.map((t) => fillTemplate(body, t)).join("\n\n───\n\n");
  }

  /** 協力会社用。**会社ごとにまとめ、対象の隊員名を列挙する** */
  function companyText() {
    const groups = new Map<string, NoticeTarget[]>();
    for (const t of byChannel.company) {
      const key = t.companyName ?? "（会社未設定）";
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return [...groups.entries()]
      .map(([company, list]) => {
        const lines = list
          .map((t) => `・${t.name}／${t.siteName}／${t.startText}〜${t.endText}`)
          .join("\n");
        const mail = list[0]?.companyEmail ? `（${list[0].companyEmail}）` : "（メール未登録）";
        return `【${company}】${mail}\n${lines}`;
      })
      .join("\n\n");
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("コピーできませんでした。文面を選んで手でコピーしてください。");
    }
  }

  /** 🔴 CSV は UTF-8 BOM を付ける（Excel の文字化け対策・2026-09-08 決定） */
  function downloadCsv() {
    const head = ["経路", "氏名", "宛先", "現場", "開始", "終了", "班", "集合", "会社"];
    const rows = selected.map((t) => [
      CHANNEL_LABEL[t.channel] ?? t.channel,
      t.name,
      t.channel === "line" ? (t.lineValue ?? "") : t.channel === "phone" ? (t.phoneValue ?? "") : (t.companyEmail ?? ""),
      t.siteName,
      t.startText,
      t.endText,
      t.bandName ?? "",
      t.planComment ?? "",
      t.companyName ?? "",
    ]);
    const csv = [head, ...rows]
      .map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `連絡_${workDate}_${shiftGroup === "day" ? "日勤" : "夜勤"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function markSent() {
    setPending(true);
    setError(null);
    const r = await recordNotice({
      workDate,
      jurisdictionId,
      shiftGroup,
      kind: templates.find((t) => t.id === templateId)?.kind ?? "general",
      body,
      templateId: templateId || null,
      targets: selected.map((t) => ({
        guardId: t.guardId,
        channel: t.channel,
        companyId: t.companyId,
      })),
    });
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setDone(`${selected.length}名ぶんを送信済として記録しました。`);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[380px_1fr] gap-3">
      {/* ══ 左：宛先 ══════════════════════════════════════ */}
      <section className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold tracking-tight text-slate-900">宛先</h2>
            <span className="t-meta text-slate-500">配置から自動</span>
            <span className="ml-auto text-[14px] font-semibold tabular-nums text-slate-800">
              {selected.length} / {targets.length} 名
            </span>
          </div>

          {/* 🔴 経路の内訳。「LINE可 41／電話 27」が見えることがこの画面の主目的 */}
          <div className="mt-1.5 flex gap-1.5">
            <Chip label="LINE可" n={byChannel.line.length} tone="emerald" />
            <Chip label="電話" n={byChannel.phone.length} tone="rose" />
            <Chip label="会社経由" n={byChannel.company.length} tone="slate" />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className={FIELD + " max-w-[190px] flex-1"}
            >
              <option value="">現場（すべて）</option>
              {sites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[13px] text-slate-700">
              <input
                type="checkbox"
                checked={changedOnly}
                onChange={(e) => setChangedOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              今日動いた枠のみ
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {visible.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-slate-400">
              対象の隊員がいません。日付・管轄・日勤夜勤か、絞り込みを見直してください。
            </p>
          ) : (
            visible.map((t) => {
              const off = excluded.has(t.guardId);
              const noWay = t.channel === "phone" && !t.phoneValue;
              return (
                <label
                  key={t.guardId}
                  className={[
                    "flex cursor-pointer items-start gap-2 border-b border-slate-100 px-3 py-1.5",
                    "transition-all duration-150 ease-in-out hover:bg-slate-50",
                    off ? "opacity-40" : "",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={!off}
                    onChange={() => toggle(t.guardId)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-slate-900">
                        {t.name}
                      </span>
                      <ChannelBadge channel={t.channel} />
                      {t.cancelled && (
                        <span className="t-badge rounded bg-slate-600 px-1 py-0.5 text-white">
                          中止
                        </span>
                      )}
                      {t.updatedToday && !t.cancelled && (
                        <span className="t-badge rounded bg-amber-100 px-1 py-0.5 text-amber-800">
                          本日更新
                        </span>
                      )}
                      {t.isDraft && !t.cancelled && (
                        <span className="t-badge rounded bg-slate-100 px-1 py-0.5 text-slate-600">
                          仮組み
                        </span>
                      )}
                    </span>
                    <span className="t-meta block truncate text-slate-500">
                      {t.siteName}／{t.startText}〜{t.endText}
                      {t.companyName ? `／${t.companyName}` : ""}
                    </span>
                    {/* 🔴 連絡手段が1つも無い隊員を目立たせる。ここが取りこぼしの源 */}
                    {noWay && (
                      <span className="t-meta block font-semibold text-rose-600">
                        連絡先が未登録です
                      </span>
                    )}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </section>

      {/* ══ 右：文面と出力 ═══════════════════════════════ */}
      <section className="flex min-h-0 flex-col gap-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold tracking-tight text-slate-900">文面</h2>
            <select
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
              className={FIELD + " w-40"}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="t-meta ml-auto text-slate-500">
              差込：{"{隊員名} {現場名} {開始} {終了} {班} {集合}"}
            </span>
          </div>

          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDone(null);
            }}
            rows={7}
            className="mt-2 w-full rounded-md border border-slate-300 p-2 text-[14px] leading-snug text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        {/* プレビュー（先頭1名ぶん） */}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-[13px] font-semibold tracking-tight text-slate-900">
            プレビュー
            <span className="t-meta ml-2 font-normal text-slate-500">先頭の1名ぶん</span>
          </h2>
          {selected[0] ? (
            <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[13px] leading-snug text-slate-800">
              {fillTemplate(body, selected[0])}
            </pre>
          ) : (
            <p className="text-[13px] text-slate-400">宛先が選ばれていません。</p>
          )}

          {byChannel.company.length > 0 && (
            <>
              <h3 className="mt-3 mb-1 text-[13px] font-semibold text-slate-900">
                協力会社ぶん
                <span className="t-meta ml-2 font-normal text-slate-500">会社ごとにまとめる</span>
              </h3>
              <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[13px] leading-snug text-slate-800">
                {companyText()}
              </pre>
            </>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            {error}
          </p>
        )}
        {done && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
            {done}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <button
            type="button"
            disabled={byChannel.line.length === 0}
            onClick={() => copy("line", lineText())}
            className={BTN}
          >
            LINE用にコピー（{byChannel.line.length}）
          </button>
          <button
            type="button"
            disabled={byChannel.company.length === 0}
            onClick={() => copy("company", companyText())}
            className={BTN}
          >
            会社向けにコピー（{byChannel.company.length}）
          </button>
          <button type="button" disabled={selected.length === 0} onClick={downloadCsv} className={BTN}>
            CSV出力
          </button>
          {/* 🔴 LINE が繋がらないぶんは**紙で持つ**。この画面の存在理由がここ */}
          <button
            type="button"
            disabled={byChannel.phone.length === 0}
            onClick={() => window.print()}
            className={BTN}
          >
            電話リスト印刷（{byChannel.phone.length}）
          </button>
          {copied && <span className="t-meta text-emerald-700">コピーしました</span>}

          <button
            type="button"
            disabled={pending || selected.length === 0}
            onClick={markSent}
            className="ml-auto rounded-md bg-indigo-600 px-4 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 ease-in-out hover:bg-indigo-700 disabled:opacity-50"
          >
            {pending ? "記録中…" : "送信済にする"}
          </button>
        </div>
      </section>

      {/* 🔴 印刷は電話リストだけを出す。画面のまま刷ると宛先の一覧が読めない */}
      <PrintPhoneList rows={byChannel.phone} workDate={workDate} group={shiftGroup} />
    </div>
  );
}

function Chip({ label, n, tone }: { label: string; n: number; tone: string }) {
  const cls: Record<string, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
  };
  return (
    <span className={`t-badge rounded border px-1.5 py-0.5 ${cls[tone]}`}>
      {label} <span className="font-semibold tabular-nums">{n}</span>
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const cls: Record<string, string> = {
    line: "bg-emerald-50 text-emerald-700",
    phone: "bg-rose-50 text-rose-700",
    company: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`t-badge shrink-0 rounded px-1 py-0.5 ${cls[channel]}`}>
      {CHANNEL_LABEL[channel]}
    </span>
  );
}

/** 印刷用の電話リスト。画面では隠し、印刷時だけ出す */
function PrintPhoneList({
  rows,
  workDate,
  group,
}: {
  rows: NoticeTarget[];
  workDate: string;
  group: string;
}) {
  return (
    <div className="hidden print:block">
      <h1 className="mb-2 text-[18px] font-semibold">
        電話連絡リスト {workDate}（{group === "day" ? "日勤" : "夜勤"}）
      </h1>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b-2 border-slate-400 text-left">
            <th className="py-1">氏名</th>
            <th className="py-1">電話番号</th>
            <th className="py-1">現場</th>
            <th className="py-1">時間</th>
            <th className="py-1">集合</th>
            <th className="w-16 py-1">済</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.guardId} className="border-b border-slate-300">
              <td className="py-1 font-semibold">{t.name}</td>
              <td className="py-1 font-mono">{t.phoneValue ?? "（未登録）"}</td>
              <td className="py-1">{t.siteName}</td>
              <td className="py-1 font-mono">
                {t.startText}〜{t.endText}
              </td>
              <td className="py-1">{t.planComment ?? ""}</td>
              <td className="py-1">□</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

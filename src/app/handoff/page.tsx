// S-02 べんり君への引き渡し（2026-10-06）。
//
// 設計は docs/screen-design.md §3。**1画面 = 1日 × 1管轄**（べんり君の送信単位と同じ）。
// 確定した枠を 18列CSV にして、中身を見せてからダウンロードさせる。
//
// 🔴 この工程は要る（2026-10-09 決着・requirements.md §8-1）。ShiftMax が勤怠・給与を計算しているため。
//   研修・欠勤はまだ出していない（入れ方を確認中）ので、画面にもそう書いておく。
// 🔴 事務（office）も開ける。出力のダウンロードは事務の権限に入っている（requirements.md §3）。
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { keepSiteJurisdictions } from "@/lib/site-jurisdictions";
import { addDays, formatBoardDate, todayInJst } from "@/lib/board-format";
import { HANDOFF_HEADER, getHandoffData, toHandoffCsv } from "@/lib/handoff";
import { getBoardReview } from "@/lib/board-review";
import { DateJump } from "@/components/DateJump";
import { HandoffDownload } from "@/components/handoff/HandoffDownload";

export default async function HandoffPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; j?: string }>;
}) {
  // 🔴 ここが実際の関門。proxy.ts は導線であって認可ではない。
  await requireStaff();
  const sp = await searchParams;
  const workDate = sp.date ?? todayInJst();

  const supabase = await createClient();
  const jurisdictions = await keepSiteJurisdictions(
    supabase,
    supabase
      .from("jurisdictions")
      .select("id, code, name")
      .order("code")
      .then(({ data, error }) => {
        if (error) throw new Error(`管轄の取得に失敗しました: ${error.message}`);
        return (data ?? []) as { id: string; code: string; name: string }[];
      }),
  );
  const jurisdiction = jurisdictions.find((j) => j.code === sp.j) ?? jurisdictions[0];
  if (!jurisdiction) {
    return (
      <main className="p-4">
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          管轄が1件も登録されていません。先にマスタを投入してください。
        </p>
      </main>
    );
  }

  const [data, review] = await Promise.all([
    getHandoffData(workDate, jurisdiction.id),
    getBoardReview(workDate, jurisdiction.id),
  ]);
  const csv = toHandoffCsv(data.rows);

  // 🔴 べんり君は現場コードが1件でも引けないと送信ごと止まる。先に止めて、直す場所を見せる
  const blockedReason =
    data.missing.length > 0
      ? `警備先番号が見つからない枠が ${data.missing.length} 件あります`
      : data.partnerGuardMissing
        ? "協力会社の隊員を寄せる「応援」の隊員が、隊員マスタに見つかりません"
        : data.rows.length === 0
          ? "確定した枠がありません"
          : null;

  const href = (p: Record<string, string>) =>
    `/handoff?${new URLSearchParams({ date: workDate, j: jurisdiction.code, ...p }).toString()}`;
  const navBtn =
    "rounded-md border border-slate-300 px-2 py-1 text-slate-500 transition-all duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800";

  const partnerCount = data.rows.filter((r) => r.note === "partner").length;
  const vacantCount = data.rows.filter((r) => r.note === "vacant").length;
  const onsiteCancelCount = data.rows.filter((r) => r.onsiteCancelled).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b-2 border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex shrink-0 items-center gap-1">
          <Link href={href({ date: addDays(workDate, -1) })} className={navBtn} aria-label="前日">
            ◀
          </Link>
          <span className="px-1 text-[18px] font-bold tracking-tight whitespace-nowrap text-slate-900 tabular-nums">
            {formatBoardDate(workDate)}
          </span>
          <Link href={href({ date: addDays(workDate, 1) })} className={navBtn} aria-label="翌日">
            ▶
          </Link>
          <span className="ml-1">
            <DateJump action="/handoff" name="date" type="date" value={workDate} keep={{ j: jurisdiction.code }} />
          </span>
        </div>

        {/* 管轄が1つのあいだは切り替えを出さない（s20-output-design.md §7） */}
        {jurisdictions.length > 1 && (
          <div className="flex shrink-0 overflow-hidden rounded-md border border-slate-300">
            {jurisdictions.map((j) => (
              <Link
                key={j.id}
                href={href({ j: j.code })}
                className={[
                  "px-2.5 py-1 text-[13px] font-semibold whitespace-nowrap transition-all duration-150 ease-in-out",
                  j.id === jurisdiction.id ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                {j.name}
              </Link>
            ))}
          </div>
        )}

        <div className="flex shrink-0 items-baseline gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 whitespace-nowrap text-slate-700">
          <span className="t-meta">確定</span>
          <span className="text-[16px] font-bold tabular-nums">{data.confirmedShifts}</span>
          <span className="t-meta text-slate-500">枠 /</span>
          <span className="text-[16px] font-bold tabular-nums">{data.rows.length}</span>
          <span className="t-meta text-slate-500">行</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link
            href={`/board?date=${workDate}&j=${jurisdiction.code}`}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
          >
            配置ボードへ戻る
          </Link>
          <HandoffDownload
            csv={csv}
            fileName={`べんり君_${workDate}_${jurisdiction.name}.csv`}
            blockedReason={blockedReason}
          />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <p className="t-meta text-slate-500">
          確定した枠を、べんり君と同じ18列の CSV にします。1行が隊員1人です。ShiftMax の勤怠・給与の計算に使われます。研修・欠勤はまだ入りません（べんり君での入れ方を確認中です）。
        </p>

        {/* 🔴 未確認のまま引き渡そうとしたら知らせる（requirements.md §4-3）。止めはしない ──
            当日変更が常態で、確認担当を待てない場面がある */}
        {data.rows.length > 0 && (review === null || review.changedAt !== null) && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] leading-snug text-amber-900">
            {review === null
              ? "この日の配置は、まだ確認されていません。配置ボードで確認してから出すと安心です。"
              : "確認の後に配置が変わっています。配置ボードでもう一度確認してから出すと安心です。"}
          </p>
        )}

        {data.draftShifts > 0 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] leading-snug text-amber-900">
            仮組みの枠が {data.draftShifts} 件あります。仮組みは CSV に入りません。配置ボードで確定してから出してください。
          </p>
        )}

        {data.missing.length > 0 && (
          <section className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] leading-snug text-rose-800">
            <p className="font-semibold">
              警備先番号が見つからない枠が {data.missing.length} 件あります。このままではべんり君が送信を止めるため、ダウンロードできません。
            </p>
            <p className="t-meta mt-0.5 text-rose-700">
              〈得意先 × 区分〉の組み合わせが勤務マスタにありません。現場の得意先が正しいか、取込で勤務マスタを入れ直したかを確かめてください。
            </p>
            <ul className="mt-1 list-disc pl-5">
              {data.missing.map((m, i) => (
                <li key={i}>
                  {m.siteName}（{m.customerName ?? "得意先が未設定"} × {m.kindLabel}）
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.partnerGuardMissing && (
          <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-[13px] leading-snug text-rose-800">
            協力会社の隊員は「応援」の行として出しますが、隊員マスタに「応援」で始まる隊員が見つかりません。
          </p>
        )}

        {(partnerCount > 0 || vacantCount > 0 || onsiteCancelCount > 0) && (
          <p className="t-meta text-slate-600">
            {partnerCount > 0 && <>協力会社の隊員 {partnerCount} 名は「応援」の行にまとめ、会社名を予定コメントに足しています。</>}
            {vacantCount > 0 && <>　人が入っていない {vacantCount} 名ぶんは、個人コード 0 の行で出しています。</>}
            {onsiteCancelCount > 0 && <>　現着中止の {onsiteCancelCount} 名は、区分「現中」の警備先番号で出しています。</>}
          </p>
        )}

        <div className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-[13px] leading-snug">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                {HANDOFF_HEADER.map((h) => (
                  <th
                    key={h}
                    className="border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-semibold whitespace-nowrap text-slate-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr
                  key={i}
                  className={[
                    "border-b border-slate-100 transition-all duration-150 ease-in-out hover:bg-slate-50",
                    r.note === "vacant" ? "text-slate-400" : "text-slate-900",
                  ].join(" ")}
                >
                  {r.cells.map((c, j) => (
                    <td
                      key={j}
                      className={[
                        "px-2 py-1 whitespace-nowrap",
                        // 個人コード〜社員名（11〜13列目）。応援に寄せた行だけ色で見分ける
                        r.note === "partner" && j >= 10 && j <= 12 ? "bg-sky-50 text-sky-800" : "",
                        j <= 2 || (j >= 5 && j <= 11) || (j >= 14 && j <= 16) ? "font-mono tabular-nums" : "",
                      ].join(" ")}
                    >
                      {c}
                      {/* 🔴 現着中止の人（2026-10-08）。番号だけでは見分けられないので、現場名の横に出す */}
                      {j === 3 && r.onsiteCancelled && (
                        <span className="ml-1.5 rounded border border-slate-400 bg-slate-100 px-1 text-[11px] font-semibold text-slate-700">
                          現中
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={HANDOFF_HEADER.length} className="px-3 py-6 text-center text-slate-500">
                    この日・この管轄に確定した枠はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

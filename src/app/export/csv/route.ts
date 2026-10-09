// S-20 出力 ① 配置明細の CSV（2026-10-09）。
//
// 🔴 画面（page.tsx）に CSV を埋め込まず、ここで直接返す。1か月で約3,000行あり、
//   画面のデータに載せると重くなるため（引き渡しは1日分なので埋め込んでいる）。
// 🔴 関門は requireStaff。事務（office）も開ける ─ 出力のダウンロードは事務の権限（requirements.md §3）。
import { requireStaff } from "@/lib/auth";
import { MAX_DAYS, daysBetween, getAssignmentDetail, toExportCsv } from "@/lib/export";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  await requireStaff();

  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) {
    return new Response("期間の指定が正しくありません。", { status: 400 });
  }
  const days = daysBetween(from, to);
  if (days === 0 || days > MAX_DAYS) {
    return new Response(`期間は ${MAX_DAYS} 日以内で指定してください。`, { status: 400 });
  }

  const { rows } = await getAssignmentDetail(from, to);
  const fileName = `配置明細_${from}_${to}.csv`;
  return new Response(toExportCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // 日本語のファイル名は filename* で渡す（RFC 6266）。filename は古いブラウザ向けの代替
      "Content-Disposition": `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}

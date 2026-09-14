// マスタ取込（2026-09-14）。ShiftMax のマスタを新システムへ入れる入口。
//
// 🔴 これが無いと、現場1,593 / 隊員250 / 得意先603 を手で入れることになる。
//   第1弾の稼働に直接効く（`logs/2026-09-09.md` 申し送り2）。
//
// 🔴 実データの CSV 化は**本番投入の直前に行う**（2026-09-09 決定10）。
//   実名・メール・取引先名の複製を増やさないため、この画面は先に作っておくが、
//   動作確認は小さなダミー CSV で行う。
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { MasterImport } from "@/components/masters/MasterImport";

export default async function MasterImportPage() {
  // 🔴 取り込めるのは管制・管理者だけ。ここが2枚目の関門（最後の砦は RLS）
  await requireRole("control", "admin");

  return (
    <>
      <div className="flex items-center gap-3">
        <Link
          href="/masters/sites"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          ◀ マスタ
        </Link>
        <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">マスタ取込</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <MasterImport />
      </div>
    </>
  );
}

// S-12 得意先マスタ 新規登録（2026-09-09）
//
// ⚠️ 配置ボードからは今までどおり作れない（2026-09-07 決定）。
//   請求（第2弾）の突き合わせに使うマスタなので、配置の途中で勝手に増やさない。
//   意図して足す場所はここだけにする。
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { CustomerCreateForm } from "@/components/masters/CreateForms";

export default async function NewCustomerPage() {
  await requireRole("control", "admin");

  return (
    <>
      <div className="flex items-center gap-3">
        <Link
          href="/masters/customers"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          ◀ 得意先一覧
        </Link>
        <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">
          得意先を新規登録
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <CustomerCreateForm />
      </div>
    </>
  );
}

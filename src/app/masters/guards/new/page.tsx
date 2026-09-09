// S-11 隊員マスタ 新規登録（2026-09-09）
//
// 🔴 これが無いのは第1弾の要件に直接ひびいていた。
//   協力会社の隊員は ShiftMax に個人単位で存在せず、新システムがゼロから持つ必要がある
//   （CLAUDE.md・2026-08-31 に7月実データで確認）のに、登録画面が無かった。
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getGuardFormOptions } from "@/lib/masters";
import { GuardCreateForm } from "@/components/masters/CreateForms";

export default async function NewGuardPage() {
  await requireRole("control", "admin");
  const options = await getGuardFormOptions();

  return (
    <>
      <div className="flex items-center gap-3">
        <Link
          href="/masters/guards"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          ◀ 隊員一覧
        </Link>
        <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">隊員を新規登録</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <GuardCreateForm options={options} />
      </div>
    </>
  );
}

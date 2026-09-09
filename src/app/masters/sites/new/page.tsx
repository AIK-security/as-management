// S-10 現場マスタ 新規登録（2026-09-09）
//
// 🔴 これまで現場を作れるのは配置ボードの「現場を追加」だけだった。
//   そこでは名前しか入れられず、必ず仮番号になる。マスタ側に入口を置く。
//
// 🔴 新規は最小項目だけ。残りは作成後に飛ばされる詳細画面で埋める。
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getSiteFormOptions } from "@/lib/masters";
import { SiteCreateForm } from "@/components/masters/CreateForms";

export default async function NewSitePage() {
  // 🔴 作れるのは管制・管理者だけ。ここが2枚目の関門（最後の砦は RLS）
  await requireRole("control", "admin");
  const options = await getSiteFormOptions();

  return (
    <>
      <div className="flex items-center gap-3">
        <Link
          href="/masters/sites"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          ◀ 現場一覧
        </Link>
        <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">現場を新規登録</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <SiteCreateForm options={options} />
      </div>
    </>
  );
}

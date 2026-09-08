// S-10 現場マスタ 詳細・編集（2026-09-08）
//
// 🔴 一覧だけ作って詳細を作っていなかった。
//   「見えるだけで台帳として使えない」という指摘（柴山・2026-09-08）への対応。
//
// 🔴 編集できるのは管制・管理者（RLS も can_edit()）。
//   事務は閲覧のみなので、フォームではなく読み取り表示に落とす。
import Link from "next/link";
import { notFound } from "next/navigation";
import { canEdit, requireStaff } from "@/lib/auth";
import { countSiteRefs, getSite, getSiteFormOptions } from "@/lib/masters";
import { SiteEditForm } from "@/components/masters/SiteEditForm";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireStaff();
  const { id } = await params;

  const site = await getSite(id);
  if (!site) notFound();

  const [options, refs] = await Promise.all([getSiteFormOptions(), countSiteRefs(id)]);
  const editable = canEdit(profile);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/masters/sites"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          ◀ 現場一覧
        </Link>
        <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">{site.name}</h1>
        <span className="t-meta font-mono text-slate-500">{site.guard_target_no}</span>
        {site.status !== "active" && (
          <span className="t-badge rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">停止中</span>
        )}
        <span className="t-meta ml-auto text-slate-500">
          配置枠 <span className="font-semibold tabular-nums text-slate-700">{refs.shifts}</span> 件
        </span>
      </div>

      {/* 🔴 overflow-auto を付ける。項目が増えると縦に溢れる */}
      <div className="min-h-0 flex-1 overflow-auto">
        {editable ? (
          <SiteEditForm site={site} options={options} refs={refs} />
        ) : (
          <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-600">
            閲覧のみの権限です。編集は管制・管理者が行います。
          </p>
        )}
      </div>
    </>
  );
}

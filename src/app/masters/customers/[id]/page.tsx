// S-12 得意先マスタ 詳細・編集（2026-09-09）
//
// 🔴 現場（S-10）・隊員（S-11）と同じ構成。
// 🔴 編集できるのは管制・管理者（RLS も can_edit()）。事務は閲覧のみ。
import Link from "next/link";
import { notFound } from "next/navigation";
import { canEdit, requireStaff } from "@/lib/auth";
import {
  countCustomerRefs,
  getCustomer,
  getCustomerFormOptions,
  getCustomerSites,
} from "@/lib/masters";
import { CustomerEditForm } from "@/components/masters/CustomerEditForm";
import { CustomerSiteList } from "@/components/masters/RelatedLists";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireStaff();
  const { id } = await params;

  const customer = await getCustomer(id);
  if (!customer) notFound();

  const [options, refs, sites] = await Promise.all([
    getCustomerFormOptions(),
    countCustomerRefs(id),
    getCustomerSites(id),
  ]);
  const editable = canEdit(profile);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/masters/customers"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          ◀ 得意先一覧
        </Link>
        <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">
          {customer.name}
        </h1>
        <span className="t-meta font-mono text-slate-500">{customer.staff_code}</span>
        <span className="t-meta ml-auto text-slate-500">
          {refs.ok ? (
            <>
              現場 <span className="font-semibold tabular-nums text-slate-700">{refs.sites}</span>{" "}
              件
            </>
          ) : (
            <span className="text-amber-700">現場の件数を確認できませんでした</span>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-3">
          {editable ? (
            <CustomerEditForm customer={customer} options={options} refs={refs} />
          ) : (
            <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-600">
              閲覧のみの権限です。編集は管制・管理者が行います。
            </p>
          )}
          <CustomerSiteList rows={sites} />
        </div>
      </div>
    </>
  );
}

// S-11 隊員マスタ 詳細・編集（2026-09-09）
//
// 🔴 現場（S-10）と同じ構成にする：本体の編集＋関連（資格・連絡先）を1画面に置く。
//   隊員を開いたのに資格を直すのに別画面へ行かせると、管制の手が止まる。
//
// 🔴 編集できるのは管制・管理者（RLS も can_edit()）。事務は閲覧のみ。
import Link from "next/link";
import { notFound } from "next/navigation";
import { canEdit, requireStaff } from "@/lib/auth";
import { todayInJst } from "@/lib/board";
import {
  countGuardRefs,
  getGuard,
  getGuardAssignments,
  getGuardContacts,
  getGuardFormOptions,
  getGuardQualifications,
} from "@/lib/masters";
import { GuardContactList } from "@/components/masters/GuardContactList";
import { GuardEditForm } from "@/components/masters/GuardEditForm";
import { GuardQualificationList } from "@/components/masters/GuardQualificationList";
import { GuardAssignmentList } from "@/components/masters/RelatedLists";

export default async function GuardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireStaff();
  const { id } = await params;

  const guard = await getGuard(id);
  if (!guard) notFound();

  // 🔴 直列に待たない。5本まとめて投げる（配置ボードで往復を8段→2段にしたのと同じ理由）
  const [options, refs, quals, contacts, assignments] = await Promise.all([
    getGuardFormOptions(),
    countGuardRefs(id),
    getGuardQualifications(id),
    getGuardContacts(id),
    getGuardAssignments(id),
  ]);
  const editable = canEdit(profile);
  const today = todayInJst();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/masters/guards"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
        >
          ◀ 隊員一覧
        </Link>
        <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">{guard.name}</h1>
        <span className="t-meta font-mono text-slate-500">
          {guard.staff_code ?? <span className="text-slate-300">個人コードなし</span>}
        </span>
        {guard.status !== "active" && (
          <span className="t-badge rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">停止中</span>
        )}
        <span className="t-meta ml-auto text-slate-500">
          {refs.ok ? (
            <>
              稼働 <span className="font-semibold tabular-nums text-slate-700">
                {refs.assignments}
              </span>{" "}
              件
            </>
          ) : (
            <span className="text-amber-700">稼働の件数を確認できませんでした</span>
          )}
        </span>
      </div>

      {/* 🔴 overflow-auto を付ける。資格・連絡先が増えると縦に溢れる */}
      <div className="min-h-0 flex-1 overflow-auto">
        {editable ? (
          <div className="flex flex-col gap-3">
            <GuardEditForm guard={guard} options={options} refs={refs} />
            <GuardAssignmentList rows={assignments} />
            <div className="grid grid-cols-2 gap-3">
              <GuardQualificationList
                guardId={guard.id}
                rows={quals}
                options={options.qualifications}
                today={today}
              />
              <GuardContactList guardId={guard.id} rows={contacts} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-600">
              閲覧のみの権限です。編集は管制・管理者が行います。
            </p>
            {/* 🔴 事務も**見る**ことはできる。給与・請求は稼働を見ないと組めない */}
            <GuardAssignmentList rows={assignments} />
          </div>
        )}
      </div>
    </>
  );
}

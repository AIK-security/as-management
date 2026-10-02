// S-10 現場マスタ 詳細・編集（2026-09-08 / 2026-09-09 に関連情報を追加）
//
// 🔴 一覧だけ作って詳細を作っていなかった。
//   「見えるだけで台帳として使えない」という指摘（柴山・2026-09-08）への対応。
//
// 🔴 2026-09-09：本体の項目だけでは足りなかった。
//   「現場情報に日付が入ってなくてどうやって日々の配置管理を行うのか」（柴山）。
//   日付を持っているのは配置枠（shifts）だが、**現場を開いても枠が見えない**ので
//   画面からその構造が読み取れなかった。配置枠・必要資格・NG をここに載せる。
//
// 🔴 編集できるのは管制・管理者（RLS も can_edit()）。
//   事務は閲覧のみなので、フォームではなく読み取り表示に落とす。
import Link from "next/link";
import { notFound } from "next/navigation";
import { canEdit, requireStaff } from "@/lib/auth";
import {
  countSiteRefs,
  getSite,
  getSiteFormOptions,
  getSiteNgEntries,
  getSiteRequiredQualifications,
  getSiteShifts,
  getGuardFormOptions,
  listNgPicks,
} from "@/lib/masters";
import { SiteEditForm } from "@/components/masters/SiteEditForm";
import {
  SiteNgList,
  SiteQualificationList,
  SiteShiftList,
} from "@/components/masters/SiteRelated";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireStaff();
  const { id } = await params;

  const site = await getSite(id);
  if (!site) notFound();

  // 🔴 直列に待たない。まとめて投げる（配置ボードで往復を8段→2段にしたのと同じ理由）
  const [options, refs, shifts, quals, ngs, picks, qualOptions] = await Promise.all([
    getSiteFormOptions(),
    countSiteRefs(id),
    getSiteShifts(id),
    getSiteRequiredQualifications(id),
    getSiteNgEntries(id),
    listNgPicks(),
    getGuardFormOptions(),
  ]);
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
        <span className="t-meta font-mono text-slate-500">{site.site_code}</span>
        {site.status !== "active" && (
          <span className="t-badge rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">停止中</span>
        )}
        <span className="t-meta ml-auto text-slate-500">
          {refs.ok ? (
            <>
              配置枠{" "}
              <span className="font-semibold tabular-nums text-slate-700">{refs.shifts}</span> 件
            </>
          ) : (
            <span className="text-amber-700">配置枠の件数を確認できませんでした</span>
          )}
        </span>
      </div>

      {/* 🔴 overflow-auto を付ける。項目が増えると縦に溢れる */}
      <div className="min-h-0 flex-1 overflow-auto">
        {editable ? (
          <div className="flex flex-col gap-3">
            <SiteEditForm site={site} options={options} refs={refs} />
            <SiteShiftList rows={shifts} />
            <div className="grid grid-cols-2 gap-3">
              <SiteQualificationList
                siteId={site.id}
                rows={quals}
                options={qualOptions.qualifications}
              />
              <SiteNgList siteId={site.id} rows={ngs} guards={picks.guards} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-600">
              閲覧のみの権限です。編集は管制・管理者が行います。
            </p>
            {/* 🔴 事務も**見る**ことはできる。請求は現場と枠を見ないと組めない */}
            <SiteShiftList rows={shifts} />
          </div>
        )}
      </div>
    </>
  );
}

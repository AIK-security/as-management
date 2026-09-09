// 画面の外枠（2026-09-09）。左サイドバー＋本体。
//
// 🔴 配置ボードとマスタで同じ枠を使う。別々に組むと、片方だけナビが古くなる。
// 🔴 ここでも requireStaff() を通すが、これは関門の1枚目にすぎない。
//   各ページでも呼ぶ（layout は将来キャッシュされうるため、layout だけに認可を預けない）。
//   最後の砦は DB の RLS。
import { requireStaff, roleLabel } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { AppSidebar } from "@/components/AppSidebar";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const { profile } = await requireStaff();

  return (
    <div className="flex h-screen bg-slate-100">
      <AppSidebar
        displayName={profile.display_name ?? "（氏名未設定）"}
        role={roleLabel[profile.role]}
        logout={logout}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

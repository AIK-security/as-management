// セキュリティヘッダーのうち、**リクエストごとに値が変わるもの**（CSP）。
//
// 🔴 なぜ next.config.ts から出したのか（2026-09-02）
//   next.config.ts の headers() は**全リクエストで同じ値**しか返せない。
//   そこに `script-src 'self'`（'unsafe-inline' なし）を書くと、
//   Next.js が出す**インラインスクリプト（RSC ペイロード）がブロックされる**。
//   結果：SSR された HTML は表示されるのに **hydration が完了せず、
//         クライアントコンポーネントの onClick が一切効かない**。
//   外部チャンクは 'self' で読めるため「見た目は正常」で、原因が分かりにくい。
//
//   🔴 これに気づけなかったのは、段1 までクライアントコンポーネントが
//     1つも無かったから。ログイン・ログアウトは Server Action の form で、
//     JavaScript 無しでも動いてしまう。
//
//   正しい形は「Proxy でリクエストごとに nonce を発行し、CSP に載せる」。
//   Next.js は CSP ヘッダーから nonce を読み取り、自分が出す script タグに
//   自動で付ける（node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md）。
//
// 🔴 nonce が効くのは**動的レンダリングのページだけ**。
//   静的生成されるページはビルド時に作られ、リクエストが存在しないため nonce を持てない。
//   本アプリの静的ページは `/`（/board への redirect のみ・HTML を出さない）と
//   `/_not-found`（操作の無い 404）だけなので実害は無い。
//   🟠 **今後、静的ページにクライアントコンポーネントを置くときは注意する。**

/** リクエストごとの nonce。推測できないことが前提なので毎回新しく作る。 */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export function buildContentSecurityPolicy(nonce: string): string {
  // `next dev` の React は、コールスタック復元などのデバッグ機能で eval() を使う。
  // CSP で塞ぐとコンソールにエラーが出続け、本物のエラーを埋もれさせる。
  // React は本番モードでは eval() を使わないため、開発時だけ許可する。
  const unsafeEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    // 🔴 'unsafe-inline' は入れない。代わりに nonce で通す。
    // 🟠 'strict-dynamic' は**あえて入れていない**。
    //   入れると 'self' が無視され、nonce の付いていない script が一切読めなくなる。
    //   静的生成のページ（nonce を持てない）が巻き添えで壊れるため、
    //   同一オリジンの script は 'self' で許す形にとどめる。
    //   ユーザーがファイルをアップロードして配信する機能は無く、
    //   任意の JS を自オリジンに置かれる経路が現時点で無いことが前提。
    `script-src 'self' 'nonce-${nonce}'${unsafeEval}`,
    // Tailwind v4 はビルド済み CSS を出すが、Next.js が style タグを挿入するため
    // 'unsafe-inline' が要る。スタイルの inline はスクリプト実行に繋がらないため、
    // リスクは script-src とは桁が違う。
    // 🔴 style-src に nonce を**足さない**。nonce があると 'unsafe-inline' は無視される。
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    // Supabase をワイルドカードで書くのは、接続先を .env から読まずに済ませるため。
    // プロジェクト固有の URL を設定ファイルに持たせない（値の二重管理を避ける）。
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "upgrade-insecure-requests",
  ].join("; ");
}

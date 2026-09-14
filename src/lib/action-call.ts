// Server Action をクライアント（イベントハンドラ）から呼ぶときの共通の呼び口。
// 2026-09-14 追加。
//
// 🔴 なぜ要るか ─ **呼び出しが「例外」で返ってくることがある**
//   `const r = await someAction(...)` と素で書くと、失敗したときに
//   **次の行に到達しない**。つまり `setPending(false)` が走らず、
//   ボタンが「保存中…」のまま固まり、理由も出ない。
//   再読み込みするまで操作できなくなる。
//
//   例外になる経路は2つある。
//   ① 通信断・サーバの差し替え … 本番へデプロイした直後、**開きっぱなしのタブ**から
//      押すと Server Action の参照が変わっていて失敗する。稼働後に管制が必ず踏む。
//   ② Server Action 側の `redirect()` … Next 16 は内部リダイレクトを
//      **クライアント側の Promise の reject として返すだけ**で、その場では遷移しない
//      （`node_modules/next/dist/client/components/router-reducer/reducers/
//        server-action-reducer.js` の "the action promise will be rejected with a redirect …
//        so that it's handled by RedirectBoundary"）。
//      バウンダリに届くのは **render 中に投げ直されたときだけ**なので、
//      `<form action={...}>` や `startTransition` の中なら効くが、
//      素の `onClick` から `await` している場合は**どこにも届かず、何も起きない**。
//
// 🔴 方針：**遷移は画面側が `useRouter()` で行い、Server Action は値を返すだけにする。**
//   Next のドキュメントも「`redirect` はイベントハンドラでは使えない。`useRouter` を使え」
//   と明記している（`03-api-reference/04-functions/redirect.md`）。
//   フレームワーク内部の投げ方に頼らないぶん、壊れにくい。
//
// 🔴 それでも redirect 例外は**握り潰さずに投げ直す**。
//   将来 `<form action={...}>` 経由の呼び出しをここに通したときに、
//   遷移だけが静かに消えるのが一番たちが悪いため。

/** 失敗をこの形に揃える。成功側の型は呼び出し元の Server Action が決める。 */
export type ActionFailure = { ok: false; message: string };

/**
 * フレームワークが制御に使う例外か。
 *
 * `redirect()` / `notFound()` は「エラー」ではなく**合図**で、`digest` に決まった
 * 文字列が入っている。ここで捕まえてしまうと遷移や 404 が消えるので素通しする。
 * 内部 API を import せず `digest` の文字列だけを見るのは、Next の版が上がっても
 * 壊れにくくするため。
 */
function isFrameworkSignal(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return false;
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK");
}

/**
 * Server Action を呼ぶ。**例外を投げずに必ず結果を返す。**
 *
 * ```ts
 * const r = await callAction(() => updateShift({ ... }));
 * setPending(false);          // ← ここに必ず来る
 * if (!r.ok) setError(r.message);
 * ```
 */
export async function callAction<T extends { ok: boolean }>(
  fn: () => Promise<T>,
): Promise<T | ActionFailure> {
  try {
    return await fn();
  } catch (e) {
    if (isFrameworkSignal(e)) throw e;
    // 🔴 中身は出さない。ここに来るのは通信・配信側の失敗で、
    //   本文（"Failed to find Server Action …" 等）は管制には読めない。
    //   代わりに**次にやること**を書く。
    return {
      ok: false,
      message: "通信に失敗しました。画面を再読み込みしてから、もう一度お試しください。",
    };
  }
}

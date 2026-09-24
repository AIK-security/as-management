// 印刷ボタン。サーバコンポーネントの画面から window.print() を呼ぶためだけの部品。
//
// 🔴 何が紙に出るかはここでは決めない。globals.css の @media print が
//   「既定で全部隠し、data-print-area だけ出す」ため、画面側で印刷範囲を宣言する。
"use client";

export function PrintButton({ label = "印刷", className }: { label?: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {label}
    </button>
  );
}

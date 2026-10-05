// 日付（または年月）を指定して一発で飛ぶ（2026-10-05）。
//
// 🔴 なぜ要るのか：◀▶ だけだと、離れた日へ行くのにボタンを何十回も押すことになる
//   （柴山・2026-10-05。7月の実データを見に行くのに10月から戻し続けた）。
// 🔴 form の GET にする（連絡作成 /notices と同じ形）。JS が動かなくても効く。
//   入れて Enter か「表示」で移動する。選んだ瞬間に飛ばさないのは、
//   日付欄に手で打つと途中の値（年だけ等）でも change が来て、勝手に飛ぶため。

export function DateJump({
  action,
  name,
  type,
  value,
  keep = {},
}: {
  /** 飛び先のパス（/board など） */
  action: string;
  /** URL に載せる名前（date / m など） */
  name: string;
  type: "date" | "month";
  value: string;
  /** 一緒に引き継ぐ条件（管轄・日勤夜勤 など） */
  keep?: Record<string, string>;
}) {
  return (
    <form method="get" action={action} className="flex shrink-0 items-center gap-1">
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input
        type={type}
        name={name}
        defaultValue={value}
        // 🔴 key に値を入れる。◀▶ で移動したときに、入力欄も新しい日付に戻す
        //   （defaultValue は最初の描画でしか効かない）
        key={value}
        aria-label={type === "date" ? "日付を指定" : "年月を指定"}
        className="h-8 rounded-md border border-slate-300 px-1.5 font-mono text-[13px] tabular-nums text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
      <button
        type="submit"
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] font-medium whitespace-nowrap text-slate-600 transition-all duration-150 ease-in-out hover:bg-slate-100"
      >
        表示
      </button>
    </form>
  );
}

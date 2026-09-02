// 配置ボードの「仕舞える」ペイン（隊員プール／要確認）。
//
// 🔴 なぜクライアント状態なのか（2026-09-02）
//   日付・管轄・日勤/夜勤の切り替えは URL パラメータにしてある（サーバで解決）。
//   開閉も同じ形にできるが、**毎回サーバ往復が入り、開き直すと開いた状態に戻る**。
//   開閉は「作業中に何度も触り、次に開いたときも同じであってほしい」種類の状態なので、
//   即座に反応する client state ＋ localStorage にした。
//
// 🔴 localStorage が読めない環境（プライベートモード・サイトデータ拒否）でも
//   落ちないようにする。読めなければ「開いた状態」で普通に使える。
//
// 🔴 開いた状態と閉じた状態は**別の markup を出す**（幅を変えるだけにしない）。
//   仕舞ったときに 420px の中身を残したまま隠すと、
//   スクロール位置や検索欄の入力が生き続けて分かりにくい。
//
// 🔴 何のために仕舞うのか
//   配置エリアを広げるため。管制の画面は1日 約150枚のプレートを並べる。
//   縦横どちらも足りない（PC の解像度は未確認・requirements.md §8-7 ③）。
"use client";

import { useSyncExternalStore } from "react";
import { PaneHeading } from "@/components/board/PaneHeading";

// ─────────────────────────────────────────────────────────
// 開閉状態（localStorage）
//
// 🔴 useEffect + setState では書かない。
//   ・lint（react-hooks/set-state-in-effect）が止める
//   ・描画のたびに「開く → 閉じる」の二段描画になる
//   localStorage は React の外にある状態なので、それ用の API で読む。
//   サーバ側は常に「開いた状態」を返し、hydration のズレを避ける。
// ─────────────────────────────────────────────────────────

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // 別タブでの変更も拾う（同じ人が2画面で開くことがある）
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // プライベートモード・サイトデータ拒否で読めないことがある。
    // 読めなければ「開いた状態」で普通に使えればよい。
    return false;
  }
}

function useCollapsed(key: string) {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => readCollapsed(key),
    () => false, // サーバ描画時は常に開いた状態
  );

  const toggle = () => {
    try {
      window.localStorage.setItem(key, collapsed ? "0" : "1");
    } catch {
      // 保存できなくても、この操作自体は効かせたい
    }
    listeners.forEach((l) => l());
  };

  return { collapsed, toggle };
}

const TOGGLE_BTN =
  "shrink-0 rounded border border-slate-300 bg-white px-1.5 text-[13px] leading-5 text-slate-500 " +
  "transition-all duration-150 ease-in-out hover:bg-slate-200 hover:text-slate-800";

// ─────────────────────────────────────────────────────────
// 隊員プール（右）
// ─────────────────────────────────────────────────────────
export function PoolPane({
  poolCount,
  children,
}: {
  poolCount: number;
  children: React.ReactNode;
}) {
  const { collapsed, toggle } = useCollapsed("board.pool.collapsed");

  if (collapsed) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center gap-2 border-l-2 border-slate-300 bg-white py-2">
        <button
          type="button"
          onClick={toggle}
          className={TOGGLE_BTN}
          title="隊員プールを開く"
          aria-label="隊員プールを開く"
        >
          ‹
        </button>
        {/* 仕舞っていても「何人余っているか」だけは見えるようにする。
            未配置の人数は配置作業中いちばん見たい数字のため */}
        <button
          type="button"
          onClick={toggle}
          className="[writing-mode:vertical-rl] cursor-pointer text-[13px] font-semibold tracking-tight text-slate-600 transition-all duration-150 ease-in-out hover:text-slate-900"
          title="隊員プールを開く"
        >
          隊員プール
          <span className="ml-2 tabular-nums text-slate-900">未配置 {poolCount}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="thin-scroll flex w-[420px] shrink-0 flex-col overflow-y-auto border-l-2 border-slate-300 bg-white">
      {/* 見出しは貼り付けておく。中を下までスクロールしても仕舞えるように */}
      <div className="sticky top-0 z-10">
        <PaneHeading
          title="隊員プール"
          sub={`未配置 ${poolCount} 名`}
          action={
            <button
              type="button"
              onClick={toggle}
              className={TOGGLE_BTN}
              title="隊員プールを仕舞う"
              aria-label="隊員プールを仕舞う"
            >
              ›
            </button>
          }
        />
      </div>
      {children}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────
// 要確認（下）
// ─────────────────────────────────────────────────────────
export function WarningsPane({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const { collapsed, toggle } = useCollapsed("board.warnings.collapsed");

  return (
    <footer
      className={[
        "shrink-0 border-t-2 border-slate-300 bg-white px-4",
        collapsed ? "py-1.5" : "thin-scroll max-h-[140px] overflow-y-auto py-2",
      ].join(" ")}
    >
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] font-bold text-slate-800">
          ⚠ 要確認{" "}
          <span className={count > 0 ? "tabular-nums text-rose-600" : "tabular-nums text-slate-500"}>
            {count}
          </span>{" "}
          件
        </span>
        <span className="t-meta text-slate-500">
          止めるのは時間帯の重複だけ。NG・資格不足は警告のみで配置できます
        </span>
        <button
          type="button"
          onClick={toggle}
          className={`${TOGGLE_BTN} ml-auto`}
          title={collapsed ? "要確認を開く" : "要確認を仕舞う"}
          aria-label={collapsed ? "要確認を開く" : "要確認を仕舞う"}
          aria-expanded={!collapsed}
        >
          {collapsed ? "▲" : "▼"}
        </button>
      </div>
      {/* 🔴 仕舞っても件数は必ず出す。
          「0件だから閉じている」と「閉じているから見えない」を取り違えると、
          未充足を見落としたまま当日を迎える */}
      {!collapsed && children}
    </footer>
  );
}

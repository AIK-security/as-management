"use client";

// ─────────────────────────────────────────────────────────
// 得意先を選ぶ欄（文字を打って絞り込む）
//
// 🔴 なぜ <select> をやめたか（2026-11-16・赤尾さんの要望）
//   得意先は600件ある。<select> は打って探せないので、毎回スクロールで探していた。
//   配置ボードの「現場を追加」・現場マスタの新規／編集の3か所で同じ部品を使う。
//
// 🔴 決まった値は「一覧から選んだもの」だけ。打っただけの文字では決めない。
//   打ちかけで欄を離れたら、選んであった得意先の名前に戻す。
//   ＝「表示は東急なのに中身は別の得意先」が起きない。
//
// 依存パッケージは足さない（1名体制の原則）。現場検索（AddShiftDialog）と同じ操作感にする
// ─────────────────────────────────────────────────────────

import { useId, useMemo, useState } from "react";

export type CustomerPick = { id: string; name: string; name_kana?: string | null };

/** 候補は上から30件まで。それ以上は打って絞ってもらう */
const MAX_SUGGESTIONS = 30;

const FIELD =
  "h-9 w-full rounded-md border border-slate-300 px-2 text-[14px] text-slate-900 transition-all duration-150 ease-in-out focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

/** カタカナ→ひらがな・全角英数→半角・小文字。ふりがなの表記ゆれで外れないように */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s/g, "");
}

export function CustomerPicker({
  customers,
  value,
  onChange,
  placeholder = "得意先名・ふりがなで検索",
}: {
  customers: CustomerPick[];
  /** 選んでいる得意先の id。未選択は "" */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const selected = customers.find((c) => c.id === value) ?? null;
  const [text, setText] = useState<string | null>(null); // null＝打っていない（選択中の名前を出す）
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  const shown = text ?? selected?.name ?? "";

  const hits = useMemo(() => {
    const q = normalize(text ?? "");
    if (!q) return customers;
    return customers.filter(
      (c) => normalize(c.name).includes(q) || normalize(c.name_kana ?? "").includes(q),
    );
  }, [customers, text]);
  const matches = hits.slice(0, MAX_SUGGESTIONS);
  const total = hits.length;

  function choose(c: CustomerPick) {
    onChange(c.id);
    setText(null);
    setOpen(false);
  }

  function close() {
    // 打ちかけは捨てる。空にして離れたときだけ「未選択」にする
    if (text !== null && text.trim() === "") onChange("");
    setText(null);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={shown}
        placeholder={placeholder}
        onFocus={(e) => {
          setOpen(true);
          setCursor(0);
          e.currentTarget.select(); // そのまま打てば上書きで探せる
        }}
        onBlur={close}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onKeyDown={(e) => {
          // 🔴 IME の変換中はキーを拾わない。変換の Enter で決まってしまう
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              e.stopPropagation(); // ダイアログごと閉じない
              setText(null);
              setOpen(false);
            }
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setCursor((c) => Math.min(c + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter") {
            // 🔴 一覧が開いているときはフォームを送らない（選ぶだけ）
            if (open && matches[cursor]) {
              e.preventDefault();
              choose(matches[cursor]);
            }
          }
        }}
        className={FIELD}
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute right-0 left-0 z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm"
        >
          {matches.map((c, i) => (
            <li key={c.id} role="option" aria-selected={c.id === value}>
              <button
                type="button"
                // 🔴 onMouseDown で決める。onClick だと先に欄の blur が走り、一覧が消えて押せない
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c);
                }}
                onMouseEnter={() => setCursor(i)}
                className={[
                  "flex w-full items-baseline gap-2 px-2 py-1.5 text-left transition-all duration-150 ease-in-out",
                  i === cursor ? "bg-indigo-50" : "bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                <span className="truncate text-[13px] text-slate-900">{c.name}</span>
                {c.id === value && (
                  <span className="ml-auto shrink-0 text-[11px] font-medium text-indigo-600">
                    選択中
                  </span>
                )}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-[13px] text-slate-500">該当する得意先がありません</li>
          )}
          {total > matches.length && (
            <li className="border-t border-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
              ほか {total - matches.length} 件。続けて打つと絞り込めます
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

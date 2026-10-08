// 配置ボードのキーボード操作（段2-③の続き・2026-09-04）。
//
// 🔴 なぜ D&D だけにしないのか（screen-design.md §2-8）
//   現行のべんり君（Excel）は**キーボードで完結する**。
//   68名 × 40現場を毎日さばく画面で、1枚ごとに掴んで運ばせると
//   「新しくなって遅くなった」と言われる。**マウスは主導線、キーボードは高速経路**。
//
// 🔴 中心にあるのは「往復」ひとつだけ。
//     ↑↓ で枠を選ぶ → Enter で検索欄へ → 名前を打つ → Enter で配置 → 続けて次を打てる
//                                          ↑↓ で候補を選ぶ ／ Esc で盤面へ戻る
//   枠を選ぶ側と人を選ぶ側を行き来するだけなので、覚えるのは Enter と Esc の2つで済む。
//
// 🔴 選択は id で持つ（添字ではない）。
//   配置すると枠の中身が入れ替わり、サーバから戻ると並びも変わりうる。
//   添字で覚えていると、**戻ってきた瞬間に別の枠を選んでいる**ことになる。
//
// 🔴 dnd-kit の KeyboardSensor と衝突させない。
//   プレートは useDraggable の attributes で tabIndex=0 / role=button を持つので、
//   Tab で到達でき、そこで Enter を押すと dnd-kit 側のキーボードドラッグが始まる。
//   → **プレートに DOM フォーカスがある間は、こちらは一切手を出さない**。
//     判定は aria-roledescription="draggable"（dnd-kit が必ず付ける属性）で行う。
"use client";

import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import type { AssignmentRole, GuardView, JobType, ShiftRow } from "@/lib/types";

/** 職種のキー。A表の K・R・D と同じ文字 */
const JOB_BY_KEY: Record<string, JobType> = { K: "kentei", R: "train", D: "driver" };

/** いま操作対象になっている枠とプレート。プレート単独の選択は無い（必ず枠に属する） */
export type BoardSelection = {
  shiftId: string | null;
  assignmentId: string | null;
};

export const NO_SELECTION: BoardSelection = { shiftId: null, assignmentId: null };

/** 入力欄の中で押されたキーか。ここでは盤面のショートカットを効かせない */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

/**
 * dnd-kit がフォーカスを持っているか。
 * 🔴 aria-roledescription="draggable" は useDraggable が返す attributes に必ず含まれる。
 *   自前のクラス名や data 属性で判定すると、付け忘れたときに黙って壊れる。
 */
function isDndFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.getAttribute("aria-roledescription") === "draggable";
}

/**
 * ボタンやリンクにフォーカスがあるか。
 *
 * 🔴 2026-09-04 追加。ここを見ていなかったため、**フォーカスのあるボタンを
 *   Enter で押せなくしていた**（`一括確定` が押せないという報告の原因の1つ）。
 *   Enter でボタンを押すのはブラウザの既定動作であって、こちらの持ち物ではない。
 *   盤面のショートカットを足すときは「奪ってよいキーか」を必ず先に問う。
 */
function isActivatable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button";
}

export type BoardKeysOptions = {
  /** いま画面に出ている枠。並び順がそのまま ↑↓ の順になる */
  rows: ShiftRow[];
  /** 絞り込み後のプール。Enter で配置する候補はこの中から選ぶ */
  candidates: GuardView[];
  /** 事務ロールでは丸ごと効かせない（ボタンの出し分けと同じ扱い） */
  enabled: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onPlace: (guardId: string, shiftId: string) => void;
  onUnplace: (assignmentId: string) => void;
  onSetRole: (assignmentId: string, role: AssignmentRole) => void;
  /** 職種の付け外し（2026-10-08）。K・R・D キー */
  onSetJobType: (assignmentId: string, jobType: JobType | null) => void;
  onConfirm: (shiftId: string) => void;
  /** 検索欄を空にする（配置したら次の氏名を打てる状態に戻す） */
  onClearQuery: () => void;
};

export function useBoardKeys({
  rows,
  candidates,
  enabled,
  searchRef,
  onPlace,
  onUnplace,
  onSetRole,
  onSetJobType,
  onConfirm,
  onClearQuery,
}: BoardKeysOptions) {
  const [selection, setSelection] = useState<BoardSelection>(NO_SELECTION);
  const [candidateIndex, setCandidateIndex] = useState(0);
  /** 押したのに何も起きなかった理由。凡例の場所に出す（黙って無反応にしない） */
  const [notice, setNotice] = useState<string | null>(null);

  // 🔴 候補が減ると添字がはみ出す。使うたびに丸める（state に書き戻さない ─
  //   描画のたびに setState すると二段描画になり、lint も止める）。
  const cursor = candidates.length === 0 ? -1 : Math.min(candidateIndex, candidates.length - 1);
  const selectedRow = rows.find((r) => r.shift.id === selection.shiftId) ?? null;

  /** 枠を1つ進める／戻す。選択が無ければ端から始める */
  function moveShift(delta: 1 | -1) {
    if (rows.length === 0) return;
    const at = rows.findIndex((r) => r.shift.id === selection.shiftId);
    const next = at < 0 ? (delta === 1 ? 0 : rows.length - 1) : at + delta;
    // 🔴 端で回り込ませない。40枚の中では「一周して先頭に戻った」ことに気づけない
    const clamped = Math.max(0, Math.min(rows.length - 1, next));
    setSelection({ shiftId: rows[clamped].shift.id, assignmentId: null });
    setNotice(null);
  }

  /** 選択中の枠の中でプレートを1枚ずらす */
  function movePlate(delta: 1 | -1) {
    if (!selectedRow || selectedRow.plates.length === 0) return;
    const plates = selectedRow.plates;
    const at = plates.findIndex((p) => p.assignmentId === selection.assignmentId);
    const next = at < 0 ? (delta === 1 ? 0 : plates.length - 1) : at + delta;
    const clamped = Math.max(0, Math.min(plates.length - 1, next));
    setSelection({ shiftId: selectedRow.shift.id, assignmentId: plates[clamped].assignmentId });
    setNotice(null);
  }

  function focusSearch() {
    const el = searchRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }

  // ── 盤面のキー ────────────────────────────────────────
  //
  // 🔴 依存配列を付けない（毎描画で貼り直す）。
  //   rows / selection / candidates のすべてを見るハンドラなので、列挙し忘れると
  //   **古い selection のまま動く**という、いちばん気づきにくい壊れ方をする。
  //   付け外しは1描画あたり1回で、この画面の負荷にはならない。
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: globalThis.KeyboardEvent) {
      // 他所で処理済み／入力中／dnd-kit がフォーカスを持っている
      if (e.defaultPrevented || isTypingTarget(e.target) || isDndFocused()) return;
      // 🔴 OS のショートカット（⌘・Alt 系）は奪わない。Ctrl だけ例外的に見る
      if (e.metaKey || e.altKey) return;

      if (e.ctrlKey) {
        // Ctrl+S ＝ 選択中の枠を確定（ブラウザの「保存」を止める）
        if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (!selectedRow) {
            setNotice("確定する枠を ↑↓ で選んでください");
            return;
          }
          if (selectedRow.shift.status === "confirmed") {
            setNotice("この枠は確定済みです");
            return;
          }
          onConfirm(selectedRow.shift.id);
          setNotice(null);
        }
        return;
      }

      switch (e.key) {
        case "/":
          e.preventDefault();
          focusSearch();
          return;

        case "ArrowDown":
          e.preventDefault(); // 画面ごとスクロールするのを止める
          moveShift(1);
          return;
        case "ArrowUp":
          e.preventDefault();
          moveShift(-1);
          return;
        case "ArrowRight":
          e.preventDefault();
          movePlate(1);
          return;
        case "ArrowLeft":
          e.preventDefault();
          movePlate(-1);
          return;

        case "Enter":
          // 🔴 ボタン・リンクにフォーカスがあるときの Enter は「それを押す」。
          //   preventDefault すると、キーボードだけで操作している人にとって
          //   そのボタンが**存在しないのと同じ**になる
          if (isActivatable(document.activeElement)) return;
          e.preventDefault();
          if (!selectedRow) {
            setNotice("先に枠を ↑↓ で選んでください");
            return;
          }
          focusSearch();
          return;

        // 🔴 Backspace は割り当てない（§2-8 も Del だけ）。
        //   配置を消す操作に、いちばん反射で押されるキーを重ねない。
        //   取り消しの手段がまだ無い以上、事故の入口は狭くしておく。
        case "Delete":
          e.preventDefault();
          if (!selection.assignmentId) {
            setNotice("外すプレートを ←→ で選んでください");
            return;
          }
          onUnplace(selection.assignmentId);
          // 外したプレートは消えるので、選択は枠だけに戻す
          setSelection({ shiftId: selection.shiftId, assignmentId: null });
          setNotice(null);
          return;

        case "l":
        case "L": {
          e.preventDefault();
          const plate = selectedRow?.plates.find((p) => p.assignmentId === selection.assignmentId);
          if (!plate) {
            setNotice("隊長にするプレートを ←→ で選んでください");
            return;
          }
          onSetRole(plate.assignmentId, plate.role === "leader" ? "member" : "leader");
          setNotice(null);
          return;
        }

        // 🔴 職種（2026-10-08）。A表と同じ文字のキーで付ける。同じキーをもう一度で外す
        case "k":
        case "K":
        case "r":
        case "R":
        case "d":
        case "D": {
          e.preventDefault();
          const plate = selectedRow?.plates.find((p) => p.assignmentId === selection.assignmentId);
          if (!plate) {
            setNotice("職種を付けるプレートを ←→ で選んでください");
            return;
          }
          const job = JOB_BY_KEY[e.key.toUpperCase()];
          onSetJobType(plate.assignmentId, plate.jobType === job ? null : job);
          setNotice(null);
          return;
        }

        case "Escape":
          setSelection(NO_SELECTION);
          setNotice(null);
          return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // ── 検索欄のキー（入力中はこちらだけが効く） ──────────
  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!enabled) return;

    // 🔴 IME の変換中は一切手を出さない。
    //   日本語入力は「やまだ」→ 変換 → **Enter で確定**という手順を踏む。
    //   この Enter を拾うと、変換を確定しただけで配置が走る。
    //   ↑↓ も変換候補の選択に使われるため同じ理由で通す。
    //   氏名は全員日本語で入る画面なので、これは例外ではなく既定の経路。
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.blur(); // 盤面へ戻る。打った文字は消さない
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCandidateIndex(Math.min(candidates.length - 1, cursor + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCandidateIndex(Math.max(0, cursor - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!selection.shiftId) {
        setNotice("先に枠を選んでください（Esc → ↑↓）");
        return;
      }
      if (cursor < 0) {
        setNotice("該当する隊員がいません");
        return;
      }
      onPlace(candidates[cursor].guard.id, selection.shiftId);
      // 🔴 配置したら検索欄を空にする。打った氏名を残すと、置いた本人がプールから
      //   消えて**0件の絞り込みだけが残る**。空にしておけば次の氏名をそのまま打てる
      onClearQuery();
      setCandidateIndex(0);
      setNotice(null);
      return;
    }
  }

  /**
   * クリックでも選べるようにする。
   * 🔴 マウスとキーボードで**選択を1つにする**。別々に持つと、
   *   クリックで選んだ枠に ←→ が効かない、といった食い違いが必ず出る。
   */
  function select(shiftId: string, assignmentId: string | null) {
    setSelection({ shiftId, assignmentId });
    setNotice(null);
  }

  return {
    selection,
    select,
    /** プール候補のうち、Enter で置かれる1名の位置。-1 は候補なし */
    cursor,
    notice,
    onSearchKeyDown,
  };
}

// CSV の読み書き（外部依存なし・RFC4180 準拠の範囲）。
//
// 🔴 `keibi-bantou-cloud/src/lib/csv.ts` からのフォーク（2026-09-14）。
//   共通ライブラリにはしない（CLAUDE.md「方式：フォーク（コピー）」）。
//   あちらは毎週動いており、共有すると片方の変更が他方を壊すため。
//
// 用途は ShiftMax マスタ（べんり君のシートから CSV 化したもの）の取込。
// 相手は Excel で保存する前提なので、「Excel が吐く CSV」を素直に読めることを
// 最優先にしている：
//   - 区切りはカンマ、改行は CRLF / LF どちらも可
//   - フィールドは "..." で囲める。囲みの中の "" はダブルクォート1文字
//   - 先頭の BOM は取り除く
//   - 文字コードは UTF-8 を第一候補にし、失敗したら Shift_JIS で読み直す
//     （Excel で「CSV(カンマ区切り)」保存すると Shift_JIS になるため）

// 1行ずつのセル配列に分解する。空行は読み飛ばす。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // 直前の文字がフィールドを確定させたか（空セルと未開始セルの区別は不要なので単純に積む）
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // 全セルが空の行は捨てる（末尾の空行・Excel が足す余分な行への対処）
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF / CR いずれも改行として扱う
      pushRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // 最終行（末尾に改行が無い場合）
  if (field !== "" || row.length > 0) pushRow();

  return rows;
}

// セルを CSV の1フィールドとして書き出す。カンマ・改行・引用符を含むときだけ囲む。
function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// 行配列を CSV 文字列にする。改行は Excel に合わせて CRLF。
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
}

// Excel が UTF-8 と判定できるよう BOM を付ける。テンプレート配布用。
export function toCsvWithBom(rows: readonly (readonly string[])[]): string {
  return "﻿" + toCsv(rows);
}

// アップロードされたファイルの中身を文字列にする。
// UTF-8 として厳密に読めなければ Shift_JIS とみなして読み直す。
export function decodeCsvBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // fatal:true が投げた = UTF-8 として不正。日本語 CSV ではほぼ Shift_JIS。
    text = new TextDecoder("shift_jis").decode(bytes);
  }
  // BOM を除去（先頭に残っていると1列目のヘッダ名が一致しなくなる）
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

# -*- coding: utf-8 -*-
"""
現場マスタの初期データを、7月実データ（べんり君）から起こす。

🔴 なぜこれが要るのか
  ShiftMax の勤務マスタには「現場」が入っていない。
  1,593件の正体は〈顧客603種 × 勤務区分〉であり、
  実際の現場名（「◯◯（巡回）」等）はどこにも登録されていない。
  管制は毎日それを手で打っている（7月は延べ 1,899回）。
  → 現場名が残っているのは**日次シートの手入力テキストだけ**。
     ここから起こす以外に、現場マスタを作る方法が無い。
  詳細は docs/data-gap-20260917.md §2。

🔴 これは「移行ツール」ではなく「一度きりの初期データ作成」
  scripts/dummy-data.mts と同じく**開発ツールであってシステムではない**。
  src/ の外に置く。第1弾の稼働後は使わない。

🔴 出力は Git に入れない（local/ は .gitignore 済み）
  取引先実名・現場名が入るため、受領資料と同じ扱いにする。

使い方:
    python scripts/extract-sites.py
    → local/sites-extracted.csv （Excel でそのまま開ける）
"""
import collections
import csv
import io
import os
import sys

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl が要る:  pip install openpyxl")

SRC = os.path.join("docs", "管制_別紙", "べんり君_別紙Ⓑ.xlsm")
OUT = os.path.join("local", "sites-extracted.csv")

# 日次シートの列（docs/shiftmax-api-analysis.md §8-2）
# D=請求番号 E=請求名 F=担当名 G=警備先番号 H=現場略称 I=現場名
# J=人数 K/L=開始 M/N=終了 O=昼休憩 P=班名 Q=備考
C_BILL_NO, C_GUARD_NO, C_SHORT, C_NAME = 3, 6, 7, 8
C_HEAD, C_SH, C_SM, C_EH, C_EM, C_BREAK, C_NOTE = 9, 10, 11, 12, 13, 14, 16

# 勤務マスタの列（同 §7-2）B=現場コード C=警備先番号 O=顧客コード Q=顧客名 V=現場管轄
M_SITE_CODE, M_GUARD_NO, M_CUST_CODE, M_CUST_NAME, M_JURIS = 1, 2, 14, 16, 21

# 🔴 現場ではない区分（勤務マスタに擬似現場として実在する）。
#   これを sites に入れると配置ボードの現場一覧に「有休」が並ぶ。
#   新システムでは assignments.kind='off' 側で持つ（data-gap-20260917.md §3-1）。
NOT_A_SITE = {
    "内勤", "会社欠", "有休.", "有休", "有給", "教育", "新任", "現任",
    "育休", "介護休", "忌引休", "業災休", "産休", "振休", "空白",
    # 🔴 現中（現着中止）は「現場」ではなく配置の状態。
    #   work_kind の dayCancel / nightCancel 側で持つ（requirements.md §8-7 ①は未決）。
    "日勤現中", "夜勤現中",
}


def mode_of(counter):
    """最頻値と「何通りあったか」を返す。"""
    if not counter:
        return "", 0
    return counter.most_common(1)[0][0], len(counter)


def main():
    if not os.path.exists(SRC):
        sys.exit("受領資料が見つからない: %s" % SRC)

    wb = openpyxl.load_workbook(SRC, data_only=True, read_only=True)

    # ---- 1. 勤務マスタ（警備先番号 → 顧客・管轄）を引けるようにする
    master = {}
    ws = wb["勤務マスター"]
    for r in ws.iter_rows(min_row=3, max_row=1600, max_col=26, values_only=True):
        no = r[M_GUARD_NO]
        if no is None:
            continue
        master[str(no).strip()] = {
            "site_code": str(r[M_SITE_CODE] or "").strip(),
            "cust_code": str(r[M_CUST_CODE] or "").strip(),
            "cust_name": str(r[M_CUST_NAME] or "").strip(),
            "juris": str(r[M_JURIS] or "").strip(),
        }

    # ---- 2. 日次シート31枚から（警備先番号 × 現場名）を集める
    site = collections.OrderedDict()
    for d in range(1, 32):
        name = "7.%d(チェック済み)" % d
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        for r in ws.iter_rows(min_row=9, max_row=400, max_col=21, values_only=True):
            no, nm = r[C_GUARD_NO], r[C_NAME]
            if no is None or nm is None:
                continue
            key = (str(no).strip(), str(nm).strip())
            s = site.setdefault(key, {
                "days": set(), "kind": collections.Counter(),
                "time": collections.Counter(), "brk": collections.Counter(),
                "head": collections.Counter(), "note": collections.Counter(),
            })
            s["days"].add(d)
            s["kind"][str(r[C_SHORT] or "").strip()] += 1
            if r[C_SH] is not None and r[C_EH] is not None:
                s["time"]["%02d:%02d-%02d:%02d" % (
                    int(r[C_SH]), int(r[C_SM] or 0), int(r[C_EH]), int(r[C_EM] or 0))] += 1
            if r[C_BREAK] is not None:
                s["brk"][str(r[C_BREAK])] += 1
            if r[C_HEAD] is not None:
                try:
                    s["head"][int(r[C_HEAD])] += 1
                except (TypeError, ValueError):
                    pass
            if r[C_NOTE]:
                s["note"][str(r[C_NOTE]).strip()] += 1
    wb.close()

    # ---- 3. 書き出す
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    rows = skipped = unmatched = 0
    # utf-8-sig ＝ Excel が文字化けせずに開ける
    with io.open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "No", "警備先番号", "現場名", "略称(案)", "区分", "出た日数",
            "開始", "終了", "時間は一定", "休憩", "人数", "人数は一定",
            "顧客名", "管轄", "現場コード(ShiftMax)", "備考に出た語", "確認",
        ])
        for (no, nm), s in sorted(site.items(), key=lambda kv: -len(kv[1]["days"])):
            kind, _ = mode_of(s["kind"])
            if kind in NOT_A_SITE:      # 休み・内勤などは現場ではない
                skipped += 1
                continue
            m = master.get(no)
            if m is None:
                unmatched += 1
                m = {"site_code": "", "cust_name": "", "juris": ""}
            tm, tn = mode_of(s["time"])
            hd, hn = mode_of(s["head"])
            bk, _ = mode_of(s["brk"])
            start, end = (tm.split("-") + [""])[:2] if tm else ("", "")
            rows += 1
            w.writerow([
                rows, no, nm, nm[:6], kind, len(s["days"]),
                start, end, "○" if tn == 1 else "△(%d通り)" % tn,
                bk, hd, "○" if hn == 1 else "△(%d通り)" % hn,
                m["cust_name"], m["juris"], m["site_code"],
                " / ".join(k for k, _ in s["note"].most_common(2)), "",
            ])

    print("■ 現場として書き出した: %d 件" % rows)
    print("■ 現場ではないため除外（休み・内勤など）: %d 件" % skipped)
    print("■ 勤務マスタに警備先番号が無く顧客を引けなかった: %d 件" % unmatched)
    print("→ %s" % OUT)


if __name__ == "__main__":
    main()

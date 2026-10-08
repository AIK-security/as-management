# -*- coding: utf-8 -*-
"""
過去の配置（誰がどの現場に入ったか）を、実データ（べんり君）から SQL にする。

🔴 なぜ要るのか（2026-10-01 決定）
  管制は「実データでないと触ってみる気にならない」。
  過去の配置が入っていると、配置ボードの「入ったことがある現場」が実際の経験で出る。

🔴 隊員はセルではなく図形（プレート）で置かれている（shiftmax-api-analysis.md §8-3）
  S/T/U 列のセルは全部空。xlsm の中の図形データ（xl/drawings/*.xml）を読み、
  **プレートの縦の中心がどの行に入るか**で枠を決める。
  上端のずれだけで判定すると7月で33行がずれた（10/2 実測）。行の高さを足し上げて中心を出す。
  氏名はプレートの文字を社員マスターの「個人名」か「略称」と突き合わせる（べんり君と同じ）。

🔴 入れないもの
  ・休み・内勤・教育など現場ではない行（過去の休みは使い道が無い ─ 10/2 柴山）
  ・「応援」プレート（協力会社のまとめ枠。新システムは協力会社を個人で持つため）

🔴 区分「夜勤」（A／B の無いもの）は夜A として入れる
  管制の答え（2026-10-08）：「夜勤（夜勤管制）は A夜勤と同じ」。
  7〜9月分は開始時刻で振り分けていた（23:00 以降に始まるものは夜B）。取込済みの分は直していない。

🔴 これは「一度きりの初期データ作成」。scripts/extract-sites.py と同じく開発ツール。
  出力は Git に入れない（local/ は .gitignore 済み）。実名・現場名が入るため。

使い方:
    python scripts/extract-assignments.py [ファイル …]   # 渡すファイルは extract-sites.py と同じにする
    → local/past-assignments.sql   SQL Editor で流す（現場・隊員・得意先を取り込んだ後）
"""
import collections
import importlib.util
import io
import os
import posixpath
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from datetime import date

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("extract_sites", os.path.join(HERE, "extract-sites.py"))
es = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(es)

OUT = os.path.join("local", "past-assignments.sql")

# 7月実データの年。シート名は「月.日」しか持たないため、年は引数で上書きできるようにする
YEAR = int(os.environ.get("BENRI_YEAR", "2026"))

NS = {"xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
      "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
SML = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
EMU_PER_PT = 12700
PLATE_COLS = (18, 19, 20)          # S/T/U（0始まり）

KIND_MAP = {
    "日勤": "day", "日": "day",
    "夜A": "nightA", "夜B": "nightB",
    "日勤現中": "dayCancel", "夜勤現中": "nightCancel",
}
NIGHT_UNSPLIT = {"夜勤", "夜"}     # A／B が無い夜勤


def nz(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or ""))


def q(v):
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def read_guards(wb):
    """社員マスター：氏名・略称 → 個人コード。略称が重複するものは使わない。"""
    ws = wb["社員マスター"]
    rows = list(ws.iter_rows(max_row=1000, max_col=20, values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and any(es.cell(c) == "個人名" for c in r))
    h = [es.cell(c) for c in rows[hi]]
    c_code, c_name = h.index("個人コード"), h.index("個人名")
    c_short = h.index("略称") if "略称" in h else None
    by_name, by_short, short_count = {}, {}, collections.Counter()
    for r in rows[hi + 1:]:
        code, name = es.cell(r[c_code]), es.cell(r[c_name])
        if not code or not name:
            continue
        by_name[nz(name)] = code
        if c_short is not None and r[c_short]:
            s = nz(es.cell(r[c_short]))
            by_short[s] = code
            short_count[s] += 1
    for s, n in short_count.items():
        if n > 1:
            del by_short[s]
    # 🔴 先頭の「●」（社員の印）を外した略称でも引けるようにする（2026-10-05）。
    #   社員 → アルバイトに変わると、マスタは最新（●なし）でも前の月のプレートは●付きのまま。
    #   8月分で「●細井陽仁」4枚がこれで落ちた。外した結果が重なる場合は使わない（取り違え防止）
    bare = collections.defaultdict(set)
    for s, code in by_short.items():
        bare[s.lstrip("●")].add(code)
    for s, codes in bare.items():
        if len(codes) == 1:
            code = next(iter(codes))
            by_short.setdefault(s, code)
            by_short.setdefault("●" + s, code)
    return by_name, by_short


class Book:
    """xlsm の図形データ（プレート）を読むための薄い包み。"""

    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        wbx = ET.fromstring(self.z.read("xl/workbook.xml"))
        rels = self._rels("xl/workbook.xml")
        self.sheet_path = {s.get("name"): rels[s.get(REL_ID)] for s in wbx.iter(SML + "sheet")}

    def _rels(self, path):
        d, b = posixpath.split(path)
        p = posixpath.join(d, "_rels", b + ".rels")
        if p not in self.z.namelist():
            return {}
        return {e.get("Id"): posixpath.normpath(posixpath.join(d, e.get("Target")))
                for e in ET.fromstring(self.z.read(p))}

    def plates(self, sheet_name):
        """(行番号, プレートの文字) を返す。行番号は 1 始まり。"""
        sp = self.sheet_path[sheet_name]
        drawings = [v for v in self._rels(sp).values() if "/drawings/drawing" in v and v.endswith(".xml")]
        if not drawings:
            return []
        sx = ET.fromstring(self.z.read(sp))
        fmt = sx.find(SML + "sheetFormatPr")
        default_ht = float(fmt.get("defaultRowHeight", 15)) if fmt is not None else 15.0
        hts = {int(r.get("r")): float(r.get("ht")) for r in sx.iter(SML + "row") if r.get("ht")}
        tops = [0.0]                                  # tops[k] = 行 k+1 の上端（EMU）
        for i in range(1, 2001):
            tops.append(tops[-1] + hts.get(i, default_ht) * EMU_PER_PT)

        out = []
        for anc in self._anchors(ET.fromstring(self.z.read(drawings[0]))):
            fr = anc.find("xdr:from", NS)
            if fr is None:
                continue
            col = int(fr.find("xdr:col", NS).text)
            if col not in PLATE_COLS:
                continue
            text = "".join(t.text or "" for t in anc.iter("{%s}t" % NS["a"])).strip()
            if not text:
                continue
            row = int(fr.find("xdr:row", NS).text)
            top = tops[row] + int(fr.find("xdr:rowOff", NS).text)
            to = anc.find("xdr:to", NS)
            if to is not None:
                bottom = tops[int(to.find("xdr:row", NS).text)] + int(to.find("xdr:rowOff", NS).text)
            else:
                bottom = top + int(anc.find("xdr:ext", NS).get("cy"))
            center = (top + bottom) / 2
            out.append((next(k for k in range(1, 2000) if tops[k] > center), text))
        return out

    @staticmethod
    def _anchors(root):
        for a in root:
            if a.tag.endswith("AlternateContent"):
                inner = [e for e in a.iter() if e.tag.endswith("Anchor")]
                if inner:
                    yield inner[0]
            else:
                yield a


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def main():
    srcs = sys.argv[1:] or [es.DEFAULT_SRC]
    stat = collections.Counter()

    # ---- 1. 勤務マスタと社員マスタ（最後に渡したファイルのもの）
    wb_last = openpyxl.load_workbook(srcs[-1], data_only=True, read_only=True)
    master = es.read_master(wb_last)
    by_name, by_short = read_guards(wb_last)
    wb_last.close()

    # ---- 2. 行と、その行に乗っているプレートを集める
    shifts = []        # dict（枠1件）
    print("■ 読んだファイル")
    for src in srcs:
        wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
        book = Book(src)
        n_rows = n_plates = 0
        for name in wb.sheetnames:
            m = es.DAY_SHEET.match(name)
            if not m:
                continue
            work_date = date(YEAR, int(m.group(1)), int(m.group(2)))
            on_row = collections.defaultdict(list)
            for row, text in book.plates(name):
                on_row[row].append(text)
                n_plates += 1
            # 9行目からがデータ（1〜8行目は見出し。extract-sites.py と同じ）
            for i, r in enumerate(wb[name].iter_rows(min_row=9, max_row=400, max_col=21, values_only=True), start=9):
                no, nm = es.cell(r[es.C_GUARD_NO]), es.cell(r[es.C_NAME])
                if not no or not nm:
                    if on_row.get(i):
                        stat["現場の無い行に乗ったプレート"] += len(on_row[i])
                    continue
                n_rows += 1
                raw_kind = es.cell(r[es.C_SHORT])
                if raw_kind in es.NOT_A_SITE and raw_kind not in ("日勤現中", "夜勤現中"):
                    stat["入れない行（休み・内勤など）"] += 1
                    continue
                sh, sm = to_int(r[es.C_SH]), to_int(r[es.C_SM]) or 0
                eh, em = to_int(r[es.C_EH]), to_int(r[es.C_EM]) or 0
                if raw_kind in NIGHT_UNSPLIT:
                    kind = "nightA"
                    stat["夜勤 → nightA"] += 1
                else:
                    kind = KIND_MAP.get(raw_kind)
                if kind is None:
                    stat["区分が分からず入れない行（%s）" % raw_kind] += 1
                    continue
                if sh is None or eh is None:
                    stat["時刻が無く入れない行（%s）" % raw_kind] += 1
                    continue
                mrow = master.get(no)
                guards = []
                for text in on_row.get(i, []):
                    t = nz(text)
                    if "応援" in t:
                        stat["応援プレート（入れない）"] += 1
                        continue
                    code = by_name.get(t) or by_short.get(t)
                    if code is None:
                        stat["社員マスターに無いプレート（入れない）"] += 1
                        continue
                    guards.append(code)
                head = to_int(r[es.C_HEAD])
                shifts.append({
                    "site": nm, "staff": mrow["cust_staff"] if mrow else "",
                    "date": work_date, "kind": kind,
                    "head": head if head and head > 0 else max(1, len(guards)),
                    "sh": sh, "sm": sm, "eh": eh, "em": em,
                    "brk": to_int(r[es.C_BREAK]) or 0,
                    "comment": es.cell(r[es.C_NOTE]) or None,
                    "guards": guards,
                })
        wb.close()
        print("  %s … 現場の行 %d / プレート %d%s" % (
            src, n_rows, n_plates, "  🔴 0件。シート名の形を確かめること" if n_rows == 0 else ""))

    # ---- 3. 現場名は extract-sites.py と同じ規則で決める（表記揺れは最頻の書き方に寄せる）
    names = collections.defaultdict(collections.Counter)
    for s in shifts:
        names[(es.norm(s["site"]), s["staff"])][s["site"]] += 1
    for s in shifts:
        s["site"] = names[(es.norm(s["site"]), s["staff"])].most_common(1)[0][0]

    # ---- 4. 同じ人の時間帯の重なりを先に数える
    #   確定にする時点で DB の排他制約が効き、1件でも重なると**丸ごと失敗する**ため。
    spans = collections.defaultdict(list)
    for idx, s in enumerate(shifts):
        st = s["sh"] * 60 + s["sm"]
        en = s["eh"] * 60 + s["em"]
        if en <= st:
            en += 24 * 60
        base = s["date"].toordinal() * 24 * 60
        for g in s["guards"]:
            spans[g].append((base + st, base + en, idx))
    overlap_shifts = set()
    for g, lst in spans.items():
        lst.sort()
        for (a1, b1, i1), (a2, b2, i2) in zip(lst, lst[1:]):
            if a2 < b1:
                stat["時間帯が重なる配置（同じ人）"] += 1
                overlap_shifts.add(i2)
    # 重なった側の枠は確定にせず仮組みのまま残す（管制が画面で見て直せる）

    # ---- 5. SQL を書く
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    n_asg = sum(len(s["guards"]) for s in shifts)
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        w = lambda line="": f.write(line + "\n")
        w("-- 過去の配置（べんり君から生成）。🔴 Git に入れない。実名・現場名が入る")
        w("-- 生成: scripts/extract-assignments.py / 枠 %d / 配置 %d" % (len(shifts), n_asg))
        w("-- 前提: 得意先 → 勤務マスター → 現場一覧 → 社員マスター を取り込み済みであること")
        w("begin;")
        w()
        w("create temp table imp_shift (k int primary key, id uuid not null default gen_random_uuid(),")
        w("  site_name text, staff_code text, work_date date, work_kind text, headcount int,")
        w("  sh int, sm int, eh int, em int, brk int, comment text, confirm boolean) on commit drop;")
        w("create temp table imp_asg (k int, staff_code text, pos int) on commit drop;")
        w()
        for start in range(0, len(shifts), 500):
            part = shifts[start:start + 500]
            w("insert into imp_shift (k, site_name, staff_code, work_date, work_kind, headcount, sh, sm, eh, em, brk, comment, confirm) values")
            w(",\n".join(
                "  (%d, %s, %s, '%s', '%s', %d, %d, %d, %d, %d, %d, %s, %s)" % (
                    start + j, q(s["site"]), q(s["staff"] or None), s["date"].isoformat(), s["kind"],
                    s["head"], s["sh"], s["sm"], s["eh"], s["em"], s["brk"], q(s["comment"]),
                    "false" if (start + j) in overlap_shifts else "true")
                for j, s in enumerate(part)) + ";")
        asg = [(k, g, p) for k, s in enumerate(shifts) for p, g in enumerate(s["guards"])]
        for start in range(0, len(asg), 1000):
            w("insert into imp_asg (k, staff_code, pos) values")
            w(",\n".join("  (%d, %s, %d)" % (k, q(g), p) for k, g, p in asg[start:start + 1000]) + ";")
        w()
        w("""-- 現場・隊員を引けない行があれば止める（黙って落とさない）
do $$
declare n_site int; n_guard int; n_dup int;
begin
  select count(*) into n_site from imp_shift i
   where not exists (select 1 from public.sites s left join public.customers c on c.id = s.customer_id
                      where s.name = i.site_name and c.staff_code is not distinct from i.staff_code);
  select count(*) into n_guard from imp_asg a
   where not exists (select 1 from public.guards g where g.staff_code = a.staff_code);
  -- 🔴 二重取込の防止：同じ現場・同じ日・同じ区分の枠が既にあれば止める
  select count(*) into n_dup from imp_shift i
    join public.sites s on s.name = i.site_name
    left join public.customers c on c.id = s.customer_id
   where c.staff_code is not distinct from i.staff_code
     and exists (select 1 from public.shifts x
                  where x.site_id = s.id and x.work_date = i.work_date and x.work_kind = i.work_kind);
  if n_site > 0 or n_guard > 0 or n_dup > 0 then
    raise exception '止めました：現場が引けない枠 % 件 / 隊員が引けない配置 % 件 / 既にある枠 % 件',
      n_site, n_guard, n_dup;
  end if;
end $$;

insert into public.shifts (id, site_id, work_date, work_kind, headcount,
                           start_h, start_m, end_h, end_m, break_min, plan_comment, status)
select i.id, s.id, i.work_date, i.work_kind, i.headcount, i.sh, i.sm, i.eh, i.em, i.brk, i.comment, 'draft'
  from imp_shift i
  join public.sites s on s.name = i.site_name
  left join public.customers c on c.id = s.customer_id
 where c.staff_code is not distinct from i.staff_code;

insert into public.assignments (guard_id, work_date, kind, shift_id, position)
select g.id, i.work_date, 'site', i.id, a.pos
  from imp_asg a
  join imp_shift i on i.k = a.k
  join public.guards g on g.staff_code = a.staff_code;

-- 🔴 配置を入れ終わってから確定にする（確定済みの枠に配置を足すと仮組みへ戻るトリガーがあるため）
update public.shifts x set status = 'confirmed', confirmed_at = now()
  from imp_shift i where x.id = i.id and i.confirm;

-- 確認用（この結果を目視する）
select (select count(*) from imp_shift) as 枠,
       (select count(*) from imp_shift where confirm) as うち確定,
       (select count(*) from imp_asg) as 配置;

commit;""")

    print("■ 枠 %d 件 / 配置 %d 件（重なりがあるため仮組みのまま残す枠 %d 件）" % (
        len(shifts), n_asg, len(overlap_shifts)))
    for k, v in sorted(stat.items()):
        print("  %s: %d" % (k, v))
    print("→ %s" % OUT)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""index.html に残っている絵文字を数えて、置き場所ごとに仕分ける。

デザイン規約 D-4/(1)「UI アイコンに絵文字を使わない」の進み具合を見るための道具。
置き換えの判断は「どこに書かれているか」で変わるので、そこを機械で分ける：

  データ      … 宝具などの定義テーブル（icon:'…'）。表示のされ方が複数あるので個別判断
  innerHTML   … HTML として解釈される。ico() でそのまま置き換えられる
  文字だけ    … innerText / textContent / title / confirm / canvas。
                HTML を解釈しないのでアイコンを置けない。文字にするか作りを変える
  HTML        … <body> 側の地の文。ico() で置き換えられる
  コメント    … 画面に出ない。置き換えなくてよい（残っていても規約違反ではない）

使い方:
    python3 tools/emoji_audit.py          # 一覧を出す
    python3 tools/emoji_audit.py --check  # 画面に出る絵文字が残っていたら終了コード1
"""
import io, os, re, sys, unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")

# 「絵文字かどうか」は見た目ではなく **埋め込んだ書体に入っているか** で決める。
# 書体にある文字（★ ← → × ≡ など）はドット絵の書体で描かれるので規約どおり。
# 無い文字は OS の絵文字フォントに落ちる＝そこだけ別の絵になる。これが置き換えの対象。
CAND = re.compile("[\U0001F000-\U0001FAFF\u2190-\u2BFF\u3030\u303D\uFE0F\u23E9-\u23FA]")


def font_cmap():
    """index.html に埋め込んである書体が持つ文字の集合。"""
    from fontTools.ttLib import TTFont
    import base64, io as _io
    src = _io.open(INDEX, encoding="utf-8").read()
    m = re.search(r"src: url\(data:font/woff;base64,([A-Za-z0-9+/=]+)\)", src)
    assert m, "@font-face の埋め込みが見つからない"
    return set(TTFont(_io.BytesIO(base64.b64decode(m.group(1)))).getBestCmap().keys())


def classify(line, in_script, in_legacy):
    t = line.strip()
    if in_legacy:
        # 旧セーブ・旧譲渡コードを読み替えるための表。絵文字は「鍵」であって画面には出ない。
        return "旧データ"
    if t.startswith("//") or t.startswith("*") or t.startswith("/*"):
        return "コメント"
    if not in_script:
        return "HTML"
    if re.search(r"\bicon\s*:", line) or "MONSTER_ICONS" in line:
        return "データ"
    if "innerHTML" in line:
        return "innerHTML"
    if re.search(r"(innerText|textContent|\.title\s*=|confirm\(|alert\(|fillText|spawnFloatingText)", line):
        return "文字だけ"
    return "その他"


def audit():
    s = io.open(INDEX, encoding="utf-8").read()
    lo, hi = s.index("<script>"), s.index("</script>")
    have = font_cmap()
    rows = []
    in_legacy = False
    for i, line in enumerate(s.split("\n"), 1):
        if "const LEGACY_ICON" in line:
            in_legacy = True
        elif in_legacy and line.strip().startswith("};"):
            in_legacy = False
        found = [c for c in CAND.findall(line) if ord(c) not in have]
        if not found:
            continue
        pos = sum(len(x) + 1 for x in s.split("\n")[:i - 1])
        kind = classify(line, lo < pos < hi, in_legacy)
        for ch in found:
            if ch == "️":
                continue
            rows.append((ch, kind, i, line.strip()))
    return rows


def main():
    rows = audit()
    by_kind = Counter(r[1] for r in rows)
    by_char = defaultdict(Counter)
    for ch, kind, _, _ in rows:
        by_char[ch][kind] += 1

    visible = [r for r in rows if r[1] not in ("コメント", "旧データ")]
    print("残っている絵文字: %d種 / %d箇所（うち画面に出る %d箇所）"
          % (len(by_char), len(rows), len(visible)))
    print("置き場所の内訳:", "  ".join("%s=%d" % kv for kv in by_kind.most_common()))
    if "--check" in sys.argv:
        return 1 if visible else 0

    print("\n%-4s %-5s %s" % ("絵", "計", "置き場所の内訳"))
    for ch, kinds in sorted(by_char.items(), key=lambda kv: -sum(kv[1].values())):
        try:
            name = unicodedata.name(ch)
        except ValueError:
            name = "?"
        print("%-4s %-5d %-42s U+%04X %s"
              % (ch, sum(kinds.values()),
                 " ".join("%s:%d" % kv for kv in kinds.most_common()), ord(ch), name))

    if "--lines" in sys.argv:
        print("\n--- 行ごと ---")
        for ch, kind, i, t in rows:
            if kind in ("コメント", "旧データ"):
                continue
            print("%5d [%-9s] %s %s" % (i, kind, ch, t[:100]))
    return 0


if __name__ == "__main__":
    sys.exit(main())

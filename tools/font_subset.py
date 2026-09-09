#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""index.html に埋め込む書体（PixelMplus12）のサブセットを作り直す。

なぜ要るのか
    本作は「外部リソースゼロ・単一HTML」が設計上の不変条件なので、書体も外部から
    読まずに index.html の @font-face に base64 で直接埋め込んでいる。
    日本語フルセットは 1.2MB あって埋め込めないため、
    ★ index.html の中で実際に使われている文字だけ ★ を抜き出して埋め込む。

    したがって「新しい文言を足した」ときは、その文字が既存のサブセットに
    含まれていない可能性がある。含まれていない文字は OS のフォントに落ちて
    そこだけ別書体になる（＝デザイン規約 D-4/(2) 違反）。
    文言を増やしたら、このスクリプトを走らせて埋め込みを作り直すこと。

使い方
    python3 tools/font_subset.py            # index.html を上書き更新
    python3 tools/font_subset.py --check    # 収録漏れの有無だけ調べる（書き換えない）

必要なもの
    fontTools（pip install fonttools）。元フォントが手元に無ければ自動で取得する。

ライセンス
    PixelMplus12 Regular — Copyright (C) 2013 itouhiro / 2002-2013 M+ FONTS PROJECT
    M+ FONT LICENSE（改変・再配布・埋め込みいずれも自由）。
"""
import base64, io, os, re, sys, subprocess, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
CACHE = os.path.join(ROOT, ".cache")
TTF = os.path.join(CACHE, "PixelMplus12-Regular.ttf")
URL = "https://raw.githubusercontent.com/itouhiro/PixelMplus/master/PixelMplus12-Regular.ttf"

# 埋め込みの src 行。ここを丸ごと差し替える。
SRC_RE = re.compile(r"(src: url\(data:font/woff;base64,)[A-Za-z0-9+/=]+(\) format\('woff'\);)")


def safety_chars():
    """literal に無くても実行時に出うる文字。数千文字も増えないので保険で入れておく。"""
    cs = set()
    cs |= {chr(i) for i in range(0x20, 0x7F)}                 # ASCII 可視
    cs |= {chr(i) for i in range(0x3041, 0x3100)}             # ひらがな・カタカナ
    cs |= {chr(i) for i in range(0xFF10, 0xFF1A)}             # 全角数字
    cs |= {chr(i) for i in range(0xFF21, 0xFF3B)}
    cs |= {chr(i) for i in range(0xFF41, 0xFF5B)}
    cs |= set("　、。・ー～％＋－×÷＝【】「」『』（）［］／＜＞←→↑↓"
              "★☆●○◆◇■□▲▼△▽※〇：；！？―≡√∥")
    return cs


def used_chars(html):
    """index.html で使われている文字。埋め込み base64 自体は数え直さない（ASCII のみなので実害は無いが）。"""
    body = SRC_RE.sub(r"\1\2", html)
    return {c for c in set(body) if ord(c) >= 0x20}


def ensure_ttf():
    if os.path.exists(TTF):
        return
    os.makedirs(CACHE, exist_ok=True)
    sys.stderr.write("元フォントを取得: %s\n" % URL)
    subprocess.check_call(["curl", "-sSL", "--max-time", "120", "-o", TTF, URL])


def main():
    check_only = "--check" in sys.argv
    html = io.open(INDEX, encoding="utf-8").read()
    ensure_ttf()
    from fontTools.ttLib import TTFont

    cmap = set(TTFont(TTF).getBestCmap().keys())
    used = used_chars(html)
    want = sorted((used | safety_chars()) & {chr(c) for c in cmap})
    missing = sorted(c for c in used if ord(c) not in cmap)

    # 絵文字は書体の担当外（デザイン規約 D-4/(1) のとおり SVG に置き換えていく対象）。
    def is_emoji(c):
        o = ord(c)
        return o >= 0x1F000 or 0x2600 <= o <= 0x27BF or o in (0xFE0F, 0x23F1, 0x23F3, 0x23F8)

    sym = [c for c in missing if not is_emoji(c)]
    print("使用文字 %d / 収録 %d / 未収録 %d（うち絵文字でない記号 %d）"
          % (len(used), len(want), len(missing), len(sym)))
    if sym:
        print("★ 書体に無い記号（別書体に落ちる。フォント内の等価な文字へ置き換えるか、SVG にすること）:")
        for c in sym:
            try:
                n = unicodedata.name(c)
            except ValueError:
                n = "?"
            print("   U+%04X %s %s" % (ord(c), c, n))
    if check_only:
        return 1 if sym else 0

    os.makedirs(CACHE, exist_ok=True)
    txt = os.path.join(CACHE, "subset_chars.txt")
    woff = os.path.join(CACHE, "pm12sub.woff")
    io.open(txt, "w", encoding="utf-8").write("".join(want))
    subprocess.check_call([
        sys.executable, "-m", "fontTools.subset", TTF,
        "--text-file=" + txt, "--output-file=" + woff, "--flavor=woff",
        "--layout-features=", "--no-hinting", "--name-IDs=", "--notdef-outline",
        "--drop-tables+=GSUB,GPOS,GDEF,DSIG,LTSH,hdmx,VDMX,kern,vmtx,vhea,gasp",
    ], stderr=subprocess.DEVNULL)

    b64 = base64.b64encode(open(woff, "rb").read()).decode("ascii")
    new, n = SRC_RE.subn(lambda m: m.group(1) + b64 + m.group(2), html)
    if n != 1:
        sys.exit("@font-face の src を %d 箇所しか見つけられなかった（1 のはず）" % n)
    io.open(INDEX, "w", encoding="utf-8").write(new)
    print("woff %d bytes → base64 %d bytes / index.html %d bytes"
          % (os.path.getsize(woff), len(b64), len(new.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())

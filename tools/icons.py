#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UI アイコン（ドット絵 SVG）の定義と、index.html への埋め込み。

デザイン規約 D-4/(1)：
  UI アイコンに絵文字を使わない。16×16 の 1px グリッドに完全に乗せた
  矩形の集合として描き、<symbol> + <use> で定義を1箇所にまとめる。

ここでは絵を「1文字＝1ドット」の16行×16列の文字絵として持つ。
矩形は横方向に連続した同色ドットをまとめて1つの <rect> にする（＝出力が小さくなる）。
色は :root の var(--i-*) を参照するので、CSS 側だけで色を変えられる。

使い方:
    python3 tools/icons.py            # index.html の ICONS:BEGIN〜END を書き換える
    python3 tools/icons.py --preview  # dev/icons.html（16倍拡大の確認ページ）も作る
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
PREVIEW = os.path.join(ROOT, "dev", "icons.html")

# 絵の具。k は輪郭（すべての要素に濃い輪郭線を入れる＝コミカルさの要）。
INK = "k"
PALETTE = {
    "k": "var(--i-ink)",
    "w": "var(--i-white)",    "W": "var(--i-white-d)",
    "s": "var(--i-steel)",    "S": "var(--i-steel-d)",
    "g": "var(--i-gold)",     "G": "var(--i-gold-d)",
    "r": "var(--i-red)",      "R": "var(--i-red-d)",
    "c": "var(--i-cyan)",     "C": "var(--i-cyan-d)",
    "t": "var(--i-stone)",    "T": "var(--i-stone-d)",
    "b": "var(--i-wood)",     "B": "var(--i-wood-d)",
    "v": "var(--i-violet)",   "V": "var(--i-violet-d)",
}

ICONS = {}

# ── ダイヤ（通貨）。上面の明部＋下半分の暗部で2階調。
ICONS["gem"] = ("ダイヤ", """
................
.......kk.......
......kcck......
.....kcccck.....
....kwccccck....
...kwwcccccck...
..kcccccccccck..
..kCCCCCCCCCCk..
...kCCCCCCCCk...
....kCCCCCCk....
.....kCCCCk.....
......kCCk......
.......kk.......
................
................
................
""")

# ── 剣（攻撃・プレイ）。刃は明部/暗部の2列、鍔と柄頭が金、握りが木。
ICONS["sword"] = ("剣", """
.......kk.......
......ksSk......
.....kssSSk.....
.....kssSSk.....
.....kssSSk.....
.....kssSSk.....
.....kssSSk.....
.....kssSSk.....
..kkkkkkkkkkkk..
..kggggggggggk..
..kkkkkbbkkkkk..
......kbbk......
......kbbk......
.....kkbbkk.....
.....kggggk.....
.....kkkkkk.....
""")

# ── 指令旗（集合地点）。竿＋なびく旗。
ICONS["flag"] = ("指令旗", """
..kkk...........
..kbkkkkkkkkkkk.
..kbkrrrrrrrrrk.
..kbkrrrrrrrrrk.
..kbkRRRRRRRk...
..kbkRRRRRk.....
..kbkRRRk.......
..kbkk..........
..kbk...........
..kbk...........
..kbk...........
..kbk...........
..kbk...........
.kkbkk..........
.kbbbk..........
.kkkkk..........
""")

# ── 撤退（白旗）。指令旗と同じ形・色だけ違う＝2つで1組に見えるようにしてある。
ICONS["retreat"] = ("撤退", """
..kkk...........
..kbkkkkkkkkkkk.
..kbkwwwwwwwwwk.
..kbkwwwwwwwwwk.
..kbkWWWWWWWk...
..kbkWWWWWk.....
..kbkWWWk.......
..kbkk..........
..kbk...........
..kbk...........
..kbk...........
..kbk...........
..kbk...........
.kkbkk..........
.kbbbk..........
.kkkkk..........
""")

# ── 錬成（強化パネル）。フラスコ。
ICONS["flask"] = ("錬成", """
................
.....kkkkkk.....
.....kwwwwk.....
......kwwk......
......kwwk......
......kwwk......
.....kwwwwk.....
....kwwwwwwk....
...kwwvvvvwwk...
..kwwvvvvvvwwk..
..kwvvvvvvvvwk..
..kwvvvvvvvvwk..
..kwVVVVVVVVwk..
...kwVVVVVVwk...
....kkkkkkkk....
................
""")

# ── 盾（防御）。
ICONS["shield"] = ("盾", """
................
..kkkkkkkkkkkk..
..kssssggssssk..
..kssssggssssk..
..kSsssggsssSk..
..kSsssggsssSk..
..kSsssggsssSk..
...kSssggssSk...
...kSssggssSk...
....kSsggsSk....
.....kSggSk.....
......kggk......
.......kk.......
................
................
................
""")

# ── 銀行（引継ぎ銀行）。切妻屋根＋柱。
ICONS["bank"] = ("銀行", """
................
.......kk.......
.....kkggkk.....
...kkggggggkk...
..kggggggggggk..
..kkkkkkkkkkkk..
..kttttttttttk..
..kTttTttTttTk..
..kTttTttTttTk..
..kTttTttTttTk..
..kTttTttTttTk..
..kTttTttTttTk..
..kttttttttttk..
..kTTTTTTTTTTk..
..kkkkkkkkkkkk..
................
""")

# ── 実績（宝具庫・トロフィー）。
ICONS["trophy"] = ("実績", """
................
..kkkkkkkkkkkk..
..kggggggggggk..
.kkkGGGGGGGGkkk.
.kGkGGGGGGGGkGk.
.kGkGGGGGGGGkGk.
.kkkGGGGGGGGkkk.
...kGGGGGGGGk...
....kGGGGGGk....
.....kGGGGk.....
......kGGk......
......kGGk......
.....kkGGkk.....
...kggggggggk...
...kkkkkkkkkk...
................
""")

# ── 岩（素材・石スライム）。
ICONS["rock"] = ("岩", """
................
................
.....kkkkkk.....
....kttttttk....
...kttttttttk...
..kttttttTTttk..
..kttttTTTTttk..
.kttttTTTTttttk.
.kttTTtTTTTtttk.
.kttTTtTTTTTttk.
.kTTTTTTTTTTTTk.
.kTTTTTTTTTTTTk.
..kTTTTTTTTTTk..
..kkkkkkkkkkkk..
................
................
""")

# ── 譲渡（書き出し）。箱＋上向きの矢。
ICONS["export"] = ("譲渡", """
.......kk.......
......kwwk......
.....kwwwwk.....
....kwwwwwwk....
...kwwwwwwwwk...
...kkkkwwkkkk...
......kwwk......
......kwwk......
................
..kkkkkkkkkkkk..
..kbbbbbbbbbbk..
..kbBBBBBBBBbk..
..kbBBBBBBBBbk..
..kbbbbbbbbbbk..
..kkkkkkkkkkkk..
................
""")


def grid(art, palette=None):
    """文字絵を行の配列にし、正方形であることと色記号が定義済みであることを検査する。
    大きさは行数から決める（UI アイコンは16、盤面のタイルは15、ちびは10 など）。"""
    palette = palette or PALETTE
    rows = [r for r in art.strip("\n").split("\n")]
    n = len(rows)
    for i, r in enumerate(rows):
        assert len(r) == n, "%d行目が%d文字でない: %d (%r)" % (i, n, len(r), r)
        for ch in r:
            assert ch == "." or ch in palette, "未定義の色記号 %r" % ch
    return rows


def check_centered(name, rows):
    """絵が箱の中心に載っているかを検査する。
    光の向きで左右非対称になるのは構わないが、塗りの外接矩形の中心は
    箱の中心（16/2 = 8.0）に一致していないといけない。ずれていると
    文字と並べたときだけ傾いて見え、原因が分かりにくいので機械で見る。"""
    xs = [x for r in rows for x, c in enumerate(r) if c != "."]
    ys = [y for y, r in enumerate(rows) if r.strip(".")]
    cx = (min(xs) + max(xs) + 1) / 2
    assert cx == len(rows) / 2, "%s: 左右の中心が %.1f（%.1f のはず）" % (name, cx, len(rows) / 2)
    return cx, (min(ys) + max(ys) + 1) / 2


def paths(rows, palette=None):
    """横に連続した同色ドットを1本の矩形サブパスにし、色ごとに1つの <path> へまとめる。
    <rect> を1つずつ並べるより出力が 1/4 以下になる（見た目は同じ・1px グリッドのまま）。"""
    palette = palette or PALETTE
    n = len(rows)
    runs = {}
    for y, row in enumerate(rows):
        x = 0
        while x < n:
            ch = row[x]
            if ch == ".":
                x += 1
                continue
            w = 1
            while x + w < n and row[x + w] == ch:
                w += 1
            runs.setdefault(ch, []).append("M%d %dh%dv1h-%dz" % (x, y, w, w))
            x += w
    # 輪郭を最初に置く（重なっても輪郭が消えないように、以降の色が上に乗る）
    order = sorted(runs, key=lambda c: (c != INK, c))
    return ['<path fill="%s" d="%s"/>' % (palette[ch], "".join(runs[ch])) for ch in order]


def sprite():
    parts = []
    for key, (label, art) in ICONS.items():
        rows = grid(art)
        check_centered(key, rows)
        rs = paths(rows)
        parts.append('  <symbol id="i-%s" viewBox="0 0 16 16"><title>%s</title>%s</symbol>'
                     % (key, label, "".join(rs)))
    return ('<svg id="icoSprite" aria-hidden="true" focusable="false"\n'
            '     width="0" height="0" style="position:absolute"\n'
            '     shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">\n'
            + "\n".join(parts) + "\n</svg>")


BEGIN = "<!-- ICONS:BEGIN tools/icons.py が生成。手で編集しない -->"
END = "<!-- ICONS:END -->"


def write_index():
    s = io.open(INDEX, encoding="utf-8").read()
    block = BEGIN + "\n" + sprite() + "\n" + END
    if BEGIN in s:
        s = re.sub(re.escape(BEGIN) + r"[\s\S]*?" + re.escape(END), lambda m: block, s, count=1)
    else:
        s = s.replace("<body>\n", "<body>\n\n    " + block.replace("\n", "\n    ") + "\n", 1)
    io.open(INDEX, "w", encoding="utf-8").write(s)
    print("index.html にスプライトを書き込んだ（%d 種・%d bytes）" % (len(ICONS), len(block)))


def write_preview():
    src = io.open(INDEX, encoding="utf-8").read()
    tokens = re.search(r"/\* ===== アイコンの絵の具[\s\S]*?\*/\s*", src)
    root = re.search(r":root \{[\s\S]*?\}", src).group(0)
    face = re.search(r"@font-face \{[\s\S]*?\}", src).group(0)
    cells = "\n".join(
        '<figure><svg class="big" viewBox="0 0 16 16" shape-rendering="crispEdges">'
        '<use href="#i-%s"/></svg><figcaption>%s<br><small>#i-%s</small></figcaption></figure>'
        % (k, v[0], k) for k, v in ICONS.items())
    inline = "\n".join(
        '<span class="row"><svg class="ico"><use href="#i-%s"/></svg>%s のテキストと並べたとき</span>'
        % (k, v[0]) for k, v in ICONS.items())
    html = """<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>アイコン確認</title><style>
%s
%s
body{background:var(--c-bg);color:var(--c-text);font-family:var(--font-ui);margin:0;padding:24px}
h1{font-size:24px;margin:0 0 24px}
h2{font-size:12px;color:var(--c-text-sub);margin:32px 0 12px;letter-spacing:2px}
.sheet{display:flex;flex-wrap:wrap;gap:24px}
figure{margin:0;text-align:center}
.big{width:256px;height:256px;image-rendering:pixelated;background:var(--c-bg-game);
     border:1px solid var(--c-frame-faint)}
figcaption{font-size:12px;margin-top:8px;color:var(--c-text-sub)}
.ico{width:16px;height:16px;vertical-align:-3px;margin-right:8px}
.row{display:block;font-size:12px;margin:8px 0}
.onlight{background:var(--c-text);padding:8px;display:inline-block}
</style></head><body>
%s
<h1>UI アイコン（16×16 ドット絵）</h1>
<h2>― 16倍に拡大 ―</h2>
<div class="sheet">%s</div>
<h2>― 実寸（16px）で文字と並べたところ ―</h2>
%s
<h2>― 実寸を明るい地の上に置いたところ（輪郭の効きを見る） ―</h2>
<div class="onlight">%s</div>
</body></html>""" % (
        face, root,
        re.search(r'<svg id="icoSprite"[\s\S]*?</svg>', src).group(0),
        cells, inline,
        "".join('<svg class="ico"><use href="#i-%s"/></svg>' % k for k in ICONS))
    os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
    io.open(PREVIEW, "w", encoding="utf-8").write(html)
    print("確認ページ: dev/icons.html")


if __name__ == "__main__":
    write_index()
    if "--preview" in sys.argv:
        write_preview()

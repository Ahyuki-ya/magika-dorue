#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""盤面（あくま部屋・モンスター・勇者）のドット絵。

これは **見本づくりの段階** のファイル。まだ index.html には入れていない。
canvas の描き替え（発注4）は、絵柄が決まってから別の作業として行う。

作りは tools/icons.py と同じ「1文字＝1ドット」の文字絵。
違うのは大きさが用途ごとに変わることだけ：
  ・あくま部屋 = 15×15（盤面のタイルが30pxなので2倍で丁度になる）
  ・モンスター/勇者の成体 = 16×16
  ・ちび = 10×10（成体を0.55倍に縮めるとドットが潰れるので別に描く）

ハイブリッド（異種交配）は「体つき(form)＋素材(coat)」の重ね描きなので、
ここでも体と素材を別のスプライトに分け、重ねて表示できることを確かめている。

使い方:
    python3 tools/sprites.py     # dev/board.html（確認ページ）を作る
"""
import io, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from icons import grid, paths, check_centered  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dev", "board.html")

# 盤面の絵の具。1体3〜4色＋輪郭という制約を守るため、
# 「地色(1)・暗部(2)・白目(w)・輪郭(k)」の4つしか使わない。
# 素材ごとの色は MONSTER_COLORS（index.html）と同じ役割・同じ見え方に揃えてある。
INK = "#0b0b16"
# 素材（coat）ごとの [呼び名, 地色, 暗部, アクセント]。
# ★ キーは素材の出どころのモンスター種（index.html の coatOf(mt) が返す値）と同じにする。
#   ハイブリッドは mtype = '体つき+素材' なので、ここを取り違えると絵が引けない。
MATS = {
    "slime":  ("石", "#95a5a6", "#6d7f80", "#c8d2d3"),
    "goblin": ("苔", "#3ddc84", "#1f8a52", "#b6f5cf"),
    "golem":  ("銅", "#d35400", "#8a3600", "#ffcc00"),
    "wraith": ("影", "#b39ddb", "#6a4f9c", "#e5d8ff"),
}
HERO = ("#4aa3e0", "#1f5c8a", "#ccd6ea", "#7d8cb0")   # 地色, 暗部, 兜, 兜の暗部


def pal(base, dark, ink=INK):
    return {"k": ink, "1": base, "2": dark, "w": "#f2f4ff", "s": HERO[2], "S": HERO[3],
            "R": "#c0392b", "V": "#2a1330", "g": "#ffcc00", "b": "#a06a34"}


# ───────────────────────────── あくま部屋（タイル・15×15＝30pxの1/2）
CASTLE = """
...............
.kk.........kk.
.kRk.......kRk.
.kkkkkkkkkkkkk.
.kRRRRRRRRRRRk.
.kRRRRRRRRRRRk.
.kRRkkkkkkkRRk.
.kRRkVVVVVkRRk.
.kRRkVgVgVkRRk.
.kRRkVVVVVkRRk.
.kRRkVVVVVkRRk.
.kRRkkkkkkkRRk.
.kRRRRRRRRRRRk.
.kkkkkkkkkkkkk.
...............
"""

# ───────────────────────────── 体つき（form）4種・成体 16×16
FORMS = {}
FORMS["slime"] = ("スライム", """
................
................
................
................
................
......kkkk......
....kk1111kk....
..kk11111111kk..
..k1www11www1k..
..k1wkw11wkw1k..
..k1www11www1k..
.k111111111111k.
.k122222222221k.
.k222222222222k.
.kkkkkkkkkkkkkk.
................
""")

FORMS["goblin"] = ("ゴブリン", """
................
................
..kk........kk..
..k1k......k1k..
..k11kkkkkk11k..
...k11111111k...
...k11111111k...
...k1ww11ww1k...
...k1wk11kw1k...
...k11111111k...
...k1kkkkkk1k...
...k11111111k...
..k1122222211k..
..k2222222222k..
..kkkkkkkkkkkk..
................
""")

FORMS["golem"] = ("ゴーレム", """
................
.kkkkkkkkkkkkkk.
.k111111111111k.
.k111111111111k.
.k1www1111www1k.
.k1wkw1111wkw1k.
.k1www1111www1k.
.k111111111111k.
.k112222222211k.
.k222222222222k.
.k222222222222k.
.k222222222222k.
.kkkkkkkkkkkkkk.
..kk........kk..
..k2k......k2k..
..kkk......kkk..
""")

FORMS["wraith"] = ("レイス", """
................
......kkkk......
....kk1111kk....
...k11111111k...
...k1ww11ww1k...
...k1wk11kw1k...
...k11111111k...
...k11111111k...
...k12222221k...
...k22222222k...
...k22222222k...
...k2kk22kk2k...
...k.kk..kk.k...
................
................
................
""")

# ───────────────────────────── ちび（10×10・成体とは別に描く）
CHIBI = {}
CHIBI["slime"] = ("ちびスライム", """
..........
...kkkk...
..k1111k..
.k111111k.
.k1w11w1k.
.k111111k.
.k122221k.
.k222222k.
.kkkkkkkk.
..........
""")

CHIBI["goblin"] = ("ちびゴブリン", """
..........
.kk....kk.
.k1k..k1k.
.k11kk11k.
.k1w11w1k.
.k111111k.
.k122221k.
.k222222k.
.kkkkkkkk.
..........
""")

CHIBI["wraith"] = ("ちびレイス", """
..........
..kkkkkk..
.k111111k.
.k1w11w1k.
.k111111k.
.k122221k.
.k222222k.
.k22kk22k.
.kk.kk.kk.
..........
""")

CHIBI["golem"] = ("ちびゴーレム", """
..........
.kkkkkkkk.
.k111111k.
.k1w11w1k.
.k111111k.
.k222222k.
.k222222k.
.kkkkkkkk.
..k2..2k..
..kk..kk..
""")

# ───────────────────────────── 勇者 16×16
HERO_ART = ("勇者", """
................
....kkkkkkkk....
...kssssssssk...
...kssssssssk...
...kkwwkkwwkk...
...kssssssssk...
...kkkkkkkkkk...
..k1111111111k..
.k111111111111k.
.k122222222221k.
.k122222222221k.
..k2222222222k..
..kkkk2222kkkk..
....k22kk22k....
....k22kk22k....
....kkkkkkkk....
""")


def svg(art, palette, cls="", size=None):
    rows = grid(art, palette)
    n = len(rows)
    return ('<svg class="%s" viewBox="0 0 %d %d" shape-rendering="crispEdges" '
            'xmlns="http://www.w3.org/2000/svg" width="%d" height="%d">%s</svg>'
            % (cls, n, n, size or n, size or n, "".join(paths(rows, palette))))


def figure(art, palette, label, note=""):
    n = len(grid(art, palette))
    return ('<figure><div class="cell">%s</div><figcaption>%s<br><small>%d×%d %s</small>'
            '</figcaption></figure>'
            % (svg(art, palette, "big", n * 12), label, n, n, note))


# ───────────────────────────── index.html への書き出し
BEGIN = "// ===== SPRITES:BEGIN tools/sprites.py が生成。手で編集しない ====="
END = "// ===== SPRITES:END ====="


def js_rows(art):
    rows = art.strip("\n").split("\n")
    return "[" + ",".join("'%s'" % r for r in rows) + "]"


def js_block():
    """盤面のドット絵を JS の文字絵として書き出す。
    canvas への焼き付け（paintSprite / buildEntityArt）は index.html 側の手書き。"""
    L = [BEGIN,
         "    // 体つき（form）。素材(coat)は色だけ差し替えるので、絵は4種で足りる。",
         "    const SPRITE_FORMS = {"]
    for k, (label, art) in FORMS.items():
        L.append("        %s: %s,   // %s" % (k, js_rows(art), label))
    L.append("    };")
    L.append("    // ちび。成体を0.55倍に縮めるとドットが潰れるので別に描いてある。")
    L.append("    const SPRITE_CHIBI = {")
    for k, (label, art) in CHIBI.items():
        L.append("        %s: %s,   // %s" % (k, js_rows(art), label))
    L.append("    };")
    L.append("    const SPRITE_HERO = %s;" % js_rows(HERO_ART[1]))
    L.append("    const SPRITE_CASTLE = %s;   // 15×15。盤面では2倍の30px で置く。" % js_rows(CASTLE))
    L.append("    // 素材(coat)ごとの [地色, 暗部]。MONSTER_COLORS と同じ役割・同じ見え方に揃えてある。")
    L.append("    const SPRITE_MATS = {")
    for k, v in MATS.items():
        L.append("        %s: ['%s', '%s'],   // %s" % (k, v[1], v[2], v[0]))
    L.append("    };")
    L.append("    const SPRITE_HERO_COLORS = { calm: ['%s', '%s'], rage: ['#e0483c', '#99241c'] };" % (HERO[0], HERO[1]))
    L.append("    const SPRITE_HELM = ['%s', '%s'];" % (HERO[2], HERO[3]))
    L.append("    const SPRITE_CASTLE_COLORS = ['#c0392b', '#7b241c'];")
    L.append("    " + END)
    return "\n".join(L)


def write_index():
    import re
    idx = os.path.join(ROOT, "index.html")
    s = io.open(idx, encoding="utf-8").read()
    block = "    " + js_block()
    assert BEGIN in s, "index.html に SPRITES:BEGIN 〜 END の目印が無い"
    s = re.sub(re.escape(BEGIN) + r"[\s\S]*?" + re.escape(END), lambda m: js_block(), s, count=1)
    io.open(idx, "w", encoding="utf-8").write(s)
    print("index.html にドット絵データを書き込んだ")


def main():
    # 素材ごとの体（＝ハイブリッドの見え方）。体つきは同じで色だけ差し替える。
    forms = "".join(figure(a, pal(MATS["slime"][1], MATS["slime"][2]), l)
                    for l, a in FORMS.values())
    mats = "".join(
        figure(FORMS["goblin"][1], pal(v[1], v[2]), "%sゴブリン" % v[0])
        for v in MATS.values())
    chibi = "".join(figure(a, pal(MATS["slime"][1], MATS["slime"][2]), l)
                    for l, a in CHIBI.values())
    castle = figure(CASTLE, pal("#c0392b", "#7b241c"), "あくま部屋", "→ 盤面では2倍の30px")
    hero = (figure(HERO_ART[1], pal(HERO[0], HERO[1]), "勇者")
            + figure(HERO_ART[1], pal("#e0483c", "#99241c"), "勇者（怒り）"))

    # 実寸を盤面のタイルの上に置いたところ（30pxタイル・実際のタイル色）
    def on_tile(bg, items):
        return ('<div class="tiles">' + "".join(
            '<span class="tile" style="background:%s">%s</span>' % (bg, s) for s in items)
            + "</div>")
    real_forms = [svg(a, pal(MATS["slime"][1], MATS["slime"][2]), "px", 16) for l, a in FORMS.values()]
    real_chibi = [svg(a, pal(MATS["slime"][1], MATS["slime"][2]), "px", 10) for l, a in CHIBI.values()]
    real_hero = [svg(HERO_ART[1], pal(HERO[0], HERO[1]), "px", 16),
                 svg(HERO_ART[1], pal("#e0483c", "#99241c"), "px", 16)]
    real_castle = [svg(CASTLE, pal("#c0392b", "#7b241c"), "px", 30)]

    html = """<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>盤面ドット絵の見本</title><style>
body{background:#000018;color:#f0f0f0;font-family:monospace;margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}
p.lead{color:#8899cc;font-size:12px;margin:0 0 24px;line-height:1.7}
h2{font-size:12px;color:#8899cc;margin:32px 0 12px;letter-spacing:2px}
.sheet{display:flex;flex-wrap:wrap;gap:20px}
figure{margin:0;text-align:center}
.cell{background:#000010;border:1px solid #1a2a60;padding:4px;line-height:0}
.big{image-rendering:pixelated}
figcaption{font-size:12px;margin-top:6px;color:#8899cc}
small{color:#6688aa}
.tiles{display:flex;gap:0;flex-wrap:wrap}
.tile{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.18),inset 0 -1px 0 rgba(0,0,0,0.28)}
.px{image-rendering:pixelated}
</style></head><body>
<h1>盤面のドット絵 — 見本</h1>
<p class="lead">まだ index.html には入れていない。絵柄を決めるための試作。<br>
体つき（form）と素材（coat）を分けたまま色だけ差し替える構造にしてあるので、
異種交配の4形×4素材＝16通りはこのまま展開できる。</p>

<h2>― あくま部屋 ―</h2><div class="sheet">%s</div>
<h2>― 体つき4種（成体・16×16） ―</h2><div class="sheet">%s</div>
<h2>― 素材ちがい（体つきは同じ・色だけ差し替え） ―</h2><div class="sheet">%s</div>
<h2>― ちび（0.55倍ではなく別に描く・10×10） ―</h2><div class="sheet">%s</div>
<h2>― 勇者 ―</h2><div class="sheet">%s</div>

<h2>― 実寸：30pxのタイルに置いたところ ―</h2>
<p class="lead">石タイル(#95a5a6) / 苔石(#7b8d41) / 銅鉱石(#9A6229) の上。<br>
今の描画は直径10px前後なので、16pxにすると一回り大きくなる。ここの大小は好みで決められる。</p>
%s%s%s
<h2>― あくま部屋を実寸(30px)で ―</h2>%s
</body></html>""" % (
        castle, forms, mats, chibi, hero,
        on_tile("#95a5a6", real_forms), on_tile("#7b8d41", real_chibi + real_hero),
        on_tile("#9A6229", real_forms[:2] + real_hero[1:]),
        on_tile("#795548", real_castle))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(html)
    print("確認ページ: dev/board.html")


if __name__ == "__main__":
    main()
    if "--index" in sys.argv:
        write_index()

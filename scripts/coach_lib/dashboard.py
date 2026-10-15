"""学習 dashboard (自己完結 HTML)。"""
from __future__ import annotations

import html
from pathlib import Path

from . import model
from . import state as state_mod

CSS = """
:root{--bg:#f7f5ef;--ink:#1f2a37;--muted:#6b7280;--card:#fff;--line:#e5e1d8;--m0:#e8e5de;--m1:#f6c98b;--m2:#8fcf9f;--m3:#2f9e63;--accent:#2b5c8a;--target:#b45309}
@media (prefers-color-scheme: dark){:root{--bg:#141820;--ink:#e8eaf0;--muted:#9aa3b2;--card:#1d2330;--line:#2c3442;--m0:#2c3442}}
body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,"Hiragino Sans",sans-serif;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.tile b{display:block;font-size:24px}.tile span{font-size:12px;color:var(--muted)}
.unit{margin:10px 0}.unit .name{font-size:13px;margin-bottom:4px}.grid{display:flex;flex-wrap:wrap;gap:4px}
.cell{width:110px;font-size:11px;padding:6px;border-radius:6px;background:var(--m0)}
.r1{background:var(--m1)}.r2{background:var(--m2)}.r3{background:var(--m3);color:#fff}
.chart{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto}
.titles span{display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;border:1px solid var(--line);border-radius:999px;font-size:12px}
"""


def polyline_points(values, width, height) -> str:
    if not values:
        return ""
    if len(values) == 1:
        return f"0,{round(height - values[0] * height):g}"
    step = width / (len(values) - 1)
    return " ".join(f"{round(i * step):g},{round(height - v * height):g}" for i, v in enumerate(values))


def _rank_class(m: float) -> str:
    return {"未着手": "", "見習い": "r1", "一人前": "r2", "師範": "r3"}[model.rank(m)]


def render_dashboard(report, st, subject) -> str:
    e = html.escape
    hist = st["history"]
    actual = [h["pass_prob"] for h in hist]
    target = [state_mod.target_prob_today(st, h["date"]) for h in hist]
    w, h = max(300, 40 * len(actual)), 120
    chart = (f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="合格確率の推移">'
             f'<polyline fill="none" stroke="var(--target)" stroke-width="2" stroke-dasharray="6 4" points="{polyline_points(target, w, h)}"/>'
             f'<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="{polyline_points(actual, w, h)}"/></svg>'
             f'<div style="font-size:12px;color:var(--muted)">実線 = 実績 / 点線 = 目標  {e(hist[0]["date"])} → {e(hist[-1]["date"])}</div>')
    tiles = [(f"{report['pass_prob'] * 100:.0f}%", f"合格確率 (目標 {report['target_pass_prob'] * 100:.0f}%)"),
             (f"{report['expected_score']:g}", f"期待得点 / {report['passing_line']}"),
             (str(report["days_to_exam"]), "本番まで (日)"), (f"Lv.{report['level']}", f"XP {report['xp']}"),
             (str(report["streak_days"]), "連続学習日数"), (str(report["fading_count"]), "消えかけ論点")]
    tiles_html = "".join(f'<div class="tile"><b>{e(v)}</b><span>{e(k)}</span></div>' for v, k in tiles)
    ms = report["next_milestone"]
    boss = f'次のボス: {e(ms["name"])} (期限 {e(ms["target_date"])}, 現在 {ms["mastery"] * 100:.0f}%)' if ms else "次のボス: 全単元撃破"
    units_html = []
    for u in subject["units"]:
        cells = []
        for t in subject["topics"]:
            if t["unit"] != u["id"]:
                continue
            m = state_mod.topic_mastery(st, subject, t["id"])
            cells.append(f'<div class="cell {_rank_class(m)}" title="{e(t["id"])}">{e(t["name"])}<br>{m * 100:.0f}% / 配点 {float(t["weight"]):g}</div>')
        ru = next(x for x in report["units"] if x["id"] == u["id"])
        units_html.append(f'<div class="unit"><div class="name">{e(u["name"])} {ru["mastery"] * 100:.0f}%{" (撃破)" if ru["boss_cleared"] else ""}</div><div class="grid">{"".join(cells)}</div></div>')
    titles = "".join(f"<span>{e(t)}</span>" for t in report["titles"]) or '<span style="color:var(--muted)">まだなし</span>'
    weakest = "".join(f'<li>[{e(x["rank"])}] {e(x["name"])} (配点 {x["weight"]:g}, 習得 {x["mastery"] * 100:.0f}%)</li>' for x in report["weakest"])
    return f"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(subject["name"])} 学習ダッシュボード</title><style>{CSS}</style></head>
<body>
<h1>{e(subject["name"])} 学習ダッシュボード</h1>
<div style="color:var(--muted);font-size:13px">{e(report["date"])} 時点 / 本番 {e(report["exam_date"])} / {boss}</div>
<h2>今の状態</h2><div class="tiles">{tiles_html}</div>
<h2>合格確率の推移</h2><div class="chart">{chart}</div>
<h2>論点ヒートマップ (色 = ランク: 未着手 / 見習い / 一人前 / 師範)</h2>{"".join(units_html)}
<h2>伸びしろ上位</h2><ol>{weakest}</ol>
<h2>称号</h2><div class="titles">{titles}</div>
</body></html>
"""


def write_dashboard(report, st, subject) -> Path:
    d = state_mod.state_dir(st["subject"])
    d.mkdir(parents=True, exist_ok=True)
    path = d / "dashboard.html"
    path.write_text(render_dashboard(report, st, subject), encoding="utf-8")
    return path

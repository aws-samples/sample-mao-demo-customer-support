#!/usr/bin/env python3
"""Layout sanity check for the generated draw.io diagram: flags node overlaps,
out-of-group nodes, edge lines crossing unrelated nodes, and edge labels landing
on nodes. Approximate (routing is estimated from source/target + waypoints)."""
import re, sys, base64, zlib, urllib.parse

path = sys.argv[1] if len(sys.argv) > 1 else "docs/jo-AgentCoreMAC.xml"
raw = open(path, encoding="utf-8").read()
p = re.search(r"<diagram[^>]*>(.*?)</diagram>", raw, re.S).group(1).strip()
model = urllib.parse.unquote(zlib.decompress(base64.b64decode(p), -15).decode())

V = {}
for mm in re.finditer(r'<mxCell id="([^"]+)" value="([^"]*)"[^>]*vertex="1"[^>]*>\s*<mxGeometry x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"', model):
    i = mm.group(1); x, y, w, h = map(int, mm.groups()[2:]); V[i] = (x, y, w, h)
groups = {"gFront", "gApi", "gCore", "gTools", "runtimeBox"}

def center(i): x, y, w, h = V[i]; return (x + w / 2, y + h / 2)
def anchor(i, ex, ey): x, y, w, h = V[i]; return (x + w * ex, y + h * ey)

edges = []
for mm in re.finditer(r'<mxCell id="(e[^"]*)" value="([^"]*)" style="([^"]*)" edge="1" parent="1" source="([^"]+)" target="([^"]+)">(.*?)</mxCell>', model, re.S):
    eid, lbl, style, src, tgt, body = mm.groups()
    pts = [(int(a), int(b)) for a, b in re.findall(r'<mxPoint x="(-?\d+)" y="(-?\d+)"/>', body)]
    def g(k):
        r = re.search(k + r"=([0-9.]+);", style); return float(r.group(1)) if r else None
    ex, ey, nx, ny = g("exitX"), g("exitY"), g("entryX"), g("entryY")
    sp = anchor(src, ex, ey) if ex is not None else center(src)
    tp = anchor(tgt, nx, ny) if nx is not None else center(tgt)
    edges.append((eid, lbl, src, tgt, [sp] + pts + [tp]))

def mid(path):
    seg = []; tot = 0
    for a, b in zip(path, path[1:]):
        d = ((a[0]-b[0])**2 + (a[1]-b[1])**2) ** .5; seg.append(d); tot += d
    h = tot / 2
    for (a, b), d in zip(zip(path, path[1:]), seg):
        if h <= d:
            t = h / d if d else 0; return (a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)
        h -= d
    return path[-1]

def lbbox(lbl, cx, cy):
    if not lbl: return None
    L = lbl.split("\n"); w = max(len(x) for x in L)*5.4 + 6; hh = len(L)*12 + 4
    return (cx - w/2, cy - hh/2, w, hh)

def ov(a, b):
    ax, ay, aw, ah = a; bx, by, bw, bh = b
    return ax < bx+bw and bx < ax+aw and ay < by+bh and by < ay+ah

prob = 0
for eid, lbl, src, tgt, path in edges:
    b = lbbox(lbl, *mid(path))
    if not b: continue
    for i, r in V.items():
        if i in groups or i in (src, tgt): continue
        if ov(b, r): print("LABEL", repr(lbl), eid, "on", i); prob += 1

def seghits(a, bb):
    hits = set(); steps = 60
    for s in range(steps + 1):
        t = s/steps; px = a[0]+(bb[0]-a[0])*t; py = a[1]+(bb[1]-a[1])*t
        for i, (x, y, w, h) in V.items():
            if i in groups: continue
            if x+3 < px < x+w-3 and y+3 < py < y+h-3: hits.add(i)
    return hits

for eid, lbl, src, tgt, path in edges:
    hit = set()
    for a, bb in zip(path, path[1:]): hit |= seghits(a, bb)
    hit -= {src, tgt}
    if hit: print("LINE", eid, repr(lbl), "crosses", hit); prob += 1

gb = [V[g] for g in ("gFront", "gApi", "gCore", "gTools")]
def inside(c, g):
    cx, cy, cw, ch = c; gx, gy, gw, gh = g
    return cx >= gx-3 and cy >= gy-3 and cx+cw <= gx+gw+3 and cy+ch <= gy+gh+3
for i, r in V.items():
    if i in groups: continue
    if not any(inside(r, g) for g in gb): print("OUTSIDE group:", i); prob += 1

items = [(i, r) for i, r in V.items() if i not in groups]
for a in range(len(items)):
    for b in range(a + 1, len(items)):
        if ov(items[a][1], items[b][1]): print("NODE OVERLAP", items[a][0], items[b][0]); prob += 1

print("vertices:", len(V), "edges:", len(edges), "problems:", prob)

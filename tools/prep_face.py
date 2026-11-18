# -*- coding: utf-8 -*-
"""
prep_face.py —— 把一张卡通角色图处理成"可做表情"的底图 + 坐标文件

做三件事：
  1. 抠掉外部背景（从四边漫水填充，闭合的头罩轮廓不会被攻破）
  2. 按 marks.json 给的坐标，把原有的眼睛/鼻子/嘴/腮红擦掉
  3. 输出 character-base.png 和 face.json（像素坐标，供页面直接读）

用法：
  python tools/prep_face.py --src 角色图.png --marks marks.json --out out_dir/

marks.json 用 0~1 的归一化坐标（相对原图宽高），只有 x/y 是必需的：
{
  "name": "小熊",
  "ink": "#2A2622",                          // 可省略，省略时从眼睛处自动取
  "eyeL": {"x": 0.344, "y": 0.545, "r": 0.028},
  "eyeR": {"x": 0.527, "y": 0.545, "r": 0.028},
  "nose": {"x": 0.435, "y": 0.606, "rx": 0.021, "ry": 0.017},
  "mouth": {"x": 0.436, "y": 0.638, "w": 0.106},
  "brow":  {"y": 0.500},
  "blushL": {"x": 0.264, "y": 0.620, "rx": 0.066, "ry": 0.053},
  "blushR": {"x": 0.606, "y": 0.619, "rx": 0.066, "ry": 0.053},
  "pivot": {"x": 0.435, "y": 0.790}
}
"""

import argparse
import json
import os
from collections import deque

from PIL import Image, ImageDraw, ImageFilter

MAX_SIDE = 900        # 缩放后的最长边；太大的图既慢又没必要
BG_TOL = 26           # 判定"是背景"的颜色容差（欧氏距离）
PAD = 14              # 裁切时四周留白


def color_dist(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def detect_bg_color(im):
    """取四边像素的中位数当背景色。比取四角更抗角落噪点。"""
    W, H = im.size
    px = im.load()
    pts = []
    step = max(1, W // 120)
    for x in range(0, W, step):
        pts.append(px[x, 0][:3])
        pts.append(px[x, H - 1][:3])
    for y in range(0, H, step):
        pts.append(px[0, y][:3])
        pts.append(px[W - 1, y][:3])
    pts.sort(key=lambda c: sum(c))
    return pts[len(pts) // 2]


def flood_remove_bg(im, tol=BG_TOL):
    """从四条边做漫水填充，把连到边上的背景变透明。
    只从边缘出发，所以被封在轮廓里的白色（比如脸上的白）不会被吃掉——
    这是之前做这只熊时踩过的坑：先擦五官再抠图会把轮廓打通。"""
    im = im.convert("RGBA")
    W, H = im.size
    px = im.load()
    bg = detect_bg_color(im.convert("RGB"))

    seen = bytearray(W * H)
    q = deque()

    def push(x, y):
        i = y * W + x
        if seen[i]:
            return
        if color_dist(px[x, y][:3], bg) > tol:
            return
        seen[i] = 1
        q.append((x, y))

    for x in range(W):
        push(x, 0)
        push(x, H - 1)
    for y in range(H):
        push(0, y)
        push(W - 1, y)

    while q:
        x, y = q.popleft()
        px[x, y] = (px[x, y][0], px[x, y][1], px[x, y][2], 0)
        if x > 0:
            push(x - 1, y)
        if x < W - 1:
            push(x + 1, y)
        if y > 0:
            push(x, y - 1)
        if y < H - 1:
            push(x, y + 1)

    return im, bg


def has_alpha(im):
    """已经是透明底的图不用再抠。"""
    if im.mode != "RGBA":
        return False
    a = im.split()[3]
    lo, hi = a.getextrema()
    return lo < 40


def find_blobs(im, test, box, min_area=25):
    """在 box 范围内找连通色块，返回 [(质心x, 质心y, 面积)]。
    必须按连通块分开算：鼻子和嘴都是深色、只隔三十几像素，
    混在一起求质心会把鼻子拽到嘴上去。"""
    W, H = im.size
    px = im.load()
    x0, y0, x1, y1 = [int(v) for v in box]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(W, x1), min(H, y1)
    seen = set()
    blobs = []
    for sy in range(y0, y1):
        for sx in range(x0, x1):
            if (sx, sy) in seen:
                continue
            p = px[sx, sy]
            if p[3] < 60 or not test(p):
                continue
            q = deque([(sx, sy)])
            seen.add((sx, sy))
            acc_x = acc_y = n = 0
            while q:
                cx, cy = q.popleft()
                acc_x += cx
                acc_y += cy
                n += 1
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if x0 <= nx < x1 and y0 <= ny < y1 and (nx, ny) not in seen:
                        pp = px[nx, ny]
                        if pp[3] >= 60 and test(pp):
                            seen.add((nx, ny))
                            q.append((nx, ny))
            if n >= min_area:
                blobs.append((acc_x / n, acc_y / n, n))
    return blobs


def is_dark(p, thr=112):
    return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] < thr


def is_pink(p):
    return p[0] - p[1] > 14 and p[0] > 170 and p[1] - p[2] < 32


def refine(im, x, y, rad, kind):
    """视觉模型给的是"大概在这附近"，这里往最近的连通色块质心上贴。
    位移限制在 rad*1.3 内——贴着贴着跑掉，比不贴更糟。

    kind='none' 表示不吸附：鼻子的下沿和嘴的上沿在多数卡通脸上是贴着的，
    两团深色连成一块，吸附反而会把它拽到两者中间。鼻子留给人工微调。"""
    if kind == 'none':
        return x, y, False
    test = is_pink if kind == 'pink' else is_dark
    blobs = find_blobs(im, test, (x - rad, y - rad, x + rad, y + rad))
    if not blobs:
        return x, y, False
    cx, cy, _ = min(blobs, key=lambda b: (b[0] - x) ** 2 + (b[1] - y) ** 2)
    if abs(cx - x) > rad * 1.3 or abs(cy - y) > rad * 1.3:
        return x, y, False
    return cx, cy, True


def sample_ring(px, box, pad, W, H):
    """取 box 外扩 pad 那一圈像素的中位数颜色，作为擦除时的填充色。
    卡通角色脸部基本是平色，中位数足够；取外圈是为了避开五官本身的深色。"""
    x0, y0, x1, y1 = [int(v) for v in box]
    pts = []
    for x in range(max(0, x0 - pad), min(W, x1 + pad)):
        for y in (y0 - pad, y1 + pad - 1):
            if 0 <= y < H:
                pts.append(px[x, y][:3])
    for y in range(max(0, y0 - pad), min(H, y1 + pad)):
        for x in (x0 - pad, x1 + pad - 1):
            if 0 <= x < W:
                pts.append(px[x, y][:3])
    if not pts:
        return (250, 250, 250)
    pts.sort(key=lambda c: sum(c))
    return pts[len(pts) // 2]


def erase_region(im, box, pad=6, feather=4):
    """用外圈中位数色盖掉一块区域，边缘做羽化，避免留下硬边。
    返回 (被擦像素数, 填充色)，填充色留给后续清残留用。"""
    W, H = im.size
    px = im.load()
    x0, y0, x1, y1 = [int(v) for v in box]
    if x1 <= x0 or y1 <= y0:
        return 0, (255, 255, 255)
    fill = sample_ring(px, (x0, y0, x1, y1), pad, W, H)

    patch = Image.new("RGB", (W, H), fill)
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rectangle((x0, y0, x1, y1), fill=255)
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))

    before = im.copy()
    im.paste(patch, (0, 0), mask)
    # 只统计这块区域里"原来明显不是填充色"的像素
    pb = before.load()
    n = 0
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            if color_dist(pb[x, y][:3], fill) > 30:
                n += 1
    return n, fill


def clean_pink(im, box, fill, thr_rg=8, thr_r=188, thr_gb=28):
    """腮红是柔边半透明的，方形擦除盖不住扩散出去的那一圈淡粉。
    按颜色再扫一遍：偏红、够亮、且蓝通道接近绿通道的像素，换成脸盘色。
    "蓝接近绿"这一条是关键——粉色是 (250,200,200)，棕色头罩是 (196,158,120)，
    两者的 g-b 差着三四十，不区分就会把棕色头罩整片刷白。"""
    W, H = im.size
    px = im.load()
    x0, y0, x1, y1 = [int(v) for v in box]
    n = 0
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            p = px[x, y]
            r, g, b = p[0], p[1], p[2]
            if p[3] > 60 and r - g > thr_rg and r > thr_r and g - b < thr_gb:
                px[x, y] = (fill[0], fill[1], fill[2], p[3])
                n += 1
    return n


def pick_ink(im, eye_box):
    """从眼睛那块挑最暗的 10% 像素的中位数，当线条颜色。"""
    px = im.load()
    W, H = im.size
    x0, y0, x1, y1 = [int(v) for v in eye_box]
    pts = []
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            p = px[x, y]
            if len(p) == 4 and p[3] < 128:
                continue
            pts.append(p[:3])
    if not pts:
        return "#2A2622"
    pts.sort(key=lambda c: sum(c))
    dark = pts[: max(1, len(pts) // 10)]
    r = sorted(p[0] for p in dark)[len(dark) // 2]
    g = sorted(p[1] for p in dark)[len(dark) // 2]
    b = sorted(p[2] for p in dark)[len(dark) // 2]
    return "#%02X%02X%02X" % (r, g, b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--marks", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--keep-size", action="store_true", help="不缩放、不裁切（调试用）")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    with open(args.marks, encoding="utf-8") as fh:
        marks = json.load(fh)

    im = Image.open(args.src)
    src_alpha = has_alpha(im)
    im = im.convert("RGBA")
    W0, H0 = im.size

    # 1) 缩放：太长的图先压到 900，BFS 和 DOM 都轻松
    if not args.keep_size:
        k = min(1.0, MAX_SIDE / max(W0, H0))
        if k < 1.0:
            im = im.resize((max(1, int(W0 * k)), max(1, int(H0 * k))), Image.LANCZOS)
    W1, H1 = im.size

    # 2) 抠背景
    if not src_alpha:
        im, bg = flood_remove_bg(im)
    else:
        bg = None

    # 3) 裁到内容范围，四周留 PAD
    if not args.keep_size:
        bbox = im.split()[3].getbbox()
        if bbox:
            x0 = max(0, bbox[0] - PAD)
            y0 = max(0, bbox[1] - PAD)
            x1 = min(W1, bbox[2] + PAD)
            y1 = min(H1, bbox[3] + PAD)
            im = im.crop((x0, y0, x1, y1))
            ox, oy = x0, y0
        else:
            ox = oy = 0
    else:
        ox = oy = 0
    W2, H2 = im.size

    # 4) 归一化坐标 → 当前图像的像素坐标
    def px_of(d):
        return (d["x"] * W1 - ox, d["y"] * H1 - oy)

    def sz_of(v):
        return v * W1

    eL = marks["eyeL"]
    eR = marks["eyeR"]
    rL = sz_of(eL.get("r", 0.026))
    rR = sz_of(eR.get("r", eL.get("r", 0.026)))

    nx, ny = px_of(marks["nose"])
    nrx = sz_of(marks["nose"].get("rx", 0.02))
    nry = sz_of(marks["nose"].get("ry", 0.016))

    mx, my = px_of(marks["mouth"])
    mw = sz_of(marks["mouth"].get("w", 0.1))

    bl = marks["blushL"]
    br = marks["blushR"]
    blx, bly = px_of(bl)
    brx, bry = px_of(br)
    blrx = sz_of(bl.get("rx", 0.06))
    blry = sz_of(bl.get("ry", 0.05))
    brrx = sz_of(br.get("rx", bl.get("rx", 0.06)))
    brry = sz_of(br.get("ry", bl.get("ry", 0.05)))

    eyeL = (eL["x"] * W1 - ox, eL["y"] * H1 - oy)
    eyeR = (eR["x"] * W1 - ox, eR["y"] * H1 - oy)

    # 4b) 吸附：把估计坐标往附近真正的色块质心上贴。
    # 眼睛/鼻/嘴是深色，腮红是粉色，分别用不同判据。
    # 这一步能把"偏了十几像素"救回来，省掉一大半手动微调。
    pts = {
        "eyeL": list(eyeL), "eyeR": list(eyeR),
        "nose": [nx, ny], "mouth": [mx, my],
        "blushL": [blx, bly], "blushR": [brx, bry],
    }
    rads = {
        "eyeL": rL * 2.2, "eyeR": rR * 2.2,
        "nose": max(nrx, nry) * 2.2, "mouth": mw * 0.45,
        "blushL": blrx * 1.15, "blushR": brrx * 1.15,
    }
    kinds = {
        "eyeL": "dark", "eyeR": "dark", "nose": "none",
        "mouth": "dark", "blushL": "pink", "blushR": "pink",
    }
    snapped = {}
    for k, (x, y) in pts.items():
        nx2, ny2, ok = refine(im, x, y, rads[k], kinds[k])
        pts[k] = [nx2, ny2]
        snapped[k] = ok
    eyeL = tuple(pts["eyeL"])
    eyeR = tuple(pts["eyeR"])
    nx, ny = pts["nose"]
    mx, my = pts["mouth"]
    blx, bly = pts["blushL"]
    brx, bry = pts["blushR"]

    # 5) 先量线条颜色（要在擦除之前，擦完就没得取了）
    ink = marks.get("ink") or pick_ink(
        im, (eyeL[0] - rL * 1.6, eyeL[1] - rL * 1.6, eyeL[0] + rL * 1.6, eyeL[1] + rL * 1.6)
    )

    # 6) 擦五官。每块都外扩一点，保证原来的线条和柔边被完全盖住。
    regions = {
        "eyeL": (eyeL[0] - rL * 1.65, eyeL[1] - rL * 1.65, eyeL[0] + rL * 1.65, eyeL[1] + rL * 1.65),
        "eyeR": (eyeR[0] - rR * 1.65, eyeR[1] - rR * 1.65, eyeR[0] + rR * 1.65, eyeR[1] + rR * 1.65),
        "nose": (nx - nrx * 1.9, ny - nry * 1.9, nx + nrx * 1.9, ny + nry * 1.9),
        "mouth": (mx - mw * 0.62, my - mw * 0.32, mx + mw * 0.62, my + mw * 0.72),
        "blushL": (blx - blrx * 1.35, bly - blry * 1.35, blx + blrx * 1.35, bly + blry * 1.35),
        "blushR": (brx - brrx * 1.35, bry - brry * 1.35, brx + brrx * 1.35, bry + brry * 1.35),
    }
    erased = {}
    for name, box in regions.items():
        pad = 10 if name.startswith("blush") else 6
        erased[name], fill = erase_region(
            im, box, pad=pad, feather=5 if name.startswith("blush") else 3
        )
        if name.startswith("blush"):
            # 擦完再按颜色扫一圈，清掉柔边扩散到方框外的淡粉
            gw = (box[2] - box[0]) * 0.16
            gh = (box[3] - box[1]) * 0.16
            erased[name] += clean_pink(
                im, (box[0] - gw, box[1] - gh, box[2] + gw, box[3] + gh), fill
            )

    # 7) 输出底图。固定放 assets/ 下，和 face.json 里的相对路径对上，
    #    这样整个 out 目录可以原样搬到任意页面旁边直接用。
    os.makedirs(os.path.join(args.out, "assets"), exist_ok=True)
    out_png = os.path.join(args.out, "assets", "character-base.png")
    im.save(out_png)

    # 8) 输出 face.json
    def P(d, kx, ky):
        return {"x": round(d["x"] * kx - ox, 1), "y": round(d["y"] * ky - oy, 1)}

    # 旋转轴：脸中线、嘴下方约一个半眼距的位置，接近脖子
    pivot_def = {
        "x": (eL["x"] + eR["x"]) / 2,
        "y": marks["mouth"]["y"] + (marks["mouth"]["y"] - eL["y"]) * 1.6,
    }
    face = {
        "name": marks.get("name", "角色"),
        "image": "./assets/character-base.png",
        "canvas": {"w": W2, "h": H2},
        "ink": ink,
        "eyeL": {"x": round(eyeL[0], 1), "y": round(eyeL[1], 1), "r": round(rL, 1)},
        "eyeR": {"x": round(eyeR[0], 1), "y": round(eyeR[1], 1), "r": round(rR, 1)},
        "nose": {"x": round(nx, 1), "y": round(ny, 1), "rx": round(nrx, 1), "ry": round(nry, 1)},
        "mouth": {"x": round(mx, 1), "y": round(my, 1), "w": round(mw, 1)},
        "brow": {
            "y": round(marks.get("brow", {}).get("y", eL["y"] - 0.05) * H1 - oy, 1),
            "len": round(rL * 2.27, 1),
            "w": round(rL * 0.55, 1),
        },
        "blushL": {"x": round(blx, 1), "y": round(bly, 1), "rx": round(blrx, 1), "ry": round(blry, 1)},
        "blushR": {"x": round(brx, 1), "y": round(bry, 1), "rx": round(brrx, 1), "ry": round(brry, 1)},
        "pivot": P(marks.get("pivot", pivot_def), W1, H1),
        "gazeAmp": {"x": round(rL * 0.64, 1), "y": round(rL * 0.45, 1)},
        "fx": {
            "heartL": {"x": round(blx - blrx * 2.45, 1), "y": round(bly - blry * 0.63, 1), "scale": round(W2 * 0.00222, 2)},
            "heartR": {"x": round(brx + brrx * 1.52, 1), "y": round(bry - brry * 0.65, 1), "scale": round(W2 * 0.00222, 2)},
            "anger": {"x": round(eyeR[0] + rR * 4.0, 1), "y": round(eyeL[1] - rL * 9.5, 1), "scale": round(W2 * 0.00132, 2)},
            "sparkCenter": {"x": round((eyeL[0] + eyeR[0]) / 2, 1), "y": round((eyeL[1] + my) / 2, 1)},
        },
    }
    with open(os.path.join(args.out, "face.json"), "w", encoding="utf-8") as fh:
        json.dump(face, fh, ensure_ascii=False, indent=2)

    print(json.dumps({
        "canvas": [W2, H2],
        "bg_color": bg,
        "had_alpha": src_alpha,
        "ink": ink,
        "snapped": snapped,
        "erased_pixels": erased,
        "out": args.out,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

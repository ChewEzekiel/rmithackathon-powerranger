"""Storyboard -> narrated motion-graphics MP4 (H.264 + AAC, 1920x1080, 30 fps).

    python -I -X utf8 video/make_video.py [storyboard.json]            # full render -> video/out/video.mp4
    python -I -X utf8 video/make_video.py --stills [storyboard.json]   # 4 stills per scene -> video/out/stills/
    python -I -X utf8 video/make_video.py --selftest

Every frame is drawn with Pillow (in parallel worker processes) and piped to ffmpeg as raw RGB.
Narration: Microsoft neural voices via edge-tts, generated inside the GitHub Codespace (one ssh call for all
missing lines; this laptop's network intercepts TLS) and cached in video/cache/voice by voice+rate+text.
If that fails, it falls back to offline Windows System.Speech (TTS_ENGINE=sapi forces it).
A soft synthesized pad plays under the voice, ducked while it speaks (MUSIC=0 turns it off).

Scene fields:
  id           unique name
  motion       hook | constraint | solution | host-view | rogue-steward | unseal | why-tidecloak | close | image
               (default: "image" when "image" is set, else the id)
  kicker, title   header text, animated in at the top
  subtitle     hook only: line under the title
  narration    spoken text; scene length = max(min_seconds, narration + 0.4 s)
  min_seconds  optional
  caption      burned-in key phrase: a string, or a list of strings spread over the narration.
               Image scenes without one show the narration as subtitles (set "captions": false to hide).
  image        image scenes: path relative to the storyboard file
  zoom         image scenes: Ken Burns zoom amount (default 0.08 = 8 %)
  focus        image scenes: [x, y] source pixel the camera drifts toward (default: centre of the callouts)
  callouts     image scenes: [{"x", "y", "w", "h" (source pixels), "label", "at" (seconds into scene),
               "color" (accent|violet|green|amber|red|white, default violet)}]
  clip         optional: a video file (relative to the storyboard) composited full-frame under the
               captions, e.g. a Blender hero shot; "clip_at" = seconds into the scene it starts (default 0)
Env overrides: FFMPEG (path), WORKERS (render processes), MUSIC (0 = no pad),
  TTS_ENGINE (edge | sapi), VOICE (edge voice, default en-US-AndrewMultilingualNeural; also good:
  en-US-AvaMultilingualNeural, en-US-BrianMultilingualNeural, en-GB-RyanNeural), TTS_RATE (edge "+6%", sapi -10..10),
  CODESPACE (codespace name used for edge-tts), TTS_VOICE (exact System.Speech voice name).
"""
import bisect, hashlib, json, math, os, random, re, shutil, subprocess, sys, tarfile, time, wave
from functools import lru_cache
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
CACHE, OUT_DIR = ROOT / "cache", ROOT / "out"
W, H, FPS = 1920, 1080, 30
PAD, FADE_F = 0.4, 12            # seconds of air after narration; crossfade length in frames (0.4 s)
CAP_W = W - 300
FONTS = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
BG_TOP, BG_BOTTOM = (9, 10, 28), (28, 24, 72)
ACCENT, VIOLET, WHITE, SUB, MUTED = (129, 140, 248), (167, 139, 250), (248, 250, 252), (199, 210, 254), (129, 140, 200)
GREEN, AMBER, RED, PANEL, INK = (52, 211, 153), (251, 191, 36), (248, 113, 113), (22, 24, 58), (12, 13, 34)
COLORS = {"accent": ACCENT, "violet": VIOLET, "green": GREEN, "amber": AMBER, "red": RED, "white": WHITE}
INST = [("Northbridge University", "N", ACCENT), ("Helix Therapeutics", "H", VIOLET),
        ("St Aurelia Hospital", "A", (56, 189, 248))]
SHORT = ["Northbridge", "Helix", "St Aurelia"]

PS_VOICES = ("Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer)"
             ".GetInstalledVoices() | Where-Object Enabled | ForEach-Object { $_.VoiceInfo.Name }")
PS_SPEAK = r"""$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($env:TTS_VOICE); $s.Rate = [int]$env:TTS_RATE
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 22050, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($j in (Get-Content -Raw -Encoding UTF8 $env:TTS_JOBS | ConvertFrom-Json)) { $s.SetOutputToWaveFile($j.out, $fmt); $s.Speak($j.text) }
$s.Dispose()"""
EDGE_VOICE, EDGE_RATE = "en-US-AndrewMultilingualNeural", "+6%"
CODESPACE = "expert-bassoon-pjqwwq7jrjwwcrv5"
SAY = {"TideCloak": "Tide Cloak", "PowerRanger": "Power Ranger"}  # spoken spelling; captions keep the brand
EDGE_SH = """set -e
pip install -q edge-tts >/dev/null 2>&1 || pip install -q --user edge-tts >/dev/null
rm -rf /tmp/treaty-voice && mkdir -p /tmp/treaty-voice && cd /tmp/treaty-voice
python3 - <<'PY'
import asyncio, json, edge_tts
JOBS, VOICE, RATE = json.loads(%r), %r, %r
async def main():
    for j in JOBS:
        await edge_tts.Communicate(j["text"], VOICE, rate=RATE).save(j["name"])
asyncio.run(main())
PY
tar cf all.tar *.mp3
"""
# seconds each animation needs; a shorter scene plays its animation proportionally faster
DESIGN = {"hook": 12.4, "constraint": 12.6, "solution": 11.8, "host-view": 11.6, "rogue-steward": 13.0,
          "unseal": 10.6, "why-tidecloak": 15.4, "close": 7.5}


# ---------------------------------------------------------------- text + easing helpers
@lru_cache(None)
def _font(size, w):
    name = {"r": "segoeui.ttf", "b": "segoeuib.ttf", "s": "seguisb.ttf", "m": "consola.ttf"}[w]
    for n in (name, "segoeui.ttf", "arial.ttf"):
        if (FONTS / n).exists():
            return ImageFont.truetype(str(FONTS / n), size)
    return ImageFont.load_default(size)


def F(size, w="b"):
    return _font(max(1, round(size)), w)


def wrap(text, f, width):
    lines = []
    for para in text.split("\n"):
        line = ""
        for word in para.split():
            trial = f"{line} {word}".strip()
            if line and f.getlength(trial) > width:
                lines.append(line)
                line = word
            else:
                line = trial
        lines.append(line)
    return lines


def balanced(text, f, width):
    """Same line count as a greedy wrap, but narrowed so the last line isn't a lonely word."""
    n = len(wrap(text, f, width))
    while width > 300 and len(wrap(text, f, width - 20)) == n:
        width -= 20
    return wrap(text, f, width)


def caption_chunks(text, f):
    """Group sentences into subtitle chunks of at most 2 lines."""
    groups, cur = [], ""
    for s in re.split(r"(?<=[.!?])\s+", text.strip()):
        trial = f"{cur} {s}".strip()
        if cur and len(wrap(trial, f, CAP_W)) > 2:
            groups.append(cur)
            cur = s
        else:
            cur = trial
    groups.append(cur)
    out = []
    for g in groups:  # a single sentence longer than 2 lines -> 2-line slices
        lines = wrap(g, f, CAP_W)
        out += [" ".join(lines[i:i + 2]) for i in range(0, len(lines), 2)]
    return out


def split_frames(clip, speech, weights):
    """Frames per caption chunk: chunks share the speech time by text length; the last also covers the tail."""
    tot, acc, cuts = sum(weights), 0, [0]
    for w in weights[:-1]:
        acc += w
        cuts.append(max(cuts[-1] + 1, round(speech * acc / tot)))
    cuts.append(clip)
    return [b - a for a, b in zip(cuts, cuts[1:])]


def clamp(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def seg(t, a, b):
    return clamp((t - a) / (b - a))


def eo(x):  # easeOutCubic
    return 1 - (1 - clamp(x)) ** 3


def eio(x):  # easeInOutCubic
    x = clamp(x)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def back(x, c=1.70158):  # back-out: overshoots, then settles at 1
    x = clamp(x) - 1
    return 1 + (c + 1) * x ** 3 + c * x ** 2


def lerp(a, b, u):
    return a + (b - a) * u


def mix(c1, c2, u):
    return tuple(round(lerp(a, b, u)) for a, b in zip(c1, c2))


def rgba(c, a=1.0):
    return (*c[:3], max(0, min(255, round(255 * a))))


def text(d, xy, s, size, c, w="b", a=1.0, anchor="la"):
    if a > 0.004:
        d.text(xy, s, font=F(size, w), fill=rgba(c, a), anchor=anchor)


def words_in(d, s, size, x, y, t, t0, c=WHITE, w="b", stagger=0.07, dur=0.5, center=False, max_w=1600, hl=()):
    """Kinetic typography: each word rises and fades in. Returns [(word, x, y, width)]."""
    f, pos, j = F(size, w), [], 0
    for li, line in enumerate(wrap(s, f, max_w)):
        cx, yy = (x - f.getlength(line) / 2 if center else x), y + li * size * 1.18
        for word in line.split():
            u = eo(seg(t, t0 + j * stagger, t0 + j * stagger + dur))
            col = ACCENT if word.strip(".,?!:;").lower() in hl else c
            if u > 0:
                d.text((cx, yy + (1 - u) * size * 0.45), word, font=f, fill=rgba(col, u), anchor="la")
            pos.append((word, cx, yy, f.getlength(word)))
            cx += f.getlength(word + " ")
            j += 1
    return pos


# ---------------------------------------------------------------- sprites (drawn 3x, downsampled = antialiased)
SS = 3


def mk(w, h, fn):
    im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    fn(ImageDraw.Draw(im), lambda *v: [x * SS for x in v])
    return im.resize((w, h), Image.LANCZOS)


def put(img, spr, cx, cy, s=1.0, a=1.0, rot=0.0):
    """Paste an RGBA sprite centred at (cx, cy), scaled, faded and rotated."""
    if a <= 0.004 or s <= 0.01:
        return
    if rot:
        spr = spr.rotate(rot, Image.BICUBIC, expand=True)
    if abs(s - 1) > 1e-3:
        spr = spr.resize((max(1, round(spr.width * s)), max(1, round(spr.height * s))), Image.BICUBIC)
    if a < 0.999:
        spr = spr.copy()
        spr.putalpha(spr.getchannel("A").point(lambda v: round(v * a)))
    img.paste(spr, (round(cx - spr.width / 2), round(cy - spr.height / 2)), spr)


@lru_cache(None)
def glow_spr(c, w):
    yy, xx = np.mgrid[-1:1:w * 1j, -1:1:w * 1j]
    a = (np.clip(1 - np.hypot(xx, yy), 0, 1) ** 2 * 255).astype(np.uint8)
    g = Image.new("RGBA", (w, w), (*c, 0))
    g.putalpha(Image.fromarray(a, "L"))
    return g


@lru_cache(None)
def ring_spr(c, w, width):
    return mk(w, w, lambda d, k: d.ellipse(k(2, 2, w - 2, w - 2), outline=c, width=width * SS))


@lru_cache(None)
def doc_spr(tint=(226, 232, 255), w=90, h=112):
    ln = mix(tint, (60, 70, 140), 0.45)

    def f(d, k):
        d.polygon(k(0, 0, w - 24, 0, w, 24, w, h, 0, h), fill=tint)
        d.polygon(k(w - 24, 0, w - 24, 24, w, 24), fill=mix(tint, (60, 70, 140), 0.3))
        for j, y in enumerate(range(38, h - 12, 13)):
            d.line(k(14, y, w - (34 if j % 3 == 2 else 14), y), fill=ln, width=5 * SS)
    return mk(w, h, f)


@lru_cache(None)
def lock_body(c):
    def f(d, k):
        d.rounded_rectangle(k(0, 0, 84, 68), radius=14 * SS, fill=c)
        d.ellipse(k(33, 16, 51, 34), fill=INK)
        d.polygon(k(38, 28, 46, 28, 49, 52, 35, 52), fill=INK)
    return mk(84, 68, f)


@lru_cache(None)
def shackle_spr(c):
    def f(d, k):
        d.arc(k(8, 4, 56, 52), 180, 360, fill=c, width=10 * SS)
        d.rectangle(k(8, 27, 18, 64), fill=c)
        d.rectangle(k(46, 27, 56, 64), fill=c)
    return mk(64, 64, f)


def lock(img, cx, cy, s=1.0, open_u=0.0, c=VIOLET, a=1.0):
    put(img, shackle_spr(c), cx, cy - 30 * s - 24 * s * open_u, s, a)
    put(img, lock_body(c), cx, cy + 18 * s, s, a)


@lru_cache(None)
def key_spr(c):
    def f(d, k):
        d.ellipse(k(4, 8, 84, 88), fill=c)
        d.ellipse(k(28, 32, 60, 64), fill=(0, 0, 0, 0))
        d.rounded_rectangle(k(76, 39, 232, 57), radius=4 * SS, fill=c)
        d.rectangle(k(184, 55, 198, 80), fill=c)
        d.rectangle(k(208, 55, 222, 72), fill=c)
    return mk(240, 96, f)


def qb(p0, p1, p2, n=14):
    return [((1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0],
             (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1]) for u in (i / n for i in range(n + 1))]


_R = [(0.5, 0.03), (0.94, 0.15), (0.94, 0.5)] + qb((0.94, 0.5), (0.92, 0.84), (0.5, 0.98))[1:]
SHIELD = _R + [(1 - x, y) for x, y in reversed(_R[1:-1])]


@lru_cache(None)
def shield_spr(letter, c, w=130, h=150):
    def f(d, k):
        d.polygon([v for x, y in SHIELD for v in k(x * w, y * h)], fill=mix(PANEL, c, 0.3), outline=c, width=6 * SS)
        d.text(k(w / 2, h * 0.47), letter, font=F(60 * SS), fill=WHITE, anchor="mm")
    return mk(w, h, f)


@lru_cache(None)
def badge(kind, w=60):
    def f(d, k):
        d.ellipse(k(0, 0, w, w), fill=GREEN if kind == "ok" else RED)
        if kind == "ok":
            d.line(k(w * .27, w * .53, w * .44, w * .69, w * .74, w * .35), fill=WHITE, width=round(w * .12 * SS),
                   joint="curve")
        else:
            for a, b in ((.32, .68), (.68, .32)):
                d.line(k(w * .32, w * a, w * .68, w * b), fill=WHITE, width=round(w * .12 * SS))
    return mk(w, w, f)


@lru_cache(None)
def big_x(w=190):
    def f(d, k):
        for c, wd in (((70, 10, 20), 44), (RED, 30)):
            d.line(k(30, 30, w - 30, w - 30), fill=c, width=wd * SS)
            d.line(k(w - 30, 30, 30, w - 30), fill=c, width=wd * SS)
    return mk(w, w, f)


@lru_cache(None)
def eye_spr(c, w=200, h=112):
    def f(d, k):
        up = [(x, h / 2 - (h / 2 - 6) * math.sin(math.pi * x / w)) for x in range(0, w + 1, 5)]
        pts = up + [(x, h - y) for x, y in reversed(up)]
        d.polygon([v for p in pts for v in k(*p)], fill=(16, 18, 46), outline=c, width=6 * SS)
        d.ellipse(k(w / 2 - 34, h / 2 - 34, w / 2 + 34, h / 2 + 34), fill=c)
        d.ellipse(k(w / 2 - 15, h / 2 - 15, w / 2 + 15, h / 2 + 15), fill=INK)
        d.ellipse(k(w / 2 + 6, h / 2 - 18, w / 2 + 18, h / 2 - 6), fill=WHITE)
    return mk(w, h, f)


@lru_cache(None)
def thief_spr():
    def f(d, k):
        d.pieslice(k(8, 112, 162, 332), 180, 360, fill=(44, 48, 82), outline=RED, width=4 * SS)
        d.ellipse(k(37, 14, 133, 110), fill=(66, 70, 108))
        d.pieslice(k(33, 4, 137, 100), 180, 360, fill=(44, 48, 82))
        d.rounded_rectangle(k(35, 50, 135, 80), radius=12 * SS, fill=(10, 10, 20))
        d.ellipse(k(60, 59, 78, 71), fill=WHITE)
        d.ellipse(k(92, 59, 110, 71), fill=WHITE)
    return mk(170, 222, f)


@lru_cache(None)
def lab_spr(i, w=200):
    c = INST[i][2]

    def f(d, k):
        fill, m = mix(PANEL, c, 0.22), w / 2
        if i == 0:
            d.ellipse(k(6, 6, w - 6, w - 6), fill=fill, outline=c, width=6 * SS)
            d.polygon(k(m - 52, m - 18, m, m - 52, m + 52, m - 18), fill=c)
            for dx in (-38, -13, 13, 38):
                d.rectangle(k(m + dx - 6, m - 12, m + dx + 6, m + 30), fill=c)
            d.rectangle(k(m - 58, m + 34, m + 58, m + 44), fill=c)
        elif i == 1:
            d.rounded_rectangle(k(14, 14, w - 14, w - 14), radius=40 * SS, fill=fill, outline=c, width=6 * SS)
            for ph in (0, math.pi):
                d.line([v for y in range(-50, 51, 4) for v in k(m + 30 * math.sin(y / 50 * math.pi * 1.5 + ph), m + y)],
                       fill=c, width=7 * SS, joint="curve")
            for y in range(-42, 43, 14):
                x = 30 * math.sin(y / 50 * math.pi * 1.5)
                d.line(k(m - x, m + y, m + x, m + y), fill=mix(c, PANEL, .35), width=4 * SS)
        else:
            d.polygon([v for a in range(6) for v in k(m + 96 * math.cos(math.radians(30 + 60 * a)),
                                                      m + 96 * math.sin(math.radians(30 + 60 * a)))],
                      fill=fill, outline=c, width=6 * SS)
            d.rounded_rectangle(k(m - 15, m - 48, m + 15, m + 48), radius=4 * SS, fill=c)
            d.rounded_rectangle(k(m - 48, m - 15, m + 48, m + 15), radius=4 * SS, fill=c)
    return mk(w, w, f)


@lru_cache(None)
def vault_spr(c=ACCENT, w=240):
    def f(d, k):
        m = w / 2
        d.ellipse(k(4, 4, w - 4, w - 4), fill=(36, 40, 92), outline=c, width=8 * SS)
        d.ellipse(k(40, 40, w - 40, w - 40), outline=mix(c, PANEL, .4), width=5 * SS)
        for a in range(8):
            x, y = m + 100 * math.cos(a * math.pi / 4), m + 100 * math.sin(a * math.pi / 4)
            d.ellipse(k(x - 6, y - 6, x + 6, y + 6), fill=mix(c, PANEL, .3))
        for a in range(3):
            dx, dy = 62 * math.cos(a * math.pi / 3), 62 * math.sin(a * math.pi / 3)
            d.line(k(m - dx, m - dy, m + dx, m + dy), fill=SUB, width=9 * SS)
            for sg in (1, -1):
                d.ellipse(k(m + sg * dx - 10, m + sg * dy - 10, m + sg * dx + 10, m + sg * dy + 10), fill=SUB)
        d.ellipse(k(m - 22, m - 22, m + 22, m + 22), fill=SUB)
    return mk(w, w, f)


def vault(img, d, cx, cy, z=1.0, spin=0.0, open_u=0.0, a=1.0, inner=GREEN):
    s = 300 * z
    d.rounded_rectangle((cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2), radius=36 * z, fill=rgba((26, 28, 66), .95 * a),
                        outline=rgba((88, 92, 170), a), width=4)
    door = vault_spr()
    if spin:
        door = door.rotate(-spin, Image.BICUBIC)
    if open_u > 0:
        put(img, glow_spr(inner, round(380 * z)), cx, cy, 1, open_u * a)
        r = 112 * z
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=rgba(mix(INK, inner, .55), open_u * a))
        e = eio(open_u)
        sw = max(2, round(240 * (1 - 0.86 * e)))
        door = door.resize((sw, 240), Image.BILINEAR)
        put(img, door, cx - 120 * z + sw * z / 2 - 40 * z * e, cy, z, a)
    else:
        put(img, door, cx, cy, z, a)


@lru_cache(None)
def node_spr(c, w=40):
    def f(d, k):
        d.ellipse(k(2, 2, w - 2, w - 2), fill=mix(INK, c, .5), outline=c, width=4 * SS)
        d.ellipse(k(w / 2 - 6, w / 2 - 6, w / 2 + 6, w / 2 + 6), fill=c)
    return mk(w, w, f)


@lru_cache(None)
def stamp_spr(label="SEALED", c=VIOLET):
    w, h = 440, 150

    def f(d, k):
        d.rounded_rectangle(k(6, 6, w - 6, h - 6), radius=20 * SS, outline=c, width=8 * SS, fill=(14, 12, 40, 215))
        d.rounded_rectangle(k(20, 20, w - 20, h - 20), radius=12 * SS, outline=c, width=3 * SS)
        d.text(k(w / 2, h / 2 + 2), label, font=F(84 * SS), fill=c, anchor="mm")
    return mk(w, h, f)


@lru_cache(None)
def banner_spr(label):
    w, h = round(F(70).getlength(label)) + 230, 170

    def f(d, k):
        d.rounded_rectangle(k(4, 4, w - 4, h - 4), radius=26 * SS, fill=(150, 24, 34, 245), outline=RED, width=5 * SS)
        d.ellipse(k(46, 45, 126, 125), fill=WHITE)
        for a, b in ((.32, .68), (.68, .32)):
            d.line(k(46 + 80 * .32, 45 + 80 * a, 46 + 80 * .68, 45 + 80 * b), fill=(150, 24, 34), width=11 * SS)
        d.text(k(160, h / 2 + 2), label, font=F(70 * SS), fill=WHITE, anchor="lm")
    return mk(w, h, f)


@lru_cache(None)
def hx(n, cols=14):
    h = hashlib.sha256(f"treaty-{n}".encode()).hexdigest()
    return " ".join(h[i:i + 4] for i in range(0, 64, 4))[:cols].strip()


def dashed(d, p0, p1, u, c, width=4, dash=16, gap=12):
    L = math.dist(p0, p1) * clamp(u)
    ux, uy = (p1[0] - p0[0]) / math.dist(p0, p1), (p1[1] - p0[1]) / math.dist(p0, p1)
    s = 0.0
    while s < L:
        e = min(s + dash, L)
        d.line((p0[0] + ux * s, p0[1] + uy * s, p0[0] + ux * e, p0[1] + uy * e), fill=c, width=width)
        s += dash + gap


def chip(d, cx, cy, label, c, a=1.0, size=20, fg=INK):
    if a <= 0.004:
        return
    f = F(size, "b")
    w = f.getlength(label) + size * 1.4
    d.rounded_rectangle((cx - w / 2, cy - size * 0.9, cx + w / 2, cy + size * 0.9), radius=size * 0.9, fill=rgba(c, .95 * a))
    d.text((cx, cy + 1), label, font=f, fill=rgba(fg, a), anchor="mm")


def tint(d, c, a):
    if a > 0.004:
        d.rectangle((0, 0, W, H), fill=rgba(c, a))


def dot(img, d, x, y, c, a=1.0, r=9):
    put(img, glow_spr(c, 90), x, y, 1, a)
    d.ellipse((x - r, y - r, x + r, y + r), fill=rgba(WHITE, a))


# ---------------------------------------------------------------- background, header, captions
_rng = random.Random(42)
PARTS = [(_rng.uniform(0, W), _rng.uniform(0, H), _rng.uniform(-6, 6), _rng.uniform(-16, -4),
          _rng.choice((1.5, 2, 2.5, 3)), _rng.uniform(0, 6.28)) for _ in range(70)]


@lru_cache(None)
def bg_base():
    img = Image.composite(Image.new("RGB", (W, H), BG_BOTTOM), Image.new("RGB", (W, H), BG_TOP),
                          Image.linear_gradient("L").resize((W, H)))
    put(img, glow_spr((99, 102, 241), 1900), W - 250, -150, 1, 0.30)
    put(img, glow_spr((139, 92, 246), 1500), 150, H + 200, 1, 0.16)
    return img


def background(gt):
    img = bg_base().copy()
    d = ImageDraw.Draw(img, "RGBA")
    ox, oy = (gt * 10) % 80, (gt * 5) % 80
    for x in range(-80, W + 80, 80):
        d.line((x + ox, 0, x + ox, H), fill=(129, 140, 248, 13))
    for y in range(-80, H + 80, 80):
        d.line((0, y + oy, W, y + oy), fill=(129, 140, 248, 13))
    for x0, y0, vx, vy, r, ph in PARTS:
        x, y = (x0 + vx * gt) % W, (y0 + vy * gt) % H
        d.ellipse((x - r, y - r, x + r, y + r), fill=rgba(SUB, 0.22 + 0.18 * math.sin(gt * 1.3 + ph)))
    return img, d


def header(d, sc, t):
    if sc.get("kicker"):
        u = eo(seg(t, 0.1, 0.7))
        d.rounded_rectangle((160 - 40 * (1 - u), 100, 166 - 40 * (1 - u), 128), radius=3, fill=rgba(ACCENT, u))
        text(d, (182 - 40 * (1 - u), 95), sc["kicker"].upper(), 28, ACCENT, "b", u)
    if sc.get("title"):
        words_in(d, sc["title"], 60, 160, 136, t, 0.3, max_w=1500)


def pill(d, s, t, t0, dur=0.45):
    u = eo(seg(t, t0, t0 + dur))
    if u <= 0:
        return
    f = F(40, "s")
    lines = balanced(s, f, CAP_W)
    tw, lh = max(f.getlength(ln) for ln in lines), 54
    h = lh * len(lines) + 30
    cy = H - 70 - h / 2 + (1 - u) * 18
    d.rounded_rectangle((W / 2 - tw / 2 - 40, cy - h / 2, W / 2 + tw / 2 + 40, cy + h / 2), radius=min(38, h / 2),
                        fill=(8, 9, 26, round(215 * u)), outline=rgba(ACCENT, .55 * u), width=2)
    for j, ln in enumerate(lines):
        d.text((W / 2, cy + (j - (len(lines) - 1) / 2) * lh), ln, font=f, fill=rgba(WHITE, u), anchor="mm")


# ---------------------------------------------------------------- scenes: fn(img, d, sc, t, T)
def m_hook(img, d, sc, t, T):
    pos = words_in(d, sc["title"], 76, W / 2, 128, t, 0.25, stagger=0.11, dur=0.55, center=True, max_w=1450,
                   hl={"trust"})
    for j, (_, x, y, wl) in enumerate(p for p in pos if p[0].strip("?").lower() in ("trust", "bottleneck")):
        u = eio(seg(t, 1.8 + 0.45 * j, 2.4 + 0.45 * j))
        if u > 0:
            d.rounded_rectangle((x, y + 98, x + wl * u, y + 106), radius=4, fill=ACCENT)
    if sc.get("subtitle"):
        text(d, (W / 2, 368 + 12 * (1 - eo(seg(t, 2.6, 3.2)))), sc["subtitle"], 34, SUB, "r", eo(seg(t, 2.6, 3.2)), "mm")
    xs, ly = (480, 960, 1440), 600
    for i, x in enumerate(xs):
        u = seg(t, 3.2 + 0.25 * i, 3.8 + 0.25 * i)
        if u <= 0:
            continue
        put(img, glow_spr(INST[i][2], 380), x, ly, 1, 0.3 * eo(u))
        put(img, lab_spr(i), x, ly, back(u), clamp(u * 3))
        text(d, (x, ly + 140), INST[i][0], 30, WHITE, "s", eo(seg(t, 3.6 + .25 * i, 4.1 + .25 * i)), "mm")
        du = eo(seg(t, 4.4 + 0.2 * i, 5.0 + 0.2 * i))
        if du > 0:
            dx, dy = lerp(x, x + 92, du), lerp(ly, ly + 48, du)
            put(img, doc_spr(), dx, dy, lerp(0.3, 0.7, du), du)
            lu = seg(t, 5.1 + 0.2 * i, 5.5 + 0.2 * i)
            if lu > 0:
                lock(img, dx + 22, dy + 18, 0.42 * back(lu), 0, AMBER, clamp(lu * 3))
    for i in range(2):
        p0, p1 = (xs[i] + 125, ly), (xs[i + 1] - 125, ly)
        dashed(d, p0, p1, eio(seg(t, 6.0 + .3 * i, 6.7 + .3 * i)), rgba(RED, .85), 5)
        bu = seg(t, 7.0 + .3 * i, 7.4 + .3 * i)
        if bu > 0:
            mx = (p0[0] + p1[0]) / 2
            put(img, badge("no", 54), mx, ly, back(bu), clamp(bu * 3))
            text(d, (mx, ly + 48), "no sharing", 22, RED, "b", clamp(bu * 2), "mm")
    u = eo(seg(t, 10.6, 11.2))
    text(d, (W / 2, 856 + 14 * (1 - u)), "Same dead ends, funded three times.", 36, AMBER, "s", u, "mm")


def m_constraint(img, d, sc, t, T):
    header(d, sc, t)
    red = eo(seg(t, 11.0, 12.0))
    bx, by = 960, 560
    u = eo(seg(t, 0.8, 1.4))
    if u > 0:
        oy = 30 * (1 - u)
        d.rounded_rectangle((bx - 250, by - 130 + oy, bx + 250, by + 130 + oy), radius=28, fill=rgba(PANEL, .95 * u),
                            outline=rgba(mix(ACCENT, RED, red), u), width=3)
        text(d, (bx, by + 82 + oy), "Shared platform", 32, WHITE, "s", u, "mm")
        text(d, (bx, by - 160 + oy), "THE HOST", 22, MUTED, "b", u, "mm")
        ou = eo(seg(t, 2.4, 3.0))
        if ou > 0:
            for c, a in ((ACCENT, 1 - red), (RED, red)):
                e = eye_spr(c)
                put(img, e.resize((e.width, max(1, round(e.height * ou)))), bx, by - 22 + oy, 1, u * a)
    docs = [(1500, 370 + 185 * j) for j in range(3)]
    for j, (x, y) in enumerate(docs):
        u = eo(seg(t, 1.2 + .2 * j, 1.8 + .2 * j))
        put(img, doc_spr(), x + 30 * (1 - u), y, 0.8, u)
        text(d, (x + 64, y - 18), SHORT[j], 28, WHITE, "s", u)
        ru = eo(seg(t, 5.2 + 1.0 * j, 5.5 + 1.0 * j))
        chip(d, x + 100, y + 42, "READ", RED, ru, 18)
    jf = eio(seg(t, 5.6, 6.1)) + eio(seg(t, 6.6, 7.1))
    ty = lerp(docs[0][1], docs[2][1], jf / 2)
    ba = eo(seg(t, 4.8, 5.2)) * (1 - seg(t, 8.2, 8.8))
    if ba > 0:
        d.polygon([(bx + 60, by - 22), (1450, ty - 52), (1450, ty + 52)], fill=rgba(mix(ACCENT, RED, .3), .26 * ba))
        d.line((bx + 60, by - 22, 1450, ty), fill=rgba(SUB, .55 * ba), width=3)
    text(d, (bx, by + 180), "Host can read everything", 32, RED, "s", eo(seg(t, 8.0, 8.5)), "mm")
    # door + the single admin key
    dx, dy = 330, 560
    du = eo(seg(t, 8.6, 9.2))
    if du > 0:
        op = eio(seg(t, 10.3, 11.0))
        d.rectangle((dx - 95, dy - 140, dx + 95, dy + 140), fill=rgba(mix(INK, RED, .55), du * op),
                    outline=rgba(MUTED, du), width=4)
        pw = 180 * (1 - 0.8 * op)
        d.rectangle((dx - 90, dy - 135, dx - 90 + pw, dy + 135), fill=rgba((58, 62, 120), du))
        d.ellipse((dx - 90 + pw - 34, dy - 10, dx - 90 + pw - 14, dy + 10), fill=rgba(SUB, du))
        text(d, (dx, dy - 165), "Room access", 22, MUTED, "b", du, "mm")
    ku = eio(seg(t, 9.0, 10.0))
    if ku > 0:
        kx, ky = lerp(760, dx + 50 + 60, ku), lerp(1000, dy, ku)
        put(img, glow_spr(AMBER, 200), kx, ky, 1, 0.5 * eo(seg(t, 9.9, 10.3)) * (1 - seg(t, 10.6, 11.2)))
        put(img, key_spr(AMBER), kx, ky, 0.5, 1 - seg(t, 10.8, 11.2), 180 + 30 * (1 - ku))
        text(d, (kx + 10, ky + 46), "1 admin", 22, AMBER, "b", clamp(ku * 3) * (1 - seg(t, 10.8, 11.2)), "mm")
    text(d, (dx, dy + 180), "One admin lets anyone in", 30, RED, "s", eo(seg(t, 11.2, 11.7)), "mm")
    tint(d, (200, 30, 50), 0.16 * red)


def hex_block(d, cx, cy, s, a, t, rows=5, cols=14):
    if a <= 0.004:
        return
    f = F(22 * s, "m")
    cw, lh = f.getlength("0"), 27 * s
    w_, h_ = cols * cw + 28 * s, rows * lh + 22 * s
    d.rounded_rectangle((cx - w_ / 2, cy - h_ / 2, cx + w_ / 2, cy + h_ / 2), radius=12 * s,
                        fill=rgba((14, 16, 44), .94 * a), outline=rgba(VIOLET, a), width=max(1, round(3 * s)))
    off = int(t * 9)
    for r in range(rows):
        d.text((cx - w_ / 2 + 14 * s, cy - h_ / 2 + 11 * s + r * lh), hx(r + off, cols), font=f,
               fill=rgba(mix(VIOLET, WHITE, .35 if (r + off) % 3 else .7), a), anchor="la")


def browser(d, cx, cy, w, h, a, label):
    x0, y0 = cx - w / 2, cy - h / 2
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=16, fill=rgba((20, 22, 54), a), outline=rgba(ACCENT, .8 * a),
                        width=3)
    d.rectangle((x0 + 3, y0 + 3, x0 + w - 3, y0 + 46), fill=rgba((34, 36, 84), a))
    for j, c in enumerate((RED, AMBER, GREEN)):
        d.ellipse((x0 + 20 + 22 * j, y0 + 17, x0 + 34 + 22 * j, y0 + 31), fill=rgba(c, a))
    d.rounded_rectangle((x0 + 100, y0 + 11, x0 + w - 20, y0 + 37), radius=12, fill=rgba((16, 18, 44), a))
    text(d, (x0 + 116, y0 + 24), label, 18, MUTED, "r", a, "lm")


def m_solution(img, d, sc, t, T):
    header(d, sc, t)
    (bx, by), (lx, ly), (vx, vy) = (400, 590), (960, 590), (1500, 590)
    u = eo(seg(t, 0.6, 1.2))
    browser(d, bx, by + 20 * (1 - u), 480, 330, u, "northbridge.edu - Treaty Room")
    text(d, (bx, by + 200), "Researcher's browser", 28, SUB, "s", u, "mm")
    vu = seg(t, 0.9, 1.6)
    if vu > 0:
        put(img, glow_spr(VIOLET, 520), vx, vy, 1, 0.35 * eo(vu) + 0.4 * eo(seg(t, 7.8, 8.2)) * (1 - seg(t, 8.4, 9.2)))
        vault(img, d, vx, vy, back(vu), spin=90 * eio(seg(t, 8.6, 9.4)), a=clamp(vu * 3))
        text(d, (vx, vy - 195), "TREATY ROOM", 28, VIOLET, "b", clamp(vu * 2), "mm")
        chip(d, vx, vy + 195, "no owner", (60, 64, 130), eo(seg(t, 2.2, 2.6)), 20, SUB)
    cu = seg(t, 1.2, 1.8)
    closed = eo(seg(t, 5.3, 5.6))
    lock(img, lx, ly, 1.25 * back(cu), 1 - closed, VIOLET, clamp(cu * 3))
    put(img, ring_spr(VIOLET, 240, 4), lx, ly, lerp(0.6, 1.4, seg(t, 5.5, 6.1)), 0.8 * (1 - seg(t, 5.5, 6.1)) * (t >= 5.5))
    text(d, (lx, ly + 130), "Encrypted in the browser", 28, SUB, "s", eo(seg(t, 5.6, 6.1)), "mm")
    # the deposit: browser -> lock -> ciphertext -> vault
    fu = eio(seg(t, 4.0, 5.3))
    if t < 5.4:
        x, y = lerp(bx, lx, fu), lerp(by + 30, ly + 10, fu) - 150 * math.sin(math.pi * fu)
        put(img, doc_spr(), x, y, lerp(1.0, 0.45, fu), eo(seg(t, 0.9, 1.5)) * (1 - seg(t, 5.15, 5.4)))
    hu = seg(t, 5.6, 8.0)
    if 0 < hu < 1:
        e = eio(hu)
        hex_block(d, lerp(lx + 30, vx, e), ly + 10 - 60 * math.sin(math.pi * e), lerp(0.4, 1.0, eo(hu * 4)) * lerp(1, 0.3, seg(hu, .7, 1)),
                  eo(hu * 5) * (1 - seg(hu, .85, 1)), t)
    su = seg(t, 9.6, 9.95)
    if su > 0:
        put(img, stamp_spr(), vx, vy, lerp(2.2, 1.0, back(su)), eo(su * 1.6), 8)
        ru = seg(t, 9.95, 10.6)
        put(img, ring_spr(VIOLET, 400, 5), vx, vy, lerp(0.8, 1.6, eo(ru)), 0.7 * (1 - ru) * (ru > 0))
    text(d, (vx, vy + 250), "Sealed, even to depositors", 30, VIOLET, "s", eo(seg(t, 10.4, 10.9)), "mm")


def m_host_view(img, d, sc, t, T):
    header(d, sc, t)
    x0, y0, tw, th = 150, 290, 1000, 560
    u = eo(seg(t, 0.4, 1.1))
    panel = Image.new("RGB", (tw, th), (16, 18, 46))
    pd = ImageDraw.Draw(panel)
    scroll, rh = t * 46, 52
    first = int(scroll // rh)
    for r in range(first, first + 12):
        y = 100 + r * rh - scroll
        pd.text((24, y + rh / 2), f"dep_{r:04d}", font=F(22, "m"), fill=WHITE, anchor="lm")
        pd.text((200, y + rh / 2), SHORT[r % 3], font=F(22, "s"), fill=SUB, anchor="lm")
        pd.text((410, y + rh / 2), hx(r, 30), font=F(22, "m"), fill=(150, 160, 240), anchor="lm")
        pd.text((tw - 24, y + rh / 2), f"{(r * 37) % 900 + 40} KB", font=F(22, "m"), fill=MUTED, anchor="rm")
        pd.line((16, y + rh, tw - 16, y + rh), fill=(32, 34, 76))
    pd.rectangle((0, 0, tw, 100), fill=(16, 18, 46))
    pd.rectangle((0, 0, tw, 56), fill=(28, 30, 70))
    pd.text((24, 28), "HOST DATABASE  ·  store.json", font=F(24, "b"), fill=SUB, anchor="lm")
    for cx_, lab, an in ((24, "deposit", "lm"), (200, "institution", "lm"), (410, "content", "lm"), (tw - 24, "size", "rm")):
        pd.text((cx_, 80), lab.upper(), font=F(18, "b"), fill=MUTED, anchor=an)
    box = (x0, round(y0 + 30 * (1 - u)))
    img.paste(panel if u >= 1 else Image.blend(img.crop((*box, box[0] + tw, box[1] + th)), panel, u), box)
    d.rectangle((box[0], box[1], box[0] + tw, box[1] + th), outline=rgba(ACCENT, .7 * u), width=2)
    chip(d, x0 + tw - 150, y0 + 28, "CIPHERTEXT ONLY", VIOLET, eo(seg(t, 2.4, 2.8)), 18)
    # thief grabs a copy
    tx, ty = lerp(2150, 1690, eo(seg(t, 4.2, 5.0))), 680
    put(img, thief_spr(), tx, ty)
    gu = eio(seg(t, 5.0, 6.0))
    if gu > 0:
        s = lerp(0.9, 0.3, gu)
        mx, my = lerp(x0 + tw / 2 + 40, 1410, gu), lerp(y0 + th / 2 + 20, 760, gu)
        mini = panel.resize((round(tw * s), round(th * s)), Image.BILINEAR)
        img.paste(mini, (round(mx - mini.width / 2), round(my - mini.height / 2)))
        d.rectangle((mx - mini.width / 2, my - mini.height / 2, mx + mini.width / 2, my + mini.height / 2),
                    outline=RED, width=3)
    text(d, (1480, 880), "Stolen copy: still ciphertext", 26, RED, "s", eo(seg(t, 6.4, 6.9)), "mm")
    # ask the Tide network -> refused
    nx, ny = 1560, 380
    nu = seg(t, 7.2, 7.8)
    refused = t >= 9.4
    for n in range(8):
        a = math.radians(n * 45 + t * 8)
        c = RED if refused and int(t * 6) % 2 == 0 and t < 10.4 else (RED if refused else ACCENT)
        put(img, node_spr(c, 30), nx + 62 * math.cos(a), ny + 62 * math.sin(a), back(nu), clamp(nu * 3))
    text(d, (nx, ny - 105), "Tide network", 24, SUB, "b", eo(nu), "mm")
    qu = eio(seg(t, 7.9, 8.9))
    if 0 < qu < 1 or (qu >= 1 and t < 9.4):
        p0, p1 = (1660, 560), (nx + 20, ny + 80)
        dashed(d, p0, p1, 1, rgba(SUB, .6), 3, 10, 8)
        px, py = lerp(p0[0], p1[0], qu), lerp(p0[1], p1[1], qu)
        dot(img, d, px, py, AMBER)
        text(d, (px + 24, py), "decrypt?", 24, WHITE, "s", 1, "lm")
    bu = seg(t, 10.0, 10.35)
    if bu > 0:
        tint(d, (220, 38, 38), 0.26 * eo(seg(t, 10.0, 10.12)) * (1 - 0.65 * seg(t, 10.12, 10.9)))
        shake = 12 * (1 - seg(t, 10.3, 10.7)) * math.sin(t * 95)
        put(img, banner_spr("TIDE NETWORK: REFUSED"), 960 + shake, 560, lerp(1.6, 1.0, back(bu)), eo(bu * 2))


def m_rogue(img, d, sc, t, T):
    header(d, sc, t)
    xs, sy = (560, 960, 1360), 390
    rogue = eo(seg(t, 1.8, 2.3))
    for i, x in enumerate(xs):
        u = seg(t, 0.5 + 0.2 * i, 1.1 + 0.2 * i)
        if u <= 0:
            continue
        name, letter, c = INST[i]
        put(img, shield_spr(letter, c), x, sy, back(u), clamp(u * 3) * (1 - rogue if i == 0 else 1))
        if i == 0:
            put(img, glow_spr(AMBER, 300), x, sy, 1, 0.45 * rogue)
            put(img, shield_spr(letter, AMBER), x, sy, back(u), rogue)
        text(d, (x, sy + 100), name, 26, WHITE, "s", clamp(u * 2), "mm")
    chip(d, xs[0], sy + 142, "ROGUE STEWARD", AMBER, rogue, 20)
    # change request card slides out of the rogue's shield
    cu = eo(seg(t, 2.6, 3.3))
    if cu > 0:
        cx, cy = lerp(xs[0], 690, cu), lerp(sy, 730, cu)
        d.rounded_rectangle((cx - 270, cy - 78, cx + 270, cy + 78), radius=18, fill=rgba(PANEL, .96 * cu),
                            outline=rgba(AMBER, .8 * cu), width=3)
        text(d, (cx - 240, cy - 52), "CHANGE REQUEST", 20, MUTED, "b", cu)
        text(d, (cx - 240, cy - 22), "Give myself early access", 32, WHITE, "s", cu)
        text(d, (cx - 240, cy + 26), "+ _tide_decryptor  /rooms/alz", 22, VIOLET, "m", cu)
        chip(d, cx + 190, cy - 42, "PENDING", AMBER, eo(seg(t, 6.0, 6.4)), 17)
    # approval meter: 1 of 2, then it stalls
    mx, my, r = 1230, 730, 100
    mu = seg(t, 3.4, 3.9)
    su = eio(seg(t, 4.0, 4.6))
    if 0 < su < 1:
        dot(img, d, lerp(xs[0] + 40, mx - 60, su), lerp(sy + 60, my - 60, su) - 80 * math.sin(math.pi * su), AMBER)
    fill = 0.5 * eo(seg(t, 4.6, 5.8)) + (0.012 * math.sin(t * 7) if t > 6 else 0)
    if mu > 0:
        lay = Image.new("RGBA", (520, 520), (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        ld.ellipse((60, 60, 460, 460), outline=(44, 48, 96, 255), width=34)
        if fill > 0:
            ld.arc((60, 60, 460, 460), -90, -90 + 360 * fill, fill=(*AMBER, 255), width=34)
        put(img, lay.resize((260, 260), Image.LANCZOS), mx, my, back(mu), clamp(mu * 3))
        n = 1 if t >= 5.4 else 0
        pop = 1 + 0.3 * (1 - eo(seg(t, 5.4, 5.8))) if n else 1
        text(d, (mx, my - 8), f"{n} of 2", 46 * pop, AMBER if n else WHITE, "b", clamp(mu * 3), "mm")
        text(d, (mx, my + 36), "approvals", 20, MUTED, "b", clamp(mu * 3), "mm")
    if t > 6.0:
        p = ((t - 6.0) % 1.3) / 1.3
        rr = r + 22 + 46 * p
        d.ellipse((mx - rr, my - rr, mx + rr, my + rr), outline=rgba(AMBER, 0.7 * (1 - p) * seg(t, 6.0, 6.4)), width=5)
    text(d, (mx, my + 150), "waiting for a 2nd institution" + "." * (int(t * 2) % 4), 24, AMBER, "s",
         eo(seg(t, 6.8, 7.3)), "mm")
    # the room stays shut
    px, py = 1610, 715
    pu = seg(t, 3.6, 4.1)
    lock(img, px, py, 1.3 * back(pu), 0, VIOLET, clamp(pu * 3))
    text(d, (px, py + 115), "Room sealed", 24, MUTED, "s", clamp(pu * 2), "mm")
    xu = seg(t, 11.2, 11.55)
    put(img, big_x(), px, py, 0.9 * back(xu), clamp(xu * 3))
    text(d, (px, py + 160), "Nothing opens", 32, RED, "b", eo(seg(t, 11.6, 12.1)), "mm")


def m_unseal(img, d, sc, t, T):
    header(d, sc, t)
    xs, sy = (560, 960, 1360), 345
    vx, vy = 960, 770
    signs = {1: 2.6, 2: 4.2}  # Helix and St Aurelia co-sign, each in its own enclave
    for i, x in enumerate(xs):
        u = seg(t, 0.4 + 0.2 * i, 1.0 + 0.2 * i)
        if u <= 0:
            continue
        name, letter, c = INST[i]
        g = eo(seg(t, signs[i], signs[i] + 0.35)) if i in signs else 0
        put(img, glow_spr(GREEN, 300), x, sy, 1, 0.5 * g)
        put(img, shield_spr(letter, c), x, sy, back(u), clamp(u * 3) * (1 - g))
        put(img, shield_spr(letter, GREEN), x, sy, back(u), g)
        text(d, (x, sy + 100), name, 26, WHITE, "s", clamp(u * 2), "mm")
        if i in signs:
            bu = seg(t, signs[i] + 0.15, signs[i] + 0.55)
            put(img, badge("ok", 56), x + 52, sy + 52, back(bu), clamp(bu * 3))
            text(d, (x, sy + 132), "signed in its own Tide enclave", 20, GREEN, "s", eo(seg(t, signs[i] + .3, signs[i] + .8)), "mm")
            du = eio(seg(t, signs[i] + 0.3, signs[i] + 1.0))
            if 0 < du < 1:
                dot(img, d, lerp(x, vx, du), lerp(sy + 150, vy - 100, du), GREEN)
    ticks = [signs[i] + 1.0 for i in sorted(signs)]
    n = sum(t >= k for k in ticks)
    cu = eo(seg(t, 0.8, 1.4))
    pop = 1 + 0.3 * (1 - eo(seg(t, ticks[n - 1], ticks[n - 1] + 0.4))) if n else 1
    text(d, (520, vy - 14), f"{n} of 3", 84 * pop, GREEN if n >= 2 else WHITE, "b", cu, "mm")
    text(d, (520, vy + 52), "co-signed  ·  quorum is 2", 24, MUTED, "s", cu, "mm")
    # quorum -> vault opens -> every member gets it at once
    q = 6.6
    vu = seg(t, 0.6, 1.2)
    ou = seg(t, q + 0.6, q + 1.3)
    vault(img, d, vx, vy, 0.8 * back(vu), spin=120 * eio(seg(t, q, q + 0.6)), open_u=ou, a=clamp(vu * 3))
    ru = seg(t, q, q + 1.0)
    put(img, ring_spr(GREEN, 600, 6), vx, vy, lerp(0.4, 1.1, eo(ru)), 0.8 * (1 - ru) * (ru > 0))
    oc = eo(seg(t, q + 0.9, q + 1.3))
    chip(d, 1400, vy - 20, "SEALED", VIOLET, cu * (1 - oc), 26)
    chip(d, 1400, vy - 20, "OPEN", GREEN, oc, 26)
    text(d, (1400, vy + 40), "for every member, at once", 24, GREEN, "s", eo(seg(t, q + 2.4, q + 2.9)), "mm")
    fu = seg(t, q + 1.2, q + 2.2)
    if fu > 0:
        e = eo(fu)
        for x in xs:
            put(img, glow_spr(GREEN, 180), lerp(vx, x, e), lerp(vy, 568, e), 1, 0.5 * e)
            put(img, doc_spr(), lerp(vx, x, e), lerp(vy, 568, e), lerp(0.3, 0.72, e), clamp(fu * 3))


@lru_cache(None)
def key_slices(n=12):
    k = key_spr(VIOLET).resize((216, 86), Image.LANCZOS)
    sw = k.width / n
    return [(k.crop((round(j * sw), 0, round((j + 1) * sw), k.height)), (j + 0.5) * sw - k.width / 2) for j in range(n)]


def m_why(img, d, sc, t, T):
    header(d, sc, t)
    u = eio(seg(t, 0.5, 1.2))
    d.line((960, 280, 960, 280 + 610 * u), fill=rgba(ACCENT, .35), width=2)
    L, R, cy, r = 500, 1440, 600, 190
    dim = 1 - 0.45 * eo(seg(t, 5.8, 6.4))
    text(d, (L, 305), "Ordinary login", 40, WHITE, "b", eo(seg(t, 1.0, 1.5)) * dim, "mm")
    text(d, (R, 305), "TideCloak", 40, VIOLET, "b", eo(seg(t, 5.8, 6.3)), "mm")
    # left: one whole key, an admin checkbox, a promise
    ku = seg(t, 1.4, 2.0)
    put(img, key_spr(AMBER), L, 455, 0.9 * back(ku), dim * clamp(ku * 3))
    text(d, (L, 530), "one master key", 24, MUTED, "s", dim * eo(seg(t, 1.8, 2.3)), "mm")
    cu = eo(seg(t, 2.6, 3.1)) * dim
    bx, by = L - 230, 640
    d.rounded_rectangle((bx, by - 24, bx + 48, by + 24), radius=8, outline=rgba(SUB, cu), width=4)
    text(d, (bx + 70, by), "Admin can grant anyone access", 30, WHITE, "s", cu, "lm")
    tk = eio(seg(t, 3.6, 4.0))
    if tk > 0:
        p0, p1, p2 = (bx + 10, by + 2), (bx + 20, by + 13), (bx + 40, by - 13)
        a1, a2 = clamp(tk * 2), clamp(tk * 2 - 1)
        d.line((*p0, lerp(p0[0], p1[0], a1), lerp(p0[1], p1[1], a1)), fill=rgba(AMBER, dim), width=6)
        if a2 > 0:
            d.line((*p1, lerp(p1[0], p2[0], a2), lerp(p1[1], p2[1], a2)), fill=rgba(AMBER, dim), width=6)
    pu = eo(seg(t, 4.8, 5.4))
    text(d, (L, 770 + 12 * (1 - pu)), "\u2026and a promise.", 44, AMBER, "s", pu * dim, "mm")
    # right: the key is split across a ring of nodes
    pos = [(R + r * math.cos(math.radians(-90 + 30 * n)), cy + r * math.sin(math.radians(-90 + 30 * n))) for n in range(12)]
    arrive = [7.4 + 0.05 * n + 0.8 for n in range(12)]
    wave_on = 9.6 <= t < 12.8
    quorum = eo(seg(t, 14.2, 14.6))
    for n, (x, y) in enumerate(pos):
        nu = seg(t, 6.0 + 0.05 * n, 6.4 + 0.05 * n)
        if nu <= 0:
            continue
        lit = eo(seg(t, arrive[n], arrive[n] + 0.25))
        wv = max(0.0, 1 - ((t - 9.6) * 6 - n) % 12 / 3) * seg(t, 9.6, 9.9) * (1 - seg(t, 12.5, 12.8)) if wave_on else 0
        c = mix(mix(mix((70, 74, 140), VIOLET, lit), GREEN, wv), GREEN, quorum)
        put(img, glow_spr(c, 110), x, y, 1, 0.55 * max(lit * 0.6, wv, quorum))
        put(img, node_spr(c, 40), x, y, back(nu), clamp(nu * 3))
    ku = seg(t, 6.3, 6.8)
    if t < 7.4:
        put(img, key_spr(VIOLET), R, cy, 0.9 * back(ku), clamp(ku * 3))
    else:
        for j, (strip, ox) in enumerate(key_slices()):
            fu = eio(seg(t, 7.4 + 0.05 * j, arrive[j]))
            if fu < 1:
                put(img, strip, lerp(R + ox * (1 + 0.15 * clamp(fu * 4)), pos[j][0], fu), lerp(cy, pos[j][1], fu),
                    lerp(1.2, 0.7, fu), 1 - seg(fu, 0.8, 1))
    text(d, (R, 850), "No single party holds the key", 32, WHITE, "s", eo(seg(t, 8.4, 8.9)), "mm")
    wl = eo(seg(t, 9.8, 10.2)) * (1 - eo(seg(t, 12.6, 12.9)))
    text(d, (R, 893), "Nodes check membership on every request", 24, GREEN, "s", wl, "mm")
    text(d, (R, 893), "Access changes only by a quorum of enclave signatures", 24, VIOLET, "s",
         eo(seg(t, 12.9, 13.3)), "mm")
    # quorum: two of three institution enclaves sign
    for i in range(3):
        su = seg(t, 12.8 + 0.1 * i, 13.2 + 0.1 * i)
        x = R + (i - 1) * 64
        put(img, shield_spr(INST[i][1], INST[i][2]), x, cy, 0.4 * back(su), clamp(su * 3))
        if i:
            g = seg(t, 13.0 + 0.4 * i, 13.35 + 0.4 * i)
            put(img, shield_spr(INST[i][1], GREEN), x, cy, 0.4, eo(g))
            put(img, badge("ok", 30), x + 20, cy + 22, back(g), clamp(g * 3))


def m_close(img, d, sc, t, T):
    cx, cy = 960, 330
    u = seg(t, 0.2, 1.0)
    put(img, glow_spr(ACCENT, 760), cx, cy, 1, 0.5 * eo(u) * (0.85 + 0.15 * math.sin(t * 2)))
    for n in range(12):
        a = math.radians(30 * n + t * 12)
        put(img, node_spr(VIOLET, 26), cx + 150 * math.cos(a), cy + 150 * math.sin(a),
            back(seg(t, 0.5 + .04 * n, 0.9 + .04 * n)), clamp(seg(t, 0.5 + .04 * n, 0.9 + .04 * n) * 3))
    put(img, ring_spr(ACCENT, 220, 8), cx, cy, back(u), clamp(u * 3))
    lock(img, cx, cy - 6, 1.1 * back(seg(t, 0.4, 1.1)), 0, VIOLET, clamp(seg(t, 0.4, 1.1) * 3))
    words_in(d, "Treaty Room", 120, cx, 500, t, 0.9, center=True, stagger=0.18, dur=0.6)
    bu = eio(seg(t, 1.5, 2.1))
    if bu > 0:
        d.rounded_rectangle((cx - 170 * bu, 664, cx + 170 * bu, 670), radius=3, fill=ACCENT)
    words_in(d, sc.get("subtitle") or "We built it, and we can't read it or open it alone.", 46, cx, 700, t, 1.8,
             c=SUB, w="s", center=True, stagger=0.07, max_w=1700)
    fu = eo(seg(t, 5.6, 6.3))
    text(d, (cx, 850 + 10 * (1 - fu)), "Sunway PowerRanger  \u00b7  Built with TideCloak  \u00b7  All data synthetic",
         30, MUTED, "s", fu, "mm")
    if sc.get("note"):
        nu = eo(seg(t, 3.0, 3.6))
        for j, ln in enumerate(balanced(sc["note"], F(26, "s"), 1500)):
            text(d, (cx, 935 + 38 * j), ln, 26, AMBER, "s", nu, "mm")


@lru_cache(4)
def load_img(path):
    return Image.open(path).convert("RGB")


def clip_box(box, lim):
    x0, y0, x1, y1 = max(box[0], lim[0]), max(box[1], lim[1]), min(box[2], lim[2]), min(box[3], lim[3])
    return (x0, y0, x1, y1) if x1 > x0 and y1 > y0 else None


def m_image(img, d, sc, t, T):
    header(d, sc, t)
    src = load_img(sc["_path"])
    sw, sh = src.size
    top = 250 if sc.get("title") or sc.get("kicker") else 140
    bw, bh = W - 160, H - 225 - top  # keep clear of a 2-line caption pill
    s0 = min(bw / sw, bh / sh)
    dw, dh = round(sw * s0), round(sh * s0)
    dx, dy = round((W - dw) / 2), round(top + (bh - dh) / 2)
    p = eio(t / T)
    z = 1 + sc.get("zoom", 0.08) * p
    cos = sc.get("callouts") or []
    fx, fy = sc.get("focus") or ((sum(c["x"] + c["w"] / 2 for c in cos) / len(cos),
                                  sum(c["y"] + c["h"] / 2 for c in cos) / len(cos)) if cos else (sw / 2, sh / 2))
    vw, vh = sw / z, sh / z
    cx = min(max(lerp(sw / 2, fx, p), vw / 2), sw - vw / 2)
    cy = min(max(lerp(sh / 2, fy, p), vh / 2), sh - vh / 2)
    bx0, by0 = cx - vw / 2, cy - vh / 2
    d.rounded_rectangle((dx - 10, dy - 10, dx + dw + 10, dy + dh + 10), radius=18, fill=(0, 0, 0, 110))
    img.paste(src.resize((dw, dh), Image.BICUBIC, box=(bx0, by0, bx0 + vw, by0 + vh)), (dx, dy))
    d.rectangle((dx - 1, dy - 1, dx + dw + 1, dy + dh + 1), outline=rgba(ACCENT, .5), width=2)

    def m(x, y):
        return dx + (x - bx0) * dw / vw, dy + (y - by0) * dh / vh

    area = (dx, dy, dx + dw, dy + dh)
    live = [c for c in cos if t >= c.get("at", 0)]
    if live:  # spotlight the newest callout
        c = live[-1]
        u = eo(seg(t, c.get("at", 0), c.get("at", 0) + 0.5))
        (x0, y0), (x1, y1) = m(c["x"], c["y"]), m(c["x"] + c["w"], c["y"] + c["h"])
        for b in ((dx, dy, dx + dw, y0), (dx, y1, dx + dw, dy + dh), (dx, y0, x0, y1), (x1, y0, dx + dw, y1)):
            b = clip_box(b, area)
            if b:
                d.rectangle(b, fill=(5, 6, 20, round(125 * u)))
    for c in live:
        at = c.get("at", 0)
        u = eo(seg(t, at, at + 0.5))
        col = COLORS.get(c.get("color"), VIOLET)
        (x0, y0), (x1, y1) = m(c["x"], c["y"]), m(c["x"] + c["w"], c["y"] + c["h"])
        g = (1 - u) * 24 + 6
        d.rounded_rectangle((x0 - g, y0 - g, x1 + g, y1 + g), radius=10, outline=rgba(col, u), width=5)
        if c.get("label"):
            f = F(28, "s")
            lw = f.getlength(c["label"])
            ly = y0 - 62 if y0 - 62 > top - 30 else y1 + 16
            lx = min(max(x0 - 6, 20), W - lw - 60)
            oy = (1 - u) * 10
            d.rounded_rectangle((lx, ly + oy, lx + lw + 32, ly + 46 + oy), radius=10, fill=rgba(col, .95 * u))
            d.text((lx + 16, ly + 23 + oy), c["label"], font=f, fill=rgba(INK, u), anchor="lm")


def shade(d, y0, y1, a):
    """Vertical dark gradient band (transparent at y0, opaque-ish at y1) so text reads over footage."""
    n = 24
    for j in range(n):
        ya, yb = lerp(y0, y1, j / n), lerp(y0, y1, (j + 1) / n)
        d.rectangle((0, min(ya, yb), W, max(ya, yb)), fill=(6, 7, 20, round(190 * a * (j + 1) / n)))


def m_title(img, d, sc, t, T):  # big centred title over a clip
    shade(d, 560, 860, eo(seg(t, 0.2, 0.9)))
    d.rectangle((0, 860, W, H), fill=(6, 7, 20, round(190 * eo(seg(t, 0.2, 0.9)))))
    words_in(d, sc.get("title", ""), 120, W / 2, 770, t, 0.5, center=True, stagger=0.15, dur=0.6)
    if sc.get("subtitle"):
        words_in(d, sc["subtitle"], 46, W / 2, 925, t, 1.2, c=SUB, w="s", center=True, stagger=0.07)


def m_header(img, d, sc, t, T):  # kicker + title, top-left, over a clip
    shade(d, 300, 0, eo(seg(t, 0.0, 0.6)))
    header(d, sc, t)


MOTIONS = {"hook": m_hook, "constraint": m_constraint, "solution": m_solution, "host-view": m_host_view,
           "rogue-steward": m_rogue, "unseal": m_unseal, "why-tidecloak": m_why, "close": m_close, "image": m_image,
           "title": m_title, "header": m_header, "clip": lambda *a: None}


# ---------------------------------------------------------------- video clips (screen recordings, Blender shots)
def probe_dur(path):
    r = subprocess.run([find_ffmpeg(), "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace")
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    if not m:
        sys.exit(f"cannot read duration of {path}")
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


def fit_speed(free, room):
    """Common speed for the un-pinned segments: fill `room` seconds, but stay within 0.8x..2.2x."""
    return min(max(free / max(room, 0.1), 0.8), 2.2)


def prepare_clip(sc, n_target):
    """Trim + speed-fit the scene's clip segments to n_target frames, cached as a JPEG sequence.
    Too short even at 0.8x: the last frame holds. Too long even at 2.2x: the start is dropped (results come last)."""
    segs = [(s["_src"], float(s.get("in", 0)), float(s.get("out") or probe_dur(s["_src"])), s.get("speed"))
            for s in sc["_segs"]]
    fixed = sum((b - a) / sp for _, a, b, sp in segs if sp)
    free = sum(b - a for _, a, b, sp in segs if not sp)
    speed = fit_speed(free, n_target / FPS - fixed) if free else 1.0
    z = sc.get("clip_scale", 1.0)  # < 1: top-aligned and shrunk, leaving a band for captions below
    sw, sh = round(W * z) // 2 * 2, round(H * z) // 2 * 2
    key = hashlib.sha1(json.dumps([segs, speed, z, [os.path.getmtime(s[0]) for s in segs]]).encode()).hexdigest()[:16]
    d = CACHE / "clips" / key
    if not (d / "done").exists():
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        args, graph = [find_ffmpeg(), "-v", "error", "-y"], []
        for i, (src, a, b, sp) in enumerate(segs):
            args += ["-i", src]
            graph.append(f"[{i}:v]trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{sp or speed},fps={FPS},"
                         f"scale={sw}:{sh}:force_original_aspect_ratio=decrease,"
                         f"pad={W}:{H}:(ow-iw)/2:{0 if z < 1 else '(oh-ih)/2'}:color=0x090a1c,setsar=1[s{i}]")
        graph.append("".join(f"[s{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=0[v]")
        subprocess.run(args + ["-filter_complex", ";".join(graph), "-map", "[v]", "-q:v", "3", str(d / "%05d.jpg")],
                       check=True)
        (d / "done").write_text("ok")
    files = sorted(str(p) for p in d.glob("*.jpg"))
    print(f"  clip {sc['id']:<10} {free + sum(b - a for _, a, b, sp in segs if sp):5.1f}s source, free segments at "
          f"{speed:.2f}x -> {len(files) / FPS:.1f}s for {n_target / FPS:.1f}s"
          + ("  (start dropped)" if len(files) > n_target else ""))
    return files[-n_target:] if len(files) > n_target else files


def m_clip(img, sc, t):
    files, at = sc["_clipframes"], sc.get("clip_at", 0)
    k = round((t - at) * FPS)
    if k >= 0 and files:
        f = Image.open(files[min(k, len(files) - 1)]).convert("RGB")
        a = eo(seg(t, at, at + 0.4)) if at > 0 else 1.0
        img.paste(f if a >= 1 else Image.blend(img, f, a))


def corner_tag(d, s):
    """Compact tag in the top-left margin; "Head: rest" is drawn as two lines."""
    head, _, rest = s.partition(": ")
    f1, f2 = F(15, "b"), F(19, "s")
    w = max(f1.getlength(head.upper()), f2.getlength(rest)) + 44
    d.rounded_rectangle((18, 18, 18 + w, 76 if rest else 52), radius=12, fill=(8, 9, 26, 220),
                        outline=rgba(AMBER, .75), width=2)
    d.ellipse((32, 31, 42, 41), fill=AMBER)
    d.text((50, 36), head.upper(), font=f1, fill=AMBER, anchor="lm")
    if rest:
        d.text((32, 60), rest, font=f2, fill=WHITE, anchor="lm")


# ---------------------------------------------------------------- frame assembly
CTX = None


def _init(ctx):
    global CTX
    CTX = ctx


def scene_frame(ctx, i, k):
    sc = ctx["scenes"][i]
    t, T = k / FPS, ctx["frames"][i] / FPS
    img, d = background((ctx["starts"][i] + k) / FPS)
    clip = "_clipframes" in sc
    if clip:
        m_clip(img, sc, t)
    if not clip or sc.get("clip_overlay", False):
        MOTIONS[sc["_motion"]](img, d, sc, t * max(1.0, DESIGN.get(sc["_motion"], 0) / T), T)
    if sc["_motion"] != "close" and not clip:
        text(d, (W - 90, 100), "TREATY ROOM", 22, MUTED, "s", 0.9, "ra")
    if sc.get("tag"):
        corner_tag(d, sc["tag"])
    caps = [c for c in sc["_caps"] if c[0] <= k]
    if caps:
        pill(d, caps[-1][1], t, caps[-1][0] / FPS, 0.45 if len(caps) == 1 else 0.2)
    return img


def compose(ctx, g):
    starts = ctx["starts"]
    i = bisect.bisect_right(starts, g) - 1
    k = g - starts[i]
    img = scene_frame(ctx, i, k)
    if i > 0 and k < FADE_F:  # 0.4 s crossfade: previous scene runs on underneath
        img = Image.blend(scene_frame(ctx, i - 1, ctx["frames"][i - 1] + k), img, (k + 1) / (FADE_F + 1))
    d = ImageDraw.Draw(img, "RGBA")
    d.rectangle((0, H - 5, W * (g + 1) / ctx["total"], H), fill=rgba(ACCENT, .75))
    fade = max(1 - g / 12, (g - (ctx["total"] - 24)) / 24, 0)
    tint(d, (0, 0, 0), min(fade, 1))
    return img


def frame_bytes(g):
    return compose(CTX, g).tobytes()


# ---------------------------------------------------------------- narration (offline Windows TTS) + ffmpeg
def ps(script, **env):
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], env={**os.environ, **env},
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        raise RuntimeError(f"PowerShell failed:\n{r.stderr}")
    return r.stdout


def pick_voice():
    if os.environ.get("TTS_VOICE"):
        return os.environ["TTS_VOICE"]
    names = [n.strip() for n in ps(PS_VOICES).splitlines() if n.strip()]
    for pref in ("Natural", "Zira", "David"):
        for n in names:
            if pref in n:
                return n
    return names[0]


def synth(jobs, voice, rate):
    if not jobs:
        return
    print(f"synthesizing {len(jobs)} narration clip(s)...")
    job_file = CACHE / "tts_jobs.json"
    job_file.write_text(json.dumps(jobs), encoding="utf-8")
    try:
        ps(PS_SPEAK, TTS_JOBS=str(job_file), TTS_VOICE=voice, TTS_RATE=str(rate))
    except Exception:
        for j in jobs:  # don't leave half-written clips in the cache
            Path(j["out"]).unlink(missing_ok=True)
        raise


def find_ffmpeg():
    for c in (os.environ.get("FFMPEG"), ROOT / "bin" / "ffmpeg.exe", shutil.which("ffmpeg")):
        if c and Path(c).exists():
            return str(c)
    sys.exit("ffmpeg not found: put ffmpeg.exe in video/bin/ or set FFMPEG")


def sapi_lines(texts):
    voice, rate = pick_voice(), int(os.environ.get("TTS_RATE", "0"))
    print(f"voice:  {voice} (System.Speech, rate {rate})")
    (CACHE / "tts").mkdir(parents=True, exist_ok=True)
    wavs = [CACHE / "tts" / f"{hashlib.sha1(f'{voice}|{rate}|{t}'.encode()).hexdigest()[:16]}.wav" if t else None
            for t in texts]
    synth([{"text": t, "out": str(p)} for t, p in zip(texts, wavs) if p and not p.exists()], voice, rate)
    return wavs


def gh(*args):
    r = subprocess.run(["gh", "codespace", *args], capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=600)
    if r.returncode:
        raise RuntimeError(f"gh codespace {args[0]} failed: {r.stderr.strip()[-400:]}")


def edge_lines(texts):
    voice, rate = os.environ.get("VOICE", EDGE_VOICE), os.environ.get("TTS_RATE", EDGE_RATE)
    cs = os.environ.get("CODESPACE", CODESPACE)
    print(f"voice:  {voice} (edge-tts, rate {rate})")
    vd = CACHE / "voice"
    vd.mkdir(parents=True, exist_ok=True)
    said = list(texts)
    for a, b in SAY.items():
        said = [t.replace(a, b) for t in said]
    keys = [hashlib.sha1(f"edge|{voice}|{rate}|{t}".encode()).hexdigest()[:16] if t else None for t in said]
    todo = {k: t for k, t in zip(keys, said) if k and not (vd / f"{k}.wav").exists()}
    if todo:
        print(f"edge-tts: {len(todo)} line(s) via codespace {cs}...")
        sh = vd / "edge_jobs.sh"
        sh.write_bytes((EDGE_SH % (json.dumps([{"text": t, "name": f"{k}.mp3"} for k, t in todo.items()]), voice, rate))
                       .encode())
        gh("cp", "-c", cs, str(sh), "remote:/tmp/treaty-voice.sh")
        gh("ssh", "-c", cs, "--", "bash /tmp/treaty-voice.sh")
        gh("cp", "-c", cs, "remote:/tmp/treaty-voice/all.tar", str(vd / "all.tar"))
        with tarfile.open(vd / "all.tar") as tf:
            tf.extractall(vd, members=[m for m in tf.getmembers() if m.name.removesuffix(".mp3") in todo], filter="data")
        for k in todo:  # decode once so durations can be read with the wave module
            subprocess.run([find_ffmpeg(), "-v", "error", "-y", "-i", str(vd / f"{k}.mp3"), "-ac", "1", "-ar", "24000",
                            str(vd / f"{k}.wav")], check=True)
    return [vd / f"{k}.wav" if k else None for k in keys]


def narrate(texts):
    if os.environ.get("TTS_ENGINE", "edge").lower() == "edge":
        try:
            return edge_lines(texts)
        except Exception as e:  # ponytail: whole-run fallback, so one video never mixes two voices
            print(f"WARNING: edge-tts failed ({e}); falling back to System.Speech")
    return sapi_lines(texts)


def make_music(path, seconds, sr=48000):
    """Soft evolving pad: Am-F-C-G, two layers crossfading every 4 s (sin^2 + cos^2 = constant level)."""
    t = np.arange(int(seconds * sr)) / sr
    chords = np.array([(110.0, 220.0, 261.63, 329.63), (87.31, 174.61, 220.0, 261.63),
                       (130.81, 196.0, 261.63, 329.63), (98.0, 196.0, 246.94, 293.66)])
    out, L = np.zeros((len(t), 2)), 8.0
    for off in (0.0, L / 2):
        idx = (np.floor((t + off) / L).astype(int)) % 4
        env = np.sin(np.pi * ((t + off) % L) / L) ** 2  # zero exactly where the chord changes: no clicks
        for n in range(4):
            f = chords[idx, n]
            for det, pan in ((1.0, 0.3), (1.0035, 0.7)):
                s = np.sin(2 * np.pi * f * det * t) * env * (0.45 if n == 0 else 0.25 / (1 + n * 0.3))
                out[:, 0] += s * (1 - pan)
                out[:, 1] += s * pan
    out *= (0.85 + 0.15 * np.sin(2 * np.pi * 0.07 * t))[:, None]
    fade = np.minimum(1, np.minimum(t / 2.5, (seconds - t) / 3.5)).clip(0)[:, None]
    out = out * fade / np.abs(out).max() * 10 ** (-12 / 20)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((out * 32767).astype("<i2").tobytes())


def plan(sb):
    """Storyboard -> render context (scene timing, captions) + narration wavs."""
    scenes = json.loads(sb.read_text(encoding="utf-8"))
    ids = [sc.get("id") or f"scene{i + 1}" for i, sc in enumerate(scenes)]
    assert len(set(ids)) == len(ids), f"duplicate scene ids: {ids}"
    texts = [(sc.get("narration") or "").strip() for sc in scenes]
    wavs = narrate(texts)
    speech = []
    for p in wavs:
        if p:
            with wave.open(str(p)) as w:
                speech.append(w.getnframes() / w.getframerate())
        else:
            speech.append(0.0)
    frames = [math.ceil(max(sc.get("min_seconds") or 0, s + PAD) * FPS) for sc, s in zip(scenes, speech)]
    cap_font = F(40, "s")
    for sc, sid, txt, sp, nf in zip(scenes, ids, texts, speech, frames):
        sc["id"] = sid
        sc["_motion"] = sc.get("motion") or ("image" if sc.get("image") else "clip" if sc.get("clip") else sid)
        if sc["_motion"] not in MOTIONS:
            sys.exit(f"scene {sid}: unknown motion {sc['_motion']!r}; one of {', '.join(MOTIONS)}")
        if sc.get("image"):
            sc["_path"] = str((sb.parent / sc["image"]).resolve())
        clip = sc.get("clip")
        if clip:  # "clip": "a.mp4" (+ clip_in/clip_out), or a list of {"src", "in", "out", "speed"} segments
            sc["_segs"] = [{"src": clip, "in": sc.get("clip_in", 0), "out": sc.get("clip_out")}] \
                if isinstance(clip, str) else [dict(s) for s in clip]
            for s in sc["_segs"]:
                s["_src"] = str((sb.parent / s["src"]).resolve())
        for p in [sc.get("_path")] + [s["_src"] for s in sc.get("_segs", [])]:
            if p and not Path(p).exists():
                sys.exit(f"scene {sid}: file not found: {p}")
        if sc.get("_segs"):
            sc["_clipframes"] = prepare_clip(sc, nf - round(sc.get("clip_at", 0) * FPS) - round(sc.get("clip_hold", 0) * FPS))
        if sc["_motion"] == "image" and not sc.get("_path"):
            sys.exit(f"scene {sid}: motion 'image' needs an image")
        caps = sc.get("caption")
        if caps is None and sc["_motion"] == "image" and txt and sc.get("captions", True):
            caps = caption_chunks(txt, cap_font)
        caps = [caps] if isinstance(caps, str) else (caps or [])
        lens = split_frames(nf, round(sp * FPS), [len(c) for c in caps]) if caps else []
        starts = [sum(lens[:j]) for j in range(len(caps))]
        sc["_caps"] = [(max(s, round(0.6 * FPS)) if j == 0 else s, c) for j, (s, c) in enumerate(zip(starts, caps))]
    ctx = {"scenes": scenes, "frames": frames, "starts": [sum(frames[:i]) for i in range(len(frames))],
           "total": sum(frames)}
    return ctx, wavs


def build_audio(ff, wavs, frames):
    out = CACHE / "narration.wav"
    args, graph, n_in = [ff, "-y", "-hide_banner", "-loglevel", "error"], [], 0
    for i, (wv, nf) in enumerate(zip(wavs, frames)):
        dur = nf / FPS
        if wv:
            args += ["-i", str(wv)]
            graph.append(f"[{n_in}:a]aresample=48000,apad=whole_dur={dur:.6f},atrim=duration={dur:.6f}[a{i}]")
            n_in += 1
        else:
            graph.append(f"anullsrc=r=48000:cl=mono:d={dur:.6f}[a{i}]")
    vo = "".join(f"[a{i}]" for i in range(len(frames))) + f"concat=n={len(frames)}:v=0:a=1," \
         "loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo"
    if os.environ.get("MUSIC", "1") == "0":
        graph.append(vo + "[a]")
    else:  # pad about 20 dB under the voice, ducked a further ~6 dB while the voice speaks
        make_music(CACHE / "music.wav", sum(frames) / FPS)
        args += ["-i", str(CACHE / "music.wav")]
        graph += [vo + ",asplit[v1][v2]",
                  f"[{n_in}:a]lowpass=f=1400,volume=-17dB[m]",
                  "[m][v2]sidechaincompress=threshold=0.02:ratio=4:attack=60:release=700:makeup=1[md]",
                  "[v1][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89[a]"]
    subprocess.run(args + ["-filter_complex", ";".join(graph), "-map", "[a]", "-c:a", "pcm_s16le", str(out)], check=True)
    return out


def main(sb):
    ff = find_ffmpeg()
    ctx, wavs = plan(sb)
    audio = build_audio(ff, wavs, ctx["frames"])
    out_file = OUT_DIR / f"video{sb.stem.removeprefix('storyboard')}.mp4"
    out_file.parent.mkdir(exist_ok=True)
    total, workers = ctx["total"], int(os.environ.get("WORKERS", max(1, (os.cpu_count() or 2) - 2)))
    print(f"rendering {total} frames ({total / FPS:.1f}s) with {workers} workers...")
    args = [ff, "-y", "-hide_banner", "-loglevel", "error", "-stats",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-framerate", str(FPS), "-i", "-",
            "-i", str(audio), "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-tune", "animation", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out_file)]
    t0 = time.time()
    enc = subprocess.Popen(args, stdin=subprocess.PIPE)
    try:
        with Pool(workers, initializer=_init, initargs=(ctx,)) as pool:
            for buf in pool.imap(frame_bytes, range(total), chunksize=4):
                enc.stdin.write(buf)
    finally:
        enc.stdin.close()
        enc.wait()
    if enc.returncode:
        sys.exit(f"ffmpeg failed ({enc.returncode})")
    t = 0
    for sc, f in zip(ctx["scenes"], ctx["frames"]):
        print(f"  {sc['id']:<18} {int(t // 60)}:{t % 60:05.2f}  {f / FPS:5.2f}s  [{sc['_motion']}]")
        t += f / FPS
    size = out_file.stat().st_size / 1e6
    print(f"{out_file}\nduration {int(t // 60)}:{t % 60:05.2f} ({t:.1f}s), size {size:.1f} MB, "
          f"render {time.time() - t0:.0f}s")
    if t > 120:
        print(f"WARNING: {t:.1f}s is over 120s")
    if size > 100:
        print(f"WARNING: {size:.1f} MB is over 100 MB")


def stills(sb):
    """4 frames per scene (at 20/45/70/97 %) as a 2x2 contact sheet in video/out/stills/."""
    ctx, _ = plan(sb)
    out = OUT_DIR / "stills"
    out.mkdir(parents=True, exist_ok=True)
    only = os.environ.get("SCENE")
    for i, sc in enumerate(ctx["scenes"]):
        if only and sc["id"] != only:
            continue
        sheet = Image.new("RGB", (W, H))
        for j, p in enumerate((0.2, 0.45, 0.7, 0.97)):
            k = int(ctx["frames"][i] * p)
            sheet.paste(scene_frame(ctx, i, k).resize((W // 2, H // 2), Image.LANCZOS), ((j % 2) * W // 2, (j // 2) * H // 2))
        sheet.save(out / f"{i + 1:02d}_{sc['id']}.png")
        print(out / f"{i + 1:02d}_{sc['id']}.png")


if __name__ == "__main__":
    argv = sys.argv[1:]
    if argv == ["--selftest"]:
        assert split_frames(100, 60, [1, 1, 2]) == [15, 15, 70]
        assert split_frames(10, 0, [5, 5]) == [1, 9]  # never a zero-frame chunk
        f = F(40, "s")
        long = "This is a fairly long sentence that should need more than one line of caption text. " * 3
        assert all(len(wrap(c, f, CAP_W)) <= 2 for c in caption_chunks(long + "Short one.", f))
        assert eo(0) == 0 and eo(1) == 1 and eio(0.5) == 0.5 and abs(back(0)) < 1e-9 and abs(back(1) - 1) < 1e-9
        assert back(0.7) > 1  # overshoot
        print("selftest ok")
    elif argv[:1] == ["--voice"]:  # narration only (no clips needed): generate + print durations
        p = Path(argv[1]).resolve() if len(argv) > 1 else ROOT / "storyboard.json"
        scs = json.loads(p.read_text(encoding="utf-8"))
        tot = 0
        for sc, wv in zip(scs, narrate([(s.get("narration") or "").strip() for s in scs])):
            with wave.open(str(wv)) as w:
                s = w.getnframes() / w.getframerate()
            n = max(sc.get("min_seconds") or 0, s + PAD)
            tot += n
            print(f"  {sc['id']:<10} speech {s:5.2f}s  scene {n:5.2f}s")
        print(f"total {tot:.1f}s")
    elif argv[:1] == ["--stills"]:
        stills(Path(argv[1]).resolve() if len(argv) > 1 else ROOT / "storyboard.json")
    else:
        main(Path(argv[0]).resolve() if argv else ROOT / "storyboard.json")

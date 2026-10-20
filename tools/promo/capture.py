"""Record the promo video: serves the game locally, plays it with an autopilot on a virtual
30 fps clock (tools/promo/director.js), screenshots every frame, then encodes MP4 + per-shot GIFs.

Usage:  python tools/promo/capture.py            # full capture -> tools/promo/out/
        python tools/promo/capture.py --probe    # no frames, just print how each shot plays out
Needs: playwright (python) with its Chromium, ffmpeg on PATH. Nothing leaves the machine.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import subprocess
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
FRAMES = OUT / "frames"
W, H, FPS = 1280, 720, 30
GIF_NAMES = ["tilt", "crosseye", "anaglyph", "smartglasses", "route-guide", "inside", "finale", "endcard"]


def serve() -> int:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a: object) -> None: ...
    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    opts = ap.parse_args()

    port = serve()
    if not opts.probe:
        FRAMES.mkdir(parents=True, exist_ok=True)  # OneDrive can hold the folder open: clear files, keep the dir
        for f in FRAMES.glob("f*.png"):
            f.unlink()

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1, service_workers="block")
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_function("window.app && window.app.renderer")
        page.add_script_tag(path=str(HERE / "director.js"))
        total = page.evaluate("__director.totalFrames")
        starts = page.evaluate("__director.shotStarts")
        print(f"{total} frames ({total / FPS:.1f}s), shots at {starts}")

        for i in range(total):
            page.evaluate("__director.step()")
            if i + 1 in starts or i == total - 1:
                print(f"  frame {i + 1}: {page.evaluate('__director.status()')}")
            if not opts.probe:
                page.screenshot(path=str(FRAMES / f"f{i:05d}.png"))
            elif i % 30 == 0:
                print(f"    t={i / FPS:4.1f}s {page.evaluate('__director.status()')}")
        if errors:
            print("PAGE ERRORS:", *errors, sep="\n  ")
        browser.close()

    if opts.probe:
        return
    mp4 = OUT / "3d-labyrinth-promo.mp4"
    ffmpeg("-framerate", str(FPS), "-i", str(FRAMES / "f%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p",
           "-crf", "18", "-preset", "slow", "-movflags", "+faststart", str(mp4))
    print("wrote", mp4)
    bounds = starts + [total]
    for name, a, b in zip(GIF_NAMES, bounds, bounds[1:]):
        gif = OUT / f"{name}.gif"
        ffmpeg("-framerate", str(FPS), "-start_number", str(a), "-i", str(FRAMES / "f%05d.png"),
               "-frames:v", str(b - a), "-vf",
               "fps=15,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
               str(gif))
        print("wrote", gif)


if __name__ == "__main__":
    main()

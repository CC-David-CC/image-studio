"""Image Studio's optional signed WebOS gateway operation."""
import base64
import json
import os
import struct
import subprocess
from pathlib import Path
from .render import MAX_OUTPUT, validate

def render_image(payload):
    validate(payload)
    command = os.environ.get("WEBOS_IMAGE_RENDER_COMMAND")
    if not command or not Path(command).is_absolute():
        raise RuntimeError("Image worker unavailable")
    try:
        proc = subprocess.run([command], input=json.dumps(payload).encode(), stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, timeout=240, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ConnectionError("Worker exit unconfirmed") from exc
    if proc.returncode == 255 or proc.returncode < 0:
        raise ConnectionError("Worker exit unconfirmed")
    png = proc.stdout
    if proc.returncode or not 24 <= len(png) <= MAX_OUTPUT or png[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR":
        raise RuntimeError("Image renderer failed")
    width, height = struct.unpack(">II", png[16:24])
    if max(width, height) > 2048 or min(width, height) < 1:
        raise RuntimeError("Invalid image dimensions")
    return {"png": base64.b64encode(png).decode("ascii"), "seed": payload["seed"]}

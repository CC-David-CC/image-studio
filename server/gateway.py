"""Image Studio's optional signed WebOS gateway operation."""
import base64
import json
import os
import struct
import subprocess
import threading
from pathlib import Path
from webos_storage.http import FileGateway
from webos_storage.policy import Denied
from webos_storage.transfers import AllowanceExceeded
from .render import MAX_OUTPUT, validate

class ImageGateway(FileGateway):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.render_slot = threading.BoundedSemaphore(1)

    def _dispatch(self, principal, request):
        if request.get("resource") != "image-studio":
            return super()._dispatch(principal, request)
        owner = os.environ.get("WEBOS_IMAGE_OWNER_SUB")
        command = os.environ.get("WEBOS_IMAGE_RENDER_COMMAND")
        if principal.kind != "registered" or not owner or principal.sub != owner:
            raise Denied("Image generation unavailable for this account")
        if not command or not Path(command).is_absolute():
            raise RuntimeError("Image worker unavailable")
        if request.get("operation") != "image-render":
            raise Denied("Unknown image operation")
        payload = {k: v for k, v in request.items() if k not in ("resource", "operation")}
        validate(payload)
        if not self.render_slot.acquire(blocking=False):
            raise AllowanceExceeded("Image worker busy")
        try:
            # The administrator installs a fixed local program or restricted SSH wrapper.
            # User text and image bytes are transferred only over stdin.
            proc = subprocess.run([command], input=json.dumps(payload).encode(), stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, timeout=240, check=False)
            png = proc.stdout
            if proc.returncode or not 24 <= len(png) <= MAX_OUTPUT or png[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR":
                raise RuntimeError("Image renderer failed")
            width, height = struct.unpack(">II", png[16:24])
            if max(width, height) > 2048 or min(width, height) < 1:
                raise RuntimeError("Invalid image dimensions")
            return {"png": base64.b64encode(png).decode("ascii"), "seed": payload["seed"]}
        finally:
            self.render_slot.release()

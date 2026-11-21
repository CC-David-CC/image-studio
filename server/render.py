"""Read one bounded image request from stdin and write one PNG to stdout."""
import base64
import io
import json
import os
import sys
from pathlib import Path

MODEL_REVISION = "e7b7dc27f91deacad38e78976d1f2b499d76a294"
MAX_INPUT = 6 * 1024 * 1024
MAX_REFERENCE = 4 * 1024 * 1024
MAX_OUTPUT = 5 * 1024 * 1024

def validate(request):
    if not isinstance(request, dict) or set(request) != {"prompt", "reference", "size", "seed"}:
        raise ValueError("Invalid image request")
    if not isinstance(request["prompt"], str) or not 1 <= len(request["prompt"].strip()) <= 2000:
        raise ValueError("Enter a prompt of up to 2000 characters")
    if type(request["size"]) is not int or request["size"] not in (512, 768, 1024):
        raise ValueError("Unsupported image dimensions")
    if type(request["seed"]) is not int or not 0 <= request["seed"] <= 2147483647:
        raise ValueError("Invalid seed")
    ref = request["reference"]
    if ref is not None:
        if not isinstance(ref, str) or len(ref) > (MAX_REFERENCE + 2) // 3 * 4:
            raise ValueError("Reference exceeds 4 MiB")
        image = base64.b64decode(ref, validate=True)
        if len(image) > MAX_REFERENCE or not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Expected a PNG reference")
        return image
    return None

def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise ValueError("Request too large")
    request = json.loads(raw)
    reference = validate(request)
    import torch
    from PIL import Image
    from diffusers import Flux2KleinPipeline

    # Use the matching runtime snapshot even if a new model becomes available online.
    snapshot = Path(os.environ.get("IMAGE_STUDIO_MODEL", "/mnt/models/FLUX.2-klein-4B/" + MODEL_REVISION))
    if snapshot.name != MODEL_REVISION or not (snapshot / "model_index.json").is_file():
        raise ValueError("Pinned image model unavailable")
    inputs = {}
    if reference is not None:
        with Image.open(io.BytesIO(reference), formats=["PNG"]) as image:
            if max(image.size) > 1536:
                raise ValueError("Reference too large")
            inputs["image"] = image.convert("RGB")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable")
    pipe = Flux2KleinPipeline.from_pretrained(snapshot, torch_dtype=torch.bfloat16, local_files_only=True)
    pipe.enable_model_cpu_offload()
    result = pipe(prompt=request["prompt"].strip(), width=request["size"], height=request["size"],
                  generator=torch.Generator("cpu").manual_seed(request["seed"]), num_inference_steps=4,
                  guidance_scale=1.0, **inputs).images[0]
    output = io.BytesIO()
    result.save(output, format="PNG")
    if output.tell() > MAX_OUTPUT:
        raise ValueError("Output image too large")
    sys.stdout.buffer.write(output.getbuffer())

if __name__ == "__main__":
    main()

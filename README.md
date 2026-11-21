# Image Studio

A browser-native WebOS app inspired by EggLab’s PhotoCraft workflow. Open a PNG, JPEG or WebP reference, describe a change or a new image, compare the result with the reference, and export a PNG to account Files or the device. Images can be imported into PhotoCraft. Each window owns its reference and preview.

The browser entry is `app.mjs`. A static server serving this directory and `index.html` provides the standalone reference preview and PNG export. The WebOS desktop supplies account Files and the signed image operation. Rendering requires both a registered account matching the operator-configured immutable subject and an installed GPU worker. A render never replaces its source file.

The backend runs the pinned FLUX.2-klein-4B Diffusers snapshot on a CUDA machine. The gateway accepts the existing WebOS signed request under resource `image-studio` and operation `image-render`. Set `WEBOS_IMAGE_OWNER_SUB` and `WEBOS_IMAGE_RENDER_COMMAND` in the backend environment. The latter is an absolute executable path, typically a fixed restricted SSH command that runs `server/render.py` with the worker's virtual environment. It reads JSON from stdin and writes PNG bytes to stdout. The GPU host needs no public HTTP listener. The gateway admits one render at a time. The frontend only stores an image in account Files after an explicit save.

Model source and terms are in the [FLUX.2-klein-4B model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B). EggLab is the [workflow inspiration](https://github.com/YanNyeinHtet/EggLab).

import io
import os
import secrets
import time
import uuid
import warnings
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from parser import parse_lines
from providers import PaddleOCRProvider

provider = PaddleOCRProvider()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.getenv("OCR_SKIP_PRELOAD") != "true":
        await run_in_threadpool(provider.load)
    yield


app = FastAPI(title="São Cristóvão • OCR interno", docs_url=None, redoc_url=None,
              lifespan=lifespan)
Image.MAX_IMAGE_PIXELS = 16_000_000
MAX_BYTES = 4 * 1024 * 1024
warnings.simplefilter("error", Image.DecompressionBombWarning)


def preprocess(data: bytes) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.format not in {"JPEG", "PNG", "WEBP"} or img.width * img.height > 16_000_000:
                raise ValueError("invalid image")
            image = ImageOps.exif_transpose(img).convert("RGB")
            image.thumbnail((2000, 2000))
            rgb = np.array(image)
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "Imagem inválida ou dimensões excessivas.") from None


@app.get("/health")
def health():
    return {"status": "ok", "provider": provider.name, "modelLoaded": provider._engine is not None}


@app.post("/recognize")
async def recognize(file: UploadFile = File(...), x_service_token: str = Header(default="")):
    expected = os.getenv("OCR_SERVICE_TOKEN", "")
    if len(expected) < 32 or not secrets.compare_digest(x_service_token, expected):
        raise HTTPException(401, "Serviço não autorizado.")
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "Use JPEG, PNG ou WebP.")
    data = await file.read(MAX_BYTES + 1)
    await file.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Imagem acima de 4 MB.")
    start = time.perf_counter()
    image = await run_in_threadpool(preprocess, data)
    try:
        lines = await run_in_threadpool(provider.recognize, image)
    except Exception:
        # Exception text may contain image paths or OCR output; do not log it.
        raise HTTPException(503, "OCR indisponível. Preencha manualmente.") from None
    return {**parse_lines(lines), "rawText": "\n".join(t for t, _ in lines)[:20000],
            "processingTime": round((time.perf_counter() - start) * 1000),
            "requestId": str(uuid.uuid4()), "provider": provider.name}

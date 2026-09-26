from typing import Protocol
import threading
import os
from pathlib import Path

import numpy as np

cache = (
    Path(__file__).resolve().parent / ".paddlex"
    if os.getenv("VERCEL")
    else Path(__file__).resolve().parents[2] / ".data/paddle"
)
os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(cache))


class OCRProvider(Protocol):
    name: str

    def recognize(self, image: np.ndarray) -> list[tuple[str, float]]: ...


class PaddleOCRProvider:
    name = "paddleocr"

    def __init__(self):
        self._engine = None
        self._lock = threading.RLock()

    def load(self) -> None:
        """Load models before the service reports readiness."""
        with self._lock:
            if self._engine is None:
                from paddleocr import PaddleOCR

                self._engine = PaddleOCR(
                    lang="pt", ocr_version="PP-OCRv5",
                    text_detection_model_name=(
                        "PP-OCRv5_mobile_det"
                        if os.getenv("VERCEL")
                        else "PP-OCRv5_server_det"
                    ),
                    text_recognition_model_name="latin_PP-OCRv5_mobile_rec",
                    use_doc_orientation_classify=True,
                    use_doc_unwarping=False, use_textline_orientation=True,
                )

    def recognize(self, image: np.ndarray) -> list[tuple[str, float]]:
        # Lazy initialization: first request loads models. One inference per process.
        with self._lock:
            if self._engine is None:
                self.load()
            lines = []
            for result in self._engine.predict(image):
                data = result.json
                if "res" in data:
                    data = data["res"]
                lines.extend((str(text), float(score)) for text, score in
                             zip(data["rec_texts"], data["rec_scores"], strict=True))
            return lines

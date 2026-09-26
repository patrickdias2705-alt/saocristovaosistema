"""Download the lightweight production OCR models into the deployment bundle."""

import os
from pathlib import Path

root = Path(__file__).resolve().parent
os.environ["VERCEL"] = "1"
os.environ["PADDLE_PDX_CACHE_HOME"] = str(root / ".paddlex")

from providers import PaddleOCRProvider  # noqa: E402


def main() -> None:
    PaddleOCRProvider().load()
    print("Vercel OCR models prepared.")


if __name__ == "__main__":
    main()

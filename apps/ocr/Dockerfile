FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home ocr
COPY --chown=ocr:ocr . .
RUN chown ocr:ocr /app
USER ocr
ENV PYTHONUNBUFFERED=1
ENV VERCEL=1
ENV PADDLE_PDX_CACHE_HOME=/app/.paddlex
RUN python build.py
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log --limit-concurrency 4"]

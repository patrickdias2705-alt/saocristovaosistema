FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home ocr
COPY --chown=ocr:ocr . .
USER ocr
ENV PYTHONUNBUFFERED=1
ENV PADDLE_PDX_CACHE_HOME=/home/ocr/.paddlex
EXPOSE 8000
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000","--no-access-log","--limit-concurrency","4"]

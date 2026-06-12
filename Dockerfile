# FastAPI backend image for Fly.io
FROM python:3.11-slim

# Faster, quieter Python; unbuffered logs stream to Fly.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install backend deps first so this layer caches across code changes.
COPY requirements-backend.txt ./
RUN pip install --upgrade pip && pip install -r requirements-backend.txt

# Copy only the backend package (frontend is deployed separately on Vercel).
COPY backend ./backend

# Fly routes external 443/80 → this internal port.
ENV PORT=8080
EXPOSE 8080

# DB_PATH defaults to the mounted volume; override via fly secrets if needed.
ENV DB_PATH=/app/data/fyers_data.db

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}"]

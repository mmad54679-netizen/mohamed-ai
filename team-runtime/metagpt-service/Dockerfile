FROM python:3.11.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install --upgrade pip && pip install -r requirements.txt
COPY metagpt_service ./metagpt_service
RUN mkdir -p /var/lib/metagpt/artifacts && useradd --system --uid 10001 --create-home appuser && chown -R appuser:appuser /app /var/lib/metagpt
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "metagpt_service.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

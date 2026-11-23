FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /srv/crewai-service
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py roster.example.json README.md ./
EXPOSE 8080
USER nobody
CMD ["python", "app.py"]

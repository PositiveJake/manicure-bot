FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1 \
    DB_PATH=/data/bookings.db \
    TZ_NAME=Europe/Moscow

# На хостинге к /data монтируется постоянный том, чтобы база переживала перезапуски
VOLUME /data

CMD ["python", "bot.py"]

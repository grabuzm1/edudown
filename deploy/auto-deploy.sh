#!/usr/bin/env bash
# Авто-деплой: если origin/main ушёл вперёд — обновляем сайт. Запускается cron'ом раз в минуту.
cd /var/www/edudown || exit 1
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "[auto-deploy] new commit $REMOTE"
git pull --ff-only origin main

cd backend && ./.venv/bin/pip install -q -r requirements.txt && cd ..
cd frontend && (npm ci --silent || npm install --silent) && npm run build && cd ..

systemctl restart edudown
nginx -t && systemctl reload nginx
echo "[auto-deploy] done"
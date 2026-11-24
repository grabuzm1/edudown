
#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT="/var/www/edudown"
BACKEND="$PROJECT/backend"
FRONTEND="$PROJECT/frontend"
LOCK="/var/lock/edudown-deploy.lock"
LOG="/var/log/edudown-deploy.log"

exec 9>"$LOCK"

# Не допускаем параллельные деплои
if ! flock -n 9; then
    echo "[$(date)] Deploy already running. Skipping."
    exit 0
fi

exec >> "$LOG" 2>&1

echo "[$(date)] Checking updates..."

cd "$PROJECT"

git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "No updates."
    exit 0
fi

# Проверяем, изменились ли зависимости
BACKEND_DEPS_CHANGED=0
FRONTEND_DEPS_CHANGED=0

if ! git diff --quiet "$LOCAL" "$REMOTE" -- backend/requirements.txt; then
    BACKEND_DEPS_CHANGED=1
fi

if ! git diff --quiet "$LOCAL" "$REMOTE" -- frontend/package-lock.json; then
    FRONTEND_DEPS_CHANGED=1
fi

echo "New commit: $REMOTE"

git pull --ff-only origin main

# Python-зависимости только при изменении requirements.txt
if [ "$BACKEND_DEPS_CHANGED" = "1" ]; then
    echo "Installing Python dependencies..."
    cd "$BACKEND"
    ./.venv/bin/python -m pip install --no-cache-dir -r requirements.txt
fi

# Node-зависимости только при изменении package-lock.json
if [ "$FRONTEND_DEPS_CHANGED" = "1" ]; then
    echo "Installing Node dependencies..."
    cd "$FRONTEND"
    npm ci --no-audit --no-fund --silent
fi

# Собираем frontend только при изменениях в нём
if ! git diff --quiet "$LOCAL" "$REMOTE" -- frontend; then
    echo "Building frontend..."
    cd "$FRONTEND"
    npm run build
fi

echo "Restarting EduDown..."
systemctl restart edudown

nginx -t
systemctl reload nginx

echo "[$(date)] Deployment completed."

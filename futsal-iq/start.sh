#!/usr/bin/env bash
# FUTSAL IQ — instala (na 1.ª vez), compila o frontend e arranca em http://127.0.0.1:8000
set -euo pipefail
cd "$(dirname "$0")"
command -v ffmpeg >/dev/null || echo "AVISO: ffmpeg não encontrado — instale-o para exportar clips (ex.: sudo apt install ffmpeg / brew install ffmpeg)."
if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --upgrade pip
  backend/.venv/bin/pip install -r backend/requirements.txt
fi
if [ ! -d frontend/dist ] || [ "${REBUILD:-0}" = "1" ]; then
  (cd frontend && npm install && npm run build)
fi
cd backend && exec .venv/bin/python run.py

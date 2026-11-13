@echo off
REM FUTSAL IQ - instala (na 1.a vez), compila o frontend e arranca em http://127.0.0.1:8000
cd /d %~dp0
where ffmpeg >nul 2>nul || echo AVISO: ffmpeg nao encontrado - instale-o para exportar clips (winget install ffmpeg).
if not exist backend\.venv (
  python -m venv backend\.venv
  backend\.venv\Scripts\python -m pip install --upgrade pip
  backend\.venv\Scripts\pip install -r backend\requirements.txt
)
if not exist frontend\dist (
  pushd frontend && call npm install && call npm run build && popd
)
cd backend && .venv\Scripts\python run.py

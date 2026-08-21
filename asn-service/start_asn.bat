@echo off
setlocal

title ASN Service — Etiqueta + Aviso de Embarque
echo.
echo ========================================================
echo   ASN Service — Etiqueta + Aviso de Embarque
echo   Backend:  http://localhost:8003  (FastAPI)
echo   Frontend: http://localhost:5175  (Vite + React)
echo   Swagger:  http://localhost:8003/docs
echo ========================================================
echo.

set "ROOT=%~dp0"

:: ── Backend FastAPI (porta 8003) ─────────────────────────────────────────────
echo [1/2] Iniciando backend ASN (FastAPI porta 8003)...
start "ASN Backend :8003" cmd /k "cd /d %ROOT%backend & pip install -r requirements.txt -q & python main.py"

:: Aguarda 3s para o backend subir
timeout /t 3 /nobreak >nul

:: ── Frontend Vite (porta 5175) ───────────────────────────────────────────────
echo [2/2] Iniciando frontend ASN (Vite porta 5175)...
start "ASN Frontend :5175" cmd /k "cd /d %ROOT%frontend & npm install & npm run dev"

echo.
echo Tudo iniciado!
echo   Backend:  http://localhost:8003
echo   Frontend: http://localhost:5175
echo   Docs API: http://localhost:8003/docs
echo.
echo Pressione qualquer tecla para fechar esta janela...
pause >nul

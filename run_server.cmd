@echo off
TITLE NyangMentions - Servidor
echo [NyangMentions] Iniciando o servidor...
node app.js
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERRO] O servidor parou inesperadamente.
    pause
)

@echo off
chcp 65001 > nul
title Cooperativa - Modo Demo (TCC)

echo ====================================================================
echo  Iniciando Ambiente Isolado de Demonstração (TCC)...
echo ====================================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-demo.ps1" %*
pause

@echo off
title Joseph.Trading - MT5 Bridge Launcher
cd /d "%~dp0"

REM ── المفتاح السرّي: غيّره إلى ما تحب (ثم ضع نفس القيمة في موقعك، الحقل 2) ──
if not defined BRIDGE_SECRET set BRIDGE_SECRET=mysecret12345

echo ============================================================
echo  1) المفتاح السرّي (الحقل 2 في الموقع) هو:
echo.
echo        %BRIDGE_SECRET%
echo.
echo  2) انتظر قليلاً حتى يفتح نافذة Cloudflare ثم انسخ الرابط
echo     الذي يبدأ بـ https://...trycloudflare.com
echo     (ذلك = الحقل 1 في الموقع)
echo ============================================================
echo.

REM ── نافذة 1: الجسر نفسه (لا تغلقها) ──
start "MT5 Bridge - do not close" cmd /k python bridge.py

REM انتظر قليلًا ثم افتح نافذة الأنبوب
timeout /t 3 /nobreak >nul
start "Cloudflare Tunnel - copy the https URL" cmd /k cloudflared tunnel --url http://localhost:8799

echo. تم فتح النافذتين. اتركهما مفتوحتين أثناء التداول.
pause

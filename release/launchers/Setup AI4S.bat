@echo off
rem Opens the page where you paste optional keys. Double-click this file.
rem It runs the prebuilt tools in this folder; nothing is installed or changed.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is needed. Install the current LTS from https://nodejs.org/ and double-click this file again.
  echo 需要先安装 Node.js 22.13 或更新版本。请到 https://nodejs.org/ 安装当前的 LTS 版本，然后再双击这个文件。
  if not defined AI4S_NO_PAUSE pause
  exit /b 1
)
node "runtime\bundle\index.mjs" --setup %*
set AI4S_EXIT=%ERRORLEVEL%
if not "%AI4S_EXIT%"=="0" if not defined AI4S_NO_PAUSE pause
exit /b %AI4S_EXIT%

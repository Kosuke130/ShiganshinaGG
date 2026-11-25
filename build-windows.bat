@echo off
chcp 65001 >nul
title ShiganshinaGG - compilation
echo.
echo  === ShiganshinaGG : compilation pour Windows ===
echo.
where cargo >nul 2>nul
if errorlevel 1 (
  echo  [!] Rust n'est pas installe.
  echo      1. Installe "Visual Studio Build Tools" avec "Developpement Desktop en C++"
  echo         https://visualstudio.microsoft.com/fr/visual-cpp-build-tools/
  echo      2. Installe Rust : https://rustup.rs  ^(rustup-init.exe^)
  echo      3. Ferme cette fenetre et relance build-windows.bat
  pause
  exit /b 1
)
cd /d "%~dp0src-tauri"
echo  Compilation en cours (5 a 10 minutes la premiere fois)...
cargo build --release
if errorlevel 1 (
  echo.
  echo  [!] La compilation a echoue. Regarde le message d'erreur ci-dessus.
  pause
  exit /b 1
)
copy /y "target\release\shiganshinagg.exe" "%~dp0ShiganshinaGG.exe" >nul
echo.
echo  Termine ! L'application est prete : ShiganshinaGG.exe
echo.
start "" "%~dp0"
pause

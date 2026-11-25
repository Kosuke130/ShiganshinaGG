@echo off
chcp 65001 >nul
title ShiganshinaGG - installation complete
cd /d "%~dp0"
set "LOG=%~dp0install-log.txt"
echo ==== %date% %time% ==== > "%LOG%"
echo.
echo  === ShiganshinaGG : installation des outils + compilation ===
echo  Accepte les fenetres "Autoriser les modifications" si elles apparaissent.
echo.

echo [step] check winget >> "%LOG%"
where winget >nul 2>nul
if errorlevel 1 goto nowinget
echo [step] winget ok, check vswhere >> "%LOG%"

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "HASVC="
if not exist "%VSWHERE%" goto installvs
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "HASVC=%%i"
echo [step] HASVC=%HASVC% >> "%LOG%"
if defined HASVC goto vsok

:installvs
echo  [1/3] Installation de Visual Studio Build Tools C++ - 10 a 20 min...
echo [..] Installation Build Tools >> "%LOG%"
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" >> "%LOG%" 2>&1
echo [..] code retour Build Tools : %errorlevel% >> "%LOG%"
goto rust

:vsok
echo [OK] Build Tools C++ deja presents >> "%LOG%"
echo  [OK] Build Tools C++ deja installes.

:rust
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo >nul 2>nul
if not errorlevel 1 goto rustok
echo  [2/3] Installation de Rust...
echo [..] Installation Rustup >> "%LOG%"
winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements >> "%LOG%" 2>&1
echo [..] code retour Rustup : %errorlevel% >> "%LOG%"
goto rustcheck

:rustok
echo [OK] Rust deja present >> "%LOG%"
echo  [OK] Rust deja installe.

:rustcheck
rustup default stable >> "%LOG%" 2>&1
where cargo >nul 2>nul
if errorlevel 1 goto norust

echo  [3/3] Compilation de ShiganshinaGG - 5 a 10 min...
echo [..] cargo build --release >> "%LOG%"
cd /d "%~dp0src-tauri"
cargo build --release >> "%LOG%" 2>&1
if errorlevel 1 goto buildfail
taskkill /im ShiganshinaGG.exe /f >nul 2>&1
timeout /t 2 /nobreak >nul
copy /y "target\release\shiganshinagg.exe" "%~dp0ShiganshinaGG.exe" >> "%LOG%" 2>&1
echo [OK] TERMINE - ShiganshinaGG.exe cree >> "%LOG%"
echo.
echo  Termine ! Lancement de ShiganshinaGG...
start "" "%~dp0ShiganshinaGG.exe"
timeout /t 5
exit /b 0

:nowinget
echo [!] winget introuvable >> "%LOG%"
echo  [!] winget est introuvable. Installe "App Installer" depuis le Microsoft Store.
pause
exit /b 1

:norust
echo [!] cargo introuvable apres installation >> "%LOG%"
echo  [!] Rust ne s'est pas installe correctement. Voir install-log.txt
pause
exit /b 1

:buildfail
echo [!] ECHEC compilation >> "%LOG%"
echo  [!] La compilation a echoue. Voir install-log.txt
pause
exit /b 1

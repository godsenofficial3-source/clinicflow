@echo off
setlocal
pushd "%~dp0" || goto folder_error

if not exist "package.json" goto extract_error
if not exist "package-lock.json" goto extract_error

where node.exe >nul 2>&1
if errorlevel 1 goto node_error
where npm.cmd >nul 2>&1
if errorlevel 1 goto node_error

if not exist "node_modules\express\package.json" goto install
if not exist "node_modules\firebase-admin\package.json" goto install
if not exist "node_modules\nodemailer\package.json" goto install
fc /b "package-lock.json" "node_modules\.clinicflow-package-lock.json" >nul 2>&1
if not errorlevel 1 goto start_app

:install
echo Installing Clinic Flow dependencies...
call npm.cmd ci
if errorlevel 1 goto install_error
copy /y "package-lock.json" "node_modules\.clinicflow-package-lock.json" >nul

:start_app
echo Open http://localhost:3000 when the server is ready. Keep this window open.
call npm.cmd start
if errorlevel 1 goto startup_error
popd
exit /b 0

:extract_error
echo Extract the entire ZIP first, then open this launcher in the folder with package.json.
goto app_error

:node_error
echo Install Node.js 22.5 or newer, then reopen this launcher.
goto app_error

:install_error
echo Clinic Flow could not install its dependencies. See the npm error above.
goto app_error

:startup_error
echo Clinic Flow could not start. See the error above.

:app_error
popd

:folder_error
pause
exit /b 1

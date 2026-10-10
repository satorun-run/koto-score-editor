@echo off
rem 箏譜エディタを起動する。ブラウザが開いたら、この窓は閉じずに置いておく。
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

rem すでに起動していれば、新しく立ち上げずに同じ画面を開く。
rem （別の番号で立ち上げると、ブラウザに保存した楽譜や設定が見えなくなるため）
netstat -ano | findstr /R /C:":5183 .*LISTENING" >nul
if not errorlevel 1 (
  echo 箏譜エディタはすでに起動しています。同じ画面をブラウザで開きます。
  start "" http://localhost:5183/
  timeout /t 3 >nul
  exit /b
)

echo 箏譜エディタを起動します。この窓は閉じないでください（閉じると止まります）。
if not exist node_modules call npm install
call npm run dev -- --open
echo.
echo 箏譜エディタが止まりました。上にエラーが出ていれば、その内容を確認してください。
pause

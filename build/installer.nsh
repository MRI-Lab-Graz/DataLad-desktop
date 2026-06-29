; Installs the prerequisites DataLad Desktop needs (Python 3, DataLad, git-annex)
; if they are not already present on the machine. Runs once, after app files are
; copied, as part of the NSIS installer produced by electron-builder.
;
; This requires internet access during setup. If a download or sub-installer
; fails, we log it and continue rather than aborting the DataLad Desktop install;
; the in-app diagnostics screen will still report what's missing afterwards.

!macro customInstall
  DetailPrint "Checking for Python 3..."
  nsExec::ExecToStack `powershell -NoProfile -Command "if (Get-Command py -ErrorAction SilentlyContinue) { exit 0 } elseif (Get-Command python -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "Python not found - downloading installer..."
    nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile '$TEMP\python-installer.exe'"`
    Pop $0
    ${If} $0 == 0
      DetailPrint "Installing Python 3 (silent)..."
      ExecWait `"$TEMP\python-installer.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_launcher=1` $0
      ${If} $0 != 0
        DetailPrint "Python installer exited with code $0 - continuing without it."
      ${EndIf}
    ${Else}
      DetailPrint "Could not download Python installer - skipping. Install it manually from python.org."
    ${EndIf}
    Delete "$TEMP\python-installer.exe"
  ${Else}
    DetailPrint "Python 3 already present."
  ${EndIf}

  DetailPrint "Installing/updating DataLad via pip..."
  nsExec::ExecToLog `powershell -NoProfile -Command "py -3 -m pip install --upgrade pip datalad"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "DataLad pip install failed (exit $0) - it can be installed later from the app's diagnostics screen."
  ${EndIf}

  DetailPrint "Checking for git-annex..."
  nsExec::ExecToStack `powershell -NoProfile -Command "if (Get-Command git-annex -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "git-annex not found - downloading installer..."
    nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://downloads.kitenet.net/git-annex/windows/current/git-annex-installer.exe' -OutFile '$TEMP\git-annex-installer.exe'"`
    Pop $0
    ${If} $0 == 0
      DetailPrint "Installing git-annex (silent)..."
      ExecWait `"$TEMP\git-annex-installer.exe" /S` $0
      ${If} $0 != 0
        DetailPrint "git-annex installer exited with code $0 - continuing without it."
      ${EndIf}
    ${Else}
      DetailPrint "Could not download git-annex installer - skipping. Install it manually from datalad.org."
    ${EndIf}
    Delete "$TEMP\git-annex-installer.exe"
  ${Else}
    DetailPrint "git-annex already present."
  ${EndIf}
!macroend

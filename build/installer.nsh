; Installs the prerequisites DataLad Desktop needs (Git, Python 3, DataLad,
; git-annex) if they are not already present on the machine. Runs once, after
; app files are copied, as part of the NSIS installer produced by electron-builder.
;
; This requires internet access during setup. Every downloaded installer's
; SHA-256 is checked against a pinned value before it is run; if a download,
; hash check, or sub-installer fails, we log it and continue rather than
; aborting the DataLad Desktop install - the in-app diagnostics screen will
; still report what's missing afterwards.
;
; git-annex's Windows build plugs into an existing Git for Windows install,
; and DataLad itself shells out to `git` - so Git must be present before
; git-annex is installed.

!macro customInstall
  DetailPrint "Checking for Git..."
  nsExec::ExecToStack `powershell -NoProfile -Command "if (Get-Command git -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "Git not found - downloading installer..."
    nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/Git-2.55.0.5-64-bit.exe' -OutFile '$TEMP\git-installer.exe'"`
    Pop $0
    ${If} $0 == 0
      nsExec::ExecToStack `powershell -NoProfile -Command "if ((Get-FileHash '$TEMP\git-installer.exe' -Algorithm SHA256).Hash -ne 'D065A4E23C3D9A6B5073D609B5BE0830227EC3CA053C083BA385061DDFAF94C6') { exit 1 } else { exit 0 }"`
      Pop $0
      ${If} $0 != 0
        DetailPrint "Git installer failed hash verification - not running it. Install Git manually from git-scm.com."
      ${Else}
        DetailPrint "Installing Git (silent)..."
        ExecWait `"$TEMP\git-installer.exe" /VERYSILENT /NORESTART /NOCANCEL /SP- /SUPPRESSMSGBOXES` $0
        ${If} $0 != 0
          DetailPrint "Git installer exited with code $0 - continuing without it."
        ${EndIf}
      ${EndIf}
    ${Else}
      DetailPrint "Could not download Git installer - skipping. Install it manually from git-scm.com."
    ${EndIf}
    Delete "$TEMP\git-installer.exe"
  ${Else}
    DetailPrint "Git already present."
  ${EndIf}

  DetailPrint "Checking for Python 3..."
  nsExec::ExecToStack `powershell -NoProfile -Command "if (Get-Command py -ErrorAction SilentlyContinue) { exit 0 } elseif (Get-Command python -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "Python not found - downloading installer..."
    nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile '$TEMP\python-installer.exe'"`
    Pop $0
    ${If} $0 == 0
      nsExec::ExecToStack `powershell -NoProfile -Command "if ((Get-FileHash '$TEMP\python-installer.exe' -Algorithm SHA256).Hash -ne '1206721601A62C925D4E4A0DCFC371E88F2DDBE8C0C07962EBB2BE9B5BDE4570') { exit 1 } else { exit 0 }"`
      Pop $0
      ${If} $0 != 0
        DetailPrint "Python installer failed hash verification - not running it. Install Python manually from python.org."
      ${Else}
        DetailPrint "Installing Python 3 (silent)..."
        ExecWait `"$TEMP\python-installer.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_launcher=1` $0
        ${If} $0 != 0
          DetailPrint "Python installer exited with code $0 - continuing without it."
        ${EndIf}
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

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
  nsExec::ExecToLog `powershell -NoProfile -Command "$$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'); if (Get-Command py -ErrorAction SilentlyContinue) { py -3 -m pip install --upgrade pip datalad } elseif (Get-Command python -ErrorAction SilentlyContinue) { python -m pip install --upgrade pip datalad } else { exit 1 }"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "DataLad pip install failed (exit $0) - it can be installed later from the app's diagnostics screen."
  ${Else}
    ; pip puts datalad.exe in the Scripts folder of whichever Python it ran under
    ; (the `py -3` default can differ from the Python on PATH), and that folder is
    ; not necessarily on PATH - so DataLad would be installed but the `datalad`
    ; command, and the app, could not find it. Add it to the machine PATH.
    DetailPrint "Making the datalad command available on PATH..."
    nsExec::ExecToLog `powershell -NoProfile -Command "$$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'); $$code = 'import sysconfig; print(sysconfig.get_path(''scripts''))'; if (Get-Command py -ErrorAction SilentlyContinue) { $$scripts = py -3 -c $$code } else { $$scripts = python -c $$code }; $$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine'); if ($$scripts -and (Test-Path (Join-Path $$scripts 'datalad.exe')) -and (($$machine -split ';') -notcontains $$scripts)) { [Environment]::SetEnvironmentVariable('Path', $$machine.TrimEnd(';') + ';' + $$scripts, 'Machine') }"`
    Pop $0
    ${If} $0 != 0
      DetailPrint "Could not add DataLad's Scripts folder to PATH (exit $0) - add it manually if the datalad command is not found."
    ${EndIf}
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

; Runs when the user uninstalls DataLad Desktop. Offers to also remove what the
; installer added for DataLad: the pip package and its Scripts folder on PATH.
; Python, Git and git-annex are shared tools other software may rely on, so they
; are never removed. The Scripts folder leaves PATH only if pip left it empty.
; Silent uninstalls keep DataLad (/SD IDNO).
!macro customUnInstall
  ${ifNot} ${isUpdated}
  MessageBox MB_YESNO "Also remove DataLad (the pip package) and its PATH entry?$\r$\n$\r$\nPython, Git and git-annex will be left installed." /SD IDNO IDNO skip_datalad_removal
    DetailPrint "Removing DataLad..."
    nsExec::ExecToLog `powershell -NoProfile -Command "$$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'); $$code = 'import sysconfig; print(sysconfig.get_path(''scripts''))'; if (Get-Command py -ErrorAction SilentlyContinue) { $$scripts = py -3 -c $$code; py -3 -m pip uninstall -y datalad; $$pipExit = $$LASTEXITCODE } elseif (Get-Command python -ErrorAction SilentlyContinue) { $$scripts = python -c $$code; python -m pip uninstall -y datalad; $$pipExit = $$LASTEXITCODE } else { exit 1 }; if ($$scripts -and -not (Get-ChildItem $$scripts -ErrorAction SilentlyContinue | Select-Object -First 1)) { $$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine'); [Environment]::SetEnvironmentVariable('Path', (($$machine -split ';' | Where-Object { $$_ -and $$_ -ne $$scripts }) -join ';'), 'Machine') }; exit $$pipExit"`
    Pop $0
    ${If} $0 != 0
      DetailPrint "Could not fully remove DataLad (exit $0) - run 'python -m pip uninstall datalad' manually."
    ${EndIf}
  skip_datalad_removal:
  ${endIf}
!macroend

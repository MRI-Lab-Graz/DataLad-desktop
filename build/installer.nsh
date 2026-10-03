; Installs the prerequisites DataLad Desktop needs (Git, Python 3, DataLad,
; git-annex) if they are not already present on the machine. Runs once, after
; app files are copied, as part of the NSIS installer produced by electron-builder.
;
; This requires internet access during setup and runs elevated, so:
;  - every downloaded installer's SHA-256 is checked against a pinned value
;    before it is run (git-annex only publishes a moving "current" URL: when
;    upstream releases a new version the check fails and git-annex is skipped
;    until the pin below is bumped);
;  - DataLad is installed into a private environment under the install folder
;    from a hash-locked requirements file, never into a shared Python;
;  - PowerShell is called by absolute path, downloads go into the random
;    $PLUGINSDIR, and tools are looked up on the machine PATH only.
; If a download, hash check, or sub-installer fails, we log it and continue
; rather than aborting the DataLad Desktop install - the in-app diagnostics
; screen will still report what's missing afterwards.
;
; git-annex's Windows build plugs into an existing Git for Windows install,
; and DataLad itself shells out to `git` - so Git must be present before
; git-annex is installed.

!define PS `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"`
!define MACHINE_PATH "$$env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine'); $$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine');"

; A silent install prints nothing, so every step that can fail appends a line to
; $INSTDIR\install.log (what happened, and the output of the failing command).
!macro Log text
  FileOpen $9 "$INSTDIR\install.log" a
  FileSeek $9 0 END
  FileWrite $9 "${text}$\r$\n"
  FileClose $9
!macroend

!macro customInstall
  InitPluginsDir
  DetailPrint "Checking for Git..."
  nsExec::ExecToStack `${PS} -NoProfile -Command "${MACHINE_PATH} if (Get-Command git -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "Git not found - downloading installer..."
    nsExec::ExecToLog `${PS} -NoProfile -ExecutionPolicy Bypass -Command "${MACHINE_PATH} [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/Git-2.55.0.5-64-bit.exe' -OutFile '$PLUGINSDIR\git-installer.exe'"`
    Pop $0
    ${If} $0 == 0
      nsExec::ExecToStack `${PS} -NoProfile -Command "${MACHINE_PATH} if (([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes('$PLUGINSDIR\git-installer.exe'))) -replace '-') -ne 'D065A4E23C3D9A6B5073D609B5BE0830227EC3CA053C083BA385061DDFAF94C6') { exit 1 } else { exit 0 }"`
      Pop $0
      ${If} $0 != 0
        DetailPrint "Git installer failed hash verification - not running it. Install Git manually from git-scm.com."
      ${Else}
        DetailPrint "Installing Git (silent)..."
        ExecWait `"$PLUGINSDIR\git-installer.exe" /VERYSILENT /NORESTART /NOCANCEL /SP- /SUPPRESSMSGBOXES` $0
        ${If} $0 != 0
          DetailPrint "Git installer exited with code $0 - continuing without it."
        ${EndIf}
      ${EndIf}
    ${Else}
      DetailPrint "Could not download Git installer - skipping. Install it manually from git-scm.com."
    ${EndIf}
    Delete "$PLUGINSDIR\git-installer.exe"
  ${Else}
    DetailPrint "Git already present."
  ${EndIf}

  ; The DataLad lock file is compiled for Python 3.12; another interpreter may lack a pinned wheel.
  DetailPrint "Checking for Python 3.12..."
  nsExec::ExecToStack `${PS} -NoProfile -Command "${MACHINE_PATH} if (Get-Command py -ErrorAction SilentlyContinue) { py -3.12 -c 'import sys'; exit $$LASTEXITCODE } elseif (Get-Command python -ErrorAction SilentlyContinue) { python -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)'; exit $$LASTEXITCODE } else { exit 1 }"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "Python 3.12 not found - downloading installer..."
    nsExec::ExecToLog `${PS} -NoProfile -ExecutionPolicy Bypass -Command "${MACHINE_PATH} [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile '$PLUGINSDIR\python-installer.exe'"`
    Pop $0
    ${If} $0 == 0
      nsExec::ExecToStack `${PS} -NoProfile -Command "${MACHINE_PATH} if (([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes('$PLUGINSDIR\python-installer.exe'))) -replace '-') -ne '1206721601A62C925D4E4A0DCFC371E88F2DDBE8C0C07962EBB2BE9B5BDE4570') { exit 1 } else { exit 0 }"`
      Pop $0
      ${If} $0 != 0
        DetailPrint "Python installer failed hash verification - not running it. Install Python manually from python.org."
      ${Else}
        DetailPrint "Installing Python 3.12 (silent)..."
        ExecWait `"$PLUGINSDIR\python-installer.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_launcher=1` $0
        ${If} $0 != 0
          DetailPrint "Python installer exited with code $0 - continuing without it."
        ${EndIf}
      ${EndIf}
    ${Else}
      DetailPrint "Could not download Python installer - skipping. Install it manually from python.org."
    ${EndIf}
    Delete "$PLUGINSDIR\python-installer.exe"
  ${Else}
    DetailPrint "Python 3.12 already present."
  ${EndIf}

  DetailPrint "Installing DataLad into its own environment..."
  nsExec::ExecToLog `${PS} -NoProfile -Command "${MACHINE_PATH} $$venv = '$INSTDIR\datalad-env'; if (Get-Command py -ErrorAction SilentlyContinue) { py -3.12 -m venv $$venv } elseif (Get-Command python -ErrorAction SilentlyContinue) { python -m venv $$venv } else { exit 1 }; if ($$LASTEXITCODE -ne 0) { exit $$LASTEXITCODE }; & (Join-Path $$venv 'Scripts\python.exe') -m pip install --require-hashes --only-binary :all: --no-deps --disable-pip-version-check -r '$INSTDIR\resources\datalad-requirements.txt'; exit $$LASTEXITCODE"`
  Pop $0
  !insertmacro Log "DataLad install exit $0"
  ${If} $0 != 0
    DetailPrint "DataLad install failed (exit $0) - it can be installed later from the app's diagnostics screen."
  ${Else}
    ; The private env's Scripts folder sits under the install folder. It only goes on the
    ; machine PATH when that is under Program Files (admin-writable); an install on a data
    ; drive can be writable by every user, and a machine-wide PATH entry there would let
    ; any of them plant programs.
    DetailPrint "Making the datalad command available on PATH..."
    nsExec::ExecToLog `${PS} -NoProfile -Command "${MACHINE_PATH} $$scripts = '$INSTDIR\datalad-env\Scripts'; $$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine'); if ($$scripts.StartsWith($$env:ProgramW6432, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path (Join-Path $$scripts 'datalad.exe')) -and (($$machine -split ';') -notcontains $$scripts)) { [Environment]::SetEnvironmentVariable('Path', $$machine.TrimEnd(';') + ';' + $$scripts, 'Machine') }"`
    Pop $0
    ${If} $0 != 0
      DetailPrint "DataLad was not added to PATH (exit $0): the install folder must be under Program Files. Add $INSTDIR\datalad-env\Scripts manually if the datalad command is not found."
    ${EndIf}
  ${EndIf}

  DetailPrint "Checking for git-annex..."
  nsExec::ExecToStack `${PS} -NoProfile -Command "${MACHINE_PATH} if (Get-Command git-annex -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "git-annex not found - downloading installer..."
    nsExec::ExecToStack `${PS} -NoProfile -ExecutionPolicy Bypass -Command "${MACHINE_PATH} [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://downloads.kitenet.net/git-annex/windows/current/git-annex-installer.exe' -OutFile '$PLUGINSDIR\git-annex-installer.exe'"`
    Pop $0
    Pop $1
    !insertmacro Log "git-annex download exit $0 into $PLUGINSDIR: $1"
    ${If} $0 == 0
      nsExec::ExecToStack `${PS} -NoProfile -Command "${MACHINE_PATH} if (([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes('$PLUGINSDIR\git-annex-installer.exe'))) -replace '-') -ne '4D4CA04DFB7A2FAF8C1A43BE7BFDDA98219833974BBF2678384A1DBAA1FEB1F9') { exit 1 } else { exit 0 }"`
      Pop $0
      Pop $1
      !insertmacro Log "git-annex hash check exit $0: $1"
      ${If} $0 != 0
        DetailPrint "git-annex installer failed hash verification (a newer version may have been released) - not running it. Install git-annex manually from git-annex.branchable.com."
      ${Else}
        DetailPrint "Installing git-annex (silent)..."
        ExecWait `"$PLUGINSDIR\git-annex-installer.exe" /S` $0
        !insertmacro Log "git-annex installer exit $0"
        ${If} $0 != 0
          DetailPrint "git-annex installer exited with code $0 - continuing without it."
        ${EndIf}
      ${EndIf}
    ${Else}
      DetailPrint "Could not download git-annex installer - skipping. Install it manually from datalad.org."
    ${EndIf}
    Delete "$PLUGINSDIR\git-annex-installer.exe"
  ${Else}
    DetailPrint "git-annex already present."
  ${EndIf}
!macroend

; Runs when the user uninstalls DataLad Desktop. DataLad lives in a private
; environment inside the install folder, so removing it is deleting that folder
; and its PATH entry. Python, Git and git-annex are shared tools other software
; may rely on, so they are never removed. During an update the environment is
; left alone (the new installer recreates it).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DetailPrint "Removing DataLad..."
    nsExec::ExecToLog `${PS} -NoProfile -Command "${MACHINE_PATH} $$scripts = '$INSTDIR\datalad-env\Scripts'; $$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine'); [Environment]::SetEnvironmentVariable('Path', (($$machine -split ';' | Where-Object { $$_ -and $$_ -ne $$scripts }) -join ';'), 'Machine')"`
    Pop $0
    RMDir /r "$INSTDIR\datalad-env"
  ${endIf}
!macroend

# Installs DataLad Desktop for the current user. No administrator rights needed.
#
# Normally started through install.cmd. Use the copy attached to a GitHub release: CI fills in the version and the
# SHA-256 of that release's app zip. The copy in the repository is a template and refuses to run.
#
# Options:
#   -FromDir <folder>   take files that exist there (named as on the release page) instead of downloading them;
#                       their SHA-256 is still checked
#   -InstallDir <path>  install somewhere else (default: LocalAppData\DataLad Desktop)
#   -Uninstall          remove an existing install
param(
    [string]$FromDir,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'DataLad Desktop'),
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads in Windows PowerShell 5.1 very slow
# Full path without a trailing backslash or dot: uninstall.cmd passes its own folder, and the PATH entry is compared as text.
$InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- Pins: the only places a version or a hash is written down ----
$AppVersion = '__VERSION__'
$AppZipSha256 = '__ZIP_SHA256__'
$Repo = 'MRI-Lab-Graz/DataLad-desktop'
$AppZipName = "DataLad-Desktop-$AppVersion-win-x64.zip"
$AppZipUrl = "https://github.com/$Repo/releases/download/v$AppVersion/$AppZipName"
$GitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/Git-2.55.0.5-64-bit.exe'
$GitSha256 = 'D065A4E23C3D9A6B5073D609B5BE0830227EC3CA053C083BA385061DDFAF94C6'
# DataLad's mirror keeps one file per git-annex version; the author's own current/ URL moves and would break this pin.
$GitAnnexVersion = '10.20260901'
$GitAnnexSha256 = '582F0EF30AC9BE560285D9510F27EBDD95EBDF01719DEC42543B591F6BEF0095'
$GitAnnexUrl = "https://datasets.datalad.org/datalad/packages/windows/git-annex-installer_${GitAnnexVersion}_x64.exe"

# Steps that cannot finish are collected here; the script reports them and exits non-zero at the end.
$script:Failures = @()
# True once the new app folder has replaced the old one: from then on a failure has to put the old one back.
$script:Swapped = $false

# Next to the install folder, not inside it: an upgrade swaps that folder. A drive root has no parent; the check that
# refuses it needs a log to write to first.
$LogParent = [IO.Path]::GetDirectoryName($InstallDir)
if (-not $LogParent) { $LogParent = $env:LOCALAPPDATA }
$LogPath = Join-Path $LogParent 'DataLad Desktop install.log'

function Write-Log([string]$Message) {
    Write-Host $Message
    Add-Content -LiteralPath $LogPath -Value ('{0:s} {1}' -f (Get-Date), $Message)
}

# The one place that downloads. Everything it returns has matched its SHA-256, or it throws.
function Get-VerifiedFile([string]$Url, [string]$Sha256, [string]$OutFile) {
    $local = if ($FromDir) { Join-Path $FromDir (Split-Path $Url -Leaf) } else { $null }
    if ($local -and (Test-Path -LiteralPath $local)) {
        Write-Log "Using $local"
        Copy-Item -LiteralPath $local -Destination $OutFile -Force
    } else {
        Write-Log "Downloading $Url"
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 1800
    }
    $stream = [IO.File]::OpenRead($OutFile)
    try {
        $actual = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)) -replace '-'
    } finally {
        $stream.Dispose()
    }
    if ($actual -ne $Sha256) {
        Remove-Item -LiteralPath $OutFile -Force
        throw "Hash mismatch for $(Split-Path $Url -Leaf): expected $Sha256, got $actual. The file was deleted and not used."
    }
}

# $InstallDir is deleted recursively: the old install after an upgrade, everything on uninstall. A folder that is not
# ours must never get that far. Most installers treat -InstallDir D:\Software as a parent folder, and a drive root
# is no folder of its own.
function Assert-SafeInstallDir {
    if ([IO.Path]::GetPathRoot("$InstallDir\") -eq "$InstallDir\") {
        throw "'$InstallDir' is a drive or share root. Give the install a folder of its own, for example '$InstallDir\DataLad Desktop'."
    }
    $hasContent = (Test-Path -LiteralPath $InstallDir) -and (Get-ChildItem -LiteralPath $InstallDir -Force | Select-Object -First 1)
    if ($hasContent -and -not (Test-Path -LiteralPath (Join-Path $InstallDir 'DataLad Desktop.exe'))) {
        throw "'$InstallDir' already exists and is not a DataLad Desktop install, so it is left alone. Choose a folder of its own."
    }
}

function Assert-AppNotRunning {
    $running = Get-Process -Name 'DataLad Desktop' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) {
        throw 'DataLad Desktop is running. Close it and run this script again.'
    }
}

function Install-App {
    Assert-AppNotRunning
    $work = "$InstallDir.new"
    $old = "$InstallDir.old"
    if (Test-Path -LiteralPath $old) {
        throw "A previous upgrade left '$old'. If '$InstallDir' is missing or broken, rename '$old' back; otherwise delete it, then run this script again."
    }
    $zip = Join-Path ([IO.Path]::GetTempPath()) $AppZipName
    Get-VerifiedFile -Url $AppZipUrl -Sha256 $AppZipSha256 -OutFile $zip
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $zip -DestinationPath $work -Force
    Remove-Item -LiteralPath $zip -Force
    if (-not (Test-Path -LiteralPath (Join-Path $work 'DataLad Desktop.exe'))) {
        throw "The app zip does not contain 'DataLad Desktop.exe'."
    }
    if (Test-Path -LiteralPath $InstallDir) {
        Move-Item -LiteralPath $InstallDir -Destination $old
    }
    Move-Item -LiteralPath $work -Destination $InstallDir
    $script:Swapped = $true
    Write-Log "Installed DataLad Desktop $AppVersion in '$InstallDir'."
}

# Written into the install folder so it can be removed without this download; it runs from TEMP because it deletes
# the folder it lives in.
function Install-Uninstaller {
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $InstallDir 'install.ps1') -Force
    $cmd = @'
@echo off
REM Removes DataLad Desktop. Runs a copy of the install script from TEMP, because this folder is deleted.
setlocal
copy /y "%~dp0install.ps1" "%TEMP%\dlad-uninstall.ps1" >nul
REM This file is deleted while it runs, and cmd re-reads a batch file after every command. (goto) 2>nul ends the batch
REM context first, so the rest of the line runs from memory.
(goto) 2>nul & powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\dlad-uninstall.ps1" -Uninstall -InstallDir "%~dp0." & pause
'@
    Set-Content -LiteralPath (Join-Path $InstallDir 'uninstall.cmd') -Value $cmd -Encoding ASCII
}

function Remove-UserPath([string]$Dir) {
    $entries = @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ -and $_ -ne $Dir })
    [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')
}

function New-Shortcuts {
    $target = Join-Path $InstallDir 'DataLad Desktop.exe'
    $shell = New-Object -ComObject WScript.Shell
    foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
        $link = $shell.CreateShortcut((Join-Path $dir 'DataLad Desktop.lnk'))
        $link.TargetPath = $target
        $link.WorkingDirectory = $env:USERPROFILE
        $link.Save()
    }
}

# Only called after the swap, so $InstallDir is the new, unfinished copy. The previous install, if any, comes back.
function Restore-PreviousInstall {
    $old = "$InstallDir.old"
    Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    # A file in use (an antivirus scan of the new exe files) can leave the folder half deleted; moving .old into it
    # would nest the previous install inside the broken one and still report success.
    if (Test-Path -LiteralPath $InstallDir) {
        Write-Log "WARNING: '$InstallDir' could not be removed completely, a file may be in use. Any previous install is intact in '$old'. Close the program using it, delete '$InstallDir', and rename '$old' back to '$InstallDir'."
        return
    }
    if (Test-Path -LiteralPath $old) {
        Move-Item -LiteralPath $old -Destination $InstallDir
        Write-Log 'The previous install was restored.'
    } else {
        Remove-UserPath (Join-Path $InstallDir 'datalad-env\Scripts')
        Write-Log 'The unfinished install was removed.'
    }
}

# The old install goes only once the new one has proved it starts.
function Complete-Upgrade {
    if (-not (Test-Datalad)) {
        throw 'DataLad does not start in the new install.'
    }
    Remove-Item -LiteralPath "$InstallDir.old" -Recurse -Force -ErrorAction SilentlyContinue
}

function Invoke-Uninstall {
    Assert-AppNotRunning
    foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
        Remove-Item -LiteralPath (Join-Path $dir 'DataLad Desktop.lnk') -Force -ErrorAction SilentlyContinue
    }
    Remove-UserPath (Join-Path $InstallDir 'datalad-env\Scripts')
    if (Test-Path -LiteralPath $InstallDir) {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
    }
    Remove-Item -LiteralPath "$InstallDir.new", "$InstallDir.old" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log 'DataLad Desktop was removed. Shared tools were left alone.'
}

# This process keeps the PATH it started with; installers update the registry. Look at what a new terminal will see.
function Update-ProcessPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Install-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Write-Log 'Git is already installed.'
        return
    }
    $installer = Join-Path ([IO.Path]::GetTempPath()) 'dlad-git-installer.exe'
    try {
        Get-VerifiedFile -Url $GitUrl -Sha256 $GitSha256 -OutFile $installer
    } catch {
        $script:Failures += "Git for Windows could not be downloaded: $($_.Exception.Message) Install it from https://git-scm.com/download/win and run this script again."
        return
    }
    Write-Log 'Installing Git for Windows for your user...'
    # Starting an unknown exe from TEMP can be refused (AppLocker, Defender, a declined prompt): that is a failure to
    # report with instructions, not a reason to roll the whole install back.
    try {
        $process = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES', '/CURRENTUSER' -Wait -PassThru
    } catch {
        $script:Failures += "Git for Windows could not be started: $($_.Exception.Message) Install it from https://git-scm.com/download/win and run this script again."
        return
    } finally {
        Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
    }
    Update-ProcessPath
    if ($process.ExitCode -ne 0 -or -not (Get-Command git -ErrorAction SilentlyContinue)) {
        $script:Failures += "Git for Windows could not be installed (exit code $($process.ExitCode)). Install it from https://git-scm.com/download/win and run this script again."
    }
}

function Install-GitAnnex {
    if (Get-Command git-annex -ErrorAction SilentlyContinue) {
        Write-Log 'git-annex is already installed.'
        return
    }
    $installer = Join-Path ([IO.Path]::GetTempPath()) 'dlad-git-annex-installer.exe'
    $manual = "Download $GitAnnexUrl and run it. If Git is installed for all users (in Program Files), run it as an administrator once."
    try {
        Get-VerifiedFile -Url $GitAnnexUrl -Sha256 $GitAnnexSha256 -OutFile $installer
    } catch {
        $script:Failures += "git-annex could not be downloaded: $($_.Exception.Message) $manual"
        return
    }
    Write-Log 'Installing git-annex...'
    try {
        $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
    } catch {
        $script:Failures += "git-annex could not be started: $($_.Exception.Message) $manual"
        return
    } finally {
        Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
    }
    Update-ProcessPath
    if ($process.ExitCode -ne 0 -or -not (Get-Command git-annex -ErrorAction SilentlyContinue)) {
        $script:Failures += "git-annex could not be installed (exit code $($process.ExitCode)). git-annex installs into Git for Windows. $manual"
    }
}

# The app finds datalad only through PATH, so the private environment's Scripts folder goes on the user PATH
# (current user only, no admin rights). The machine PATH is never written.
# ponytail: writing the expanded user PATH back turns any %VAR% entries into literal paths; acceptable here.
function Add-UserPath([string]$Dir) {
    $entries = @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ })
    if ($entries -contains $Dir) {
        return
    }
    # In front, so this copy wins over a stale datalad elsewhere in the user PATH.
    [Environment]::SetEnvironmentVariable('Path', ((@($Dir) + $entries) -join ';'), 'User')
    Write-Log "Added '$Dir' to your user PATH. Open a new terminal to use it."
}

function Install-DataladEnv {
    $ErrorActionPreference = 'Continue'   # uv reports progress on stderr; only its exit code decides
    $uv = Join-Path $InstallDir 'resources\uv\uv.exe'
    $requirements = Join-Path $InstallDir 'resources\datalad-requirements.txt'
    $venv = Join-Path $InstallDir 'datalad-env'
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $InstallDir 'python'
    $env:UV_CACHE_DIR = Join-Path ([IO.Path]::GetTempPath()) 'dlad-uv-cache'
    Write-Log 'Installing DataLad into its own environment (downloads Python 3.12, takes a few minutes)...'
    $output = & $uv venv --clear --no-config --managed-python --python 3.12 $venv 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Log $output
        throw "uv could not create the DataLad environment (exit code $LASTEXITCODE)."
    }
    $output = & $uv pip install --no-config --python $venv --link-mode copy --index-url https://pypi.org/simple --require-hashes --only-binary :all: --no-deps -r $requirements 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Log $output
        throw "uv could not install DataLad (exit code $LASTEXITCODE)."
    }
    Add-UserPath (Join-Path $venv 'Scripts')
}

function Test-Datalad {
    $exe = Join-Path $InstallDir 'datalad-env\Scripts\datalad.exe'
    if (-not (Test-Path -LiteralPath $exe)) {
        return $false
    }
    $ErrorActionPreference = 'Continue'
    & $exe --version *> $null
    return ($LASTEXITCODE -eq 0)
}

function Write-Report {
    $ours = Join-Path $InstallDir 'datalad-env\Scripts\datalad.exe'
    Update-ProcessPath
    $found = Get-Command datalad -ErrorAction SilentlyContinue
    if (-not (Test-Datalad)) {
        $script:Failures += 'DataLad was installed but "datalad --version" does not run.'
    } elseif (-not $found) {
        $script:Failures += "datalad is not found on PATH. Add '$(Split-Path $ours -Parent)' to your user PATH."
    } elseif ($found.Source -ne $ours) {
        Write-Log "WARNING: 'datalad' resolves to $($found.Source), not to the copy installed here ($ours). Remove that entry from your PATH, or the app may use the wrong DataLad."
    } else {
        Write-Log "datalad resolves to $ours."
    }
}

try {
    Assert-SafeInstallDir
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir -Parent) | Out-Null
    if ($Uninstall) {
        Invoke-Uninstall
        exit 0
    }
    if ($AppVersion -like '__*') {
        throw 'This is the unrendered template. Download install.cmd and install.ps1 from a release page instead.'
    }
    Install-App
    Install-Uninstaller
    Install-Git
    Install-GitAnnex
    Install-DataladEnv
    Complete-Upgrade
    New-Shortcuts
    Write-Report
    if ($script:Failures.Count -gt 0) {
        Write-Log 'Finished with problems:'
        $script:Failures | ForEach-Object { Write-Log "  - $_" }
        exit 1
    }
    Write-Log 'Done.'
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    if ($script:Swapped) {
        Restore-PreviousInstall
    }
    exit 1
}

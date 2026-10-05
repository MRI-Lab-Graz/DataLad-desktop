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
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- Pins: the only places a version or a hash is written down ----
$AppVersion = '__VERSION__'
$AppZipSha256 = '__ZIP_SHA256__'
$Repo = 'MRI-Lab-Graz/DataLad-desktop'
$AppZipName = "DataLad-Desktop-$AppVersion-win-x64.zip"
$AppZipUrl = "https://github.com/$Repo/releases/download/v$AppVersion/$AppZipName"

# Steps that cannot finish are collected here; the script reports them and exits non-zero at the end.
$script:Failures = @()

# Next to the install folder, not inside it: an upgrade swaps that folder.
$LogPath = Join-Path (Split-Path $InstallDir -Parent) 'DataLad Desktop install.log'

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
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
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

function Install-App {
    $running = Get-Process -Name 'DataLad Desktop' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) {
        throw 'DataLad Desktop is running. Close it and run this script again.'
    }
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
    Write-Log "Installed the app in '$InstallDir'."
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
    # This process still has the PATH it started with: look at what a new terminal will see.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
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
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir -Parent) | Out-Null
    if ($AppVersion -like '__*') {
        throw 'This is the unrendered template. Download install.cmd and install.ps1 from a release page instead.'
    }
    Install-App
    Install-DataladEnv
    Write-Report
    if ($script:Failures.Count -gt 0) {
        Write-Log 'Finished with problems:'
        $script:Failures | ForEach-Object { Write-Log "  - $_" }
        exit 1
    }
    Write-Log 'Done.'
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}

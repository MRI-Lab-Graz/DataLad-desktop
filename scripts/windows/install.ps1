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

try {
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir -Parent) | Out-Null
    if ($AppVersion -like '__*') {
        throw 'This is the unrendered template. Download install.cmd and install.ps1 from a release page instead.'
    }
    Install-App
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

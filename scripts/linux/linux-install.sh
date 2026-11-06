#!/bin/bash
# Installs Worldline Desktop for the current user (Linux, 64-bit Intel/AMD). No administrator rights needed.
#
# Run it with:   curl -fsSL https://github.com/MRI-Lab-Graz/Worldline-desktop/releases/latest/download/linux-install.sh | bash
# or download it and run:   bash linux-install.sh
# The copy attached to a GitHub release has the version and the SHA-256 of that release's AppImage filled in by CI.
# The copy in the repository is a template: it runs the linux-install.sh of the latest release instead.
#
# It does not install git, git-annex or DataLad: that needs your package manager (and sudo), so it only tells you the
# command. Options:
#   --from-dir <folder>   take the AppImage from that folder (named as on the release page) instead of downloading it;
#                         its SHA-256 is still checked

# Everything lives in main, called on the last line: with `curl | bash` the shell reads this file from stdin, so it has
# to be parsed completely before any command that might read stdin runs.
main() {
    set -euo pipefail

    # ---- Pins ----
    local APP_VERSION='__VERSION__'
    local APP_SHA256='__ZIP_SHA256__'
    local REPO='MRI-Lab-Graz/Worldline-desktop'
    local APP_FILE="DataLad.Desktop-${APP_VERSION}.AppImage"
    local APP_URL="https://github.com/${REPO}/releases/download/v${APP_VERSION}/${APP_FILE}"
    local APP_DIR="$HOME/Applications"
    local TARGET="$APP_DIR/Worldline-Desktop.AppImage"
    local MENU_DIR="$HOME/.local/share/applications"
    local from_dir=''

    die() { echo "ERROR: $*" >&2; exit 1; }
    log() { echo "==> $*"; }

    case "$APP_VERSION" in
        __*) # repository template: hand over to the latest release's copy, which has the version and hash filled in
            log 'Repository template: running the linux-install.sh of the latest release'
            curl -fsSL "https://github.com/${REPO}/releases/latest/download/linux-install.sh" | bash -s -- "$@" ||
                die 'Could not run the linux-install.sh of the latest release.'
            exit 0 ;;
    esac
    while [ $# -gt 0 ]; do
        case "$1" in
            --from-dir) [ $# -ge 2 ] || die '--from-dir needs a folder'; from_dir="$2"; shift 2 ;;
            *) die "Unknown option: $1" ;;
        esac
    done

    [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] ||
        die 'This installer supports Linux on a 64-bit Intel/AMD computer only.'

    log "Worldline Desktop $APP_VERSION"

    hash_of() {
        if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print toupper($1)}'
        else shasum -a 256 "$1" | awk '{print toupper($1)}'; fi
    }
    check_hash() {
        local actual
        actual=$(hash_of "$1")
        [ "$actual" = "$APP_SHA256" ] || die "SHA-256 of $(basename "$1") does not match this release ($actual). Nothing was installed."
    }

    install_app() {
        local work image
        mkdir -p "$APP_DIR" "$MENU_DIR"
        work=$(mktemp -d "$APP_DIR/.install.XXXXXX")
        trap "rm -rf '$work'" EXIT   # expanded now: $work is local and gone when the trap fires
        if [ -n "$from_dir" ]; then
            image="$from_dir/$APP_FILE"
            [ -f "$image" ] || die "$image not found"
        else
            image="$work/$APP_FILE"
            log "Downloading $APP_URL"
            curl -fsSL --retry 3 -o "$image" "$APP_URL" || die "Download failed: $APP_URL"
        fi
        cp "$image" "$work/new.AppImage"   # the copy is checked, so the file cannot change after the check
        check_hash "$work/new.AppImage"
        chmod +x "$work/new.AppImage"
        mv -f "$work/new.AppImage" "$TARGET"
        cat > "$MENU_DIR/worldline-desktop.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Worldline Desktop
Comment=Version control for your research data
Exec="$TARGET"
Terminal=false
Categories=Science;Utility;
DESKTOP
        log "Installed $TARGET (it is also in your application menu)"
    }

    install_app

    local missing=''
    command -v git >/dev/null 2>&1 || missing="$missing git"
    command -v git-annex >/dev/null 2>&1 || missing="$missing git-annex"
    command -v datalad >/dev/null 2>&1 || missing="$missing datalad"
    if [ -n "$missing" ]; then
        log "Still missing:$missing. Install them with your package manager, for example:"
        echo '  Debian / Ubuntu:  sudo apt install git git-annex datalad'
        echo '  Fedora:           sudo dnf install git git-annex datalad'
        echo '  Any distribution: Homebrew (brew install git-annex datalad) or pipx install datalad'
    fi
    command -v fusermount >/dev/null 2>&1 || command -v fusermount3 >/dev/null 2>&1 ||
        log 'AppImages need FUSE. If the app does not start: sudo apt install libfuse2 (Debian / Ubuntu) or sudo dnf install fuse (Fedora).'
    log "Done. Start Worldline Desktop from your application menu or run $TARGET"
}

main "$@"

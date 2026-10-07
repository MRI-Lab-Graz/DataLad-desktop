#!/bin/bash
# Installs DataLad Desktop for the current user (Apple silicon). No administrator rights needed for this script.
#
# Run it with:   curl -fsSL https://github.com/MRI-Lab-Graz/DataLad-desktop/releases/download/v<version>/install.sh | bash
# or download it and run:   bash install.sh
# The copy attached to a GitHub release has the version and the SHA-256 of that release's app zip filled in by CI.
# The copy in the repository is a template and refuses to run.
#
# Options:
#   --from-dir <folder>   take the zip from that folder (named as on the release page) instead of downloading it;
#                         its SHA-256 is still checked

# Everything lives in main, called on the last line: with `curl | bash` the shell reads this file from stdin, so it has
# to be parsed completely before any command that might read stdin runs.
main() {
    set -euo pipefail

    # ---- Pins ----
    local APP_VERSION='__VERSION__'
    local APP_ZIP_SHA256='__ZIP_SHA256__'
    local REPO='MRI-Lab-Graz/DataLad-desktop'
    local APP_ZIP_NAME="DataLad-Desktop-${APP_VERSION}-mac-arm64.zip"
    local APP_ZIP_URL="https://github.com/${REPO}/releases/download/v${APP_VERSION}/${APP_ZIP_NAME}"
    local BREW_INSTALL_URL='https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh'
    local APP_NAME='DataLad Desktop.app'
    local APP_DIR="$HOME/Applications"
    local LOG_DIR="$HOME/Library/Logs/DataLad Desktop"
    local from_dir=''

    die() { echo "ERROR: $*" >&2; exit 1; }
    log() { echo "==> $*"; }

    while [ $# -gt 0 ]; do
        case "$1" in
            --from-dir) [ $# -ge 2 ] || die '--from-dir needs a folder'; from_dir="$2"; shift 2 ;;
            *) die "Unknown option: $1" ;;
        esac
    done

    case "$APP_VERSION" in
        __*) die 'This is the repository template, not a release copy. Use the install.sh attached to a release.' ;;
    esac
    [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] ||
        die 'This installer supports Macs with Apple silicon only. Intel Macs: use the .dmg from the release page.'

    mkdir -p "$LOG_DIR"
    exec > >(tee -a "$LOG_DIR/install.log") 2>&1
    log "DataLad Desktop $APP_VERSION"

    check_hash() {
        local actual
        actual=$(shasum -a 256 "$1" | awk '{print toupper($1)}')
        [ "$actual" = "$APP_ZIP_SHA256" ] || die "SHA-256 of $(basename "$1") does not match this release ($actual). Nothing was installed."
    }

    install_app() {
        local target="$APP_DIR/$APP_NAME" old="$APP_DIR/$APP_NAME.old" work zip
        mkdir -p "$APP_DIR"
        work=$(mktemp -d "$APP_DIR/.install.XXXXXX")
        trap "rm -rf '$work'" EXIT   # expanded now: $work is local and gone when the trap fires
        if [ -n "$from_dir" ]; then
            zip="$from_dir/$APP_ZIP_NAME"
            [ -f "$zip" ] || die "$zip not found"
        else
            zip="$work/$APP_ZIP_NAME"
            log "Downloading $APP_ZIP_URL"
            curl -fsSL --retry 3 -o "$zip" "$APP_ZIP_URL" || die "Download failed: $APP_ZIP_URL"
        fi
        check_hash "$zip"
        ditto -x -k "$zip" "$work/x"
        [ -d "$work/x/$APP_NAME" ] || die "The zip has no $APP_NAME at its root."
        if pgrep -f "$APP_NAME/Contents/MacOS" >/dev/null 2>&1; then
            die 'DataLad Desktop is running. Quit it and run this installer again.'
        fi
        if [ -e "$target" ]; then
            rm -rf "$old"
            mv "$target" "$old"
        fi
        mv "$work/x/$APP_NAME" "$target"
        if ! codesign --verify --deep --strict "$target"; then
            rm -rf "$target"
            if [ -e "$old" ]; then mv "$old" "$target"; fi
            die 'The new app failed codesign verification; the previous install was restored.'
        fi
        rm -rf "$old"
        xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
        log "Installed $target"
    }

    find_brew() {
        command -v brew >/dev/null 2>&1 && return 0
        if [ -x /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
            return 0
        fi
        return 1
    }

    ensure_brew() {
        find_brew && return 0
        local cmd="/bin/bash -c \"\$(curl -fsSL $BREW_INSTALL_URL)\""
        if ! { : </dev/tty; } 2>/dev/null; then
            die "Homebrew is not installed and there is no terminal to ask you. Install it with:  $cmd  then run this installer again."
        fi
        printf 'Homebrew is not installed. It provides git-annex and DataLad. Install it now? [y/N] ' >/dev/tty
        local answer
        read -r answer </dev/tty || answer=n
        case "$answer" in
            [yY]*) log 'Running the Homebrew installer (not pinned or hash-checked by us)'
                   /bin/bash -c "$(curl -fsSL "$BREW_INSTALL_URL")" </dev/tty ;;
            *) die "Homebrew is needed. Install it with:  $cmd  then run this installer again." ;;
        esac
        find_brew || die 'Homebrew was installed but brew was not found. Open a new Terminal and run this installer again.'
    }

    install_tools() {
        local missing=''
        command -v git-annex >/dev/null 2>&1 || missing="$missing git-annex"
        command -v datalad >/dev/null 2>&1 || missing="$missing datalad"
        if [ -z "$missing" ]; then
            log 'git-annex and datalad are already installed'
            return 0
        fi
        ensure_brew
        log "brew install$missing"
        # shellcheck disable=SC2086  # word splitting of the package list is intended
        brew install $missing </dev/null
    }

    install_app
    git --version >/dev/null 2>&1 || die 'git is missing. Run  xcode-select --install  and run this installer again.'
    install_tools

    log 'Installed tools:'
    local tool
    for tool in git git-annex datalad; do
        printf '  %s -> %s\n' "$tool" "$(command -v "$tool" || echo 'NOT FOUND')"
    done
    if command -v datalad >/dev/null 2>&1; then datalad --version; fi
    log "Done. Open $APP_DIR/$APP_NAME. Log: $LOG_DIR/install.log"
}

main "$@"

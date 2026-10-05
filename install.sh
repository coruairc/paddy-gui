#!/usr/bin/env bash
# Paddy installer. Pulls this repo, runs npm install, and puts the
# `paddy` command on PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- --ref <branch>
#   curl -fsSL …/install.sh | bash -s -- --help
set -euo pipefail

REPO="${PADDY_REPO:-coruairc/paddy-gui}"
REF="${PADDY_REF:-main}"
PREFIX="${PADDY_HOME:-${HOME}/.paddy}"
GIT_DIR="${PADDY_GIT_DIR:-${HOME}/.local/share/paddy-gui}"
BIN_DIR="${PADDY_BIN_DIR:-${HOME}/.local/bin}"
DRY_RUN=0
YES=0

usage() {
  cat <<EOF
Paddy installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.sh | bash
  curl -fsSL …/install.sh | bash -s -- [flags]

Windows:
  powershell -c "irm https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.ps1 | iex"

Flags:
  --help            This text
  --yes             Install missing git / Node 22 without asking
  --ref <ref>       Git branch or tag (default: main)
  --repo <owner/repo> (default: coruairc/paddy-gui)
  --git-dir <path>  Checkout path (default: ~/.local/share/paddy-gui)
  --bin-dir <path>  Wrapper path (default: ~/.local/bin)
  --dry-run         Print actions, install nothing

After install:  paddy
EOF
}

log() { printf '==> %s\n' "$*"; }
die() { printf 'paddy install: %s\n' "$*" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

ask_yes() {
  if [ "$YES" = 1 ] || [ "${PADDY_YES:-}" = 1 ]; then
    log "$1 → yes"
    return 0
  fi
  if [ -r /dev/tty ]; then
    printf '%s [Y/n] ' "$1" >/dev/tty
    local ans=""
    read -r ans </dev/tty || return 1
    case "$ans" in ""|y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
  fi
  return 1
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    return 1
  fi
}

pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then
    as_root env DEBIAN_FRONTEND=noninteractive apt-get update -y
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then
    as_root yum install -y "$@"
  elif command -v pacman >/dev/null 2>&1; then
    as_root pacman -Sy --noconfirm "$@"
  elif command -v apk >/dev/null 2>&1; then
    as_root apk add --no-cache "$@"
  elif command -v brew >/dev/null 2>&1; then
    brew install "$@"
  else
    return 1
  fi
}

download() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$out"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$out" "$url"
  else
    die "need curl or wget to download $url"
  fi
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then return 0; fi
  if ask_yes "git is not installed. Install git now?"; then
    log "installing git"
    if [ "$DRY_RUN" = 1 ]; then
      printf '[dry-run] install git\n'
      return 0
    fi
    if ! pkg_install git; then
      if [ "$(uname -s)" = Darwin ]; then
        die "could not install git. Try: brew install git   or   xcode-select --install"
      fi
      die "could not install git. Try: apt-get install -y git"
    fi
    command -v git >/dev/null 2>&1 || die "git still missing after install"
    log "$(git --version | head -1)"
    return 0
  fi
  die "need git on PATH. Install it, then re-run. Debian: apt-get install -y git · macOS: brew install git"
}

node_os_arch() {
  local sys arch
  sys=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    armv7l) arch=armv7l ;;
    *) die "unsupported CPU: $arch — install Node.js 22+ from https://nodejs.org" ;;
  esac
  case "$sys" in
    linux|darwin) ;;
    *) die "unsupported OS: $sys — install Node.js 22+ from https://nodejs.org" ;;
  esac
  printf '%s %s\n' "$sys" "$arch"
}

install_node_tarball() {
  local sys arch sums name tmp tarball
  read -r sys arch <<EOF
$(node_os_arch)
EOF
  tmp=$(mktemp -d)
  local idx="${tmp}/SHASUMS256.txt"
  log "fetching Node.js 22 index"
  download "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" "$idx"
  sums=$(cat "$idx")
  name=$(printf '%s\n' "$sums" | awk '{print $2}' | grep -E "^node-v22\\.[0-9.]+-${sys}-${arch}\\.tar\\.gz$" | head -1 || true)
  [ -n "$name" ] || die "no Node.js 22 build for ${sys}-${arch}"
  tarball="${tmp}/${name}"
  log "downloading ${name}"
  download "https://nodejs.org/dist/latest-v22.x/${name}" "$tarball"
  mkdir -p "${HOME}/.local"
  tar -xz -C "${HOME}/.local" --strip-components=1 -f "$tarball"
  rm -rf "$tmp"
  export PATH="${HOME}/.local/bin:${PATH}"
}

ensure_node() {
  local major
  major="$(node_major)"
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && [ "$major" -ge 22 ]; then
    return 0
  fi
  local reason="Node.js is not installed"
  if command -v node >/dev/null 2>&1 && [ "$major" -lt 22 ]; then
    reason="Node.js $major is too old (need 22+)"
  elif command -v node >/dev/null 2>&1 && ! command -v npm >/dev/null 2>&1; then
    reason="npm is not installed"
  fi
  if ask_yes "${reason}. Install Node.js 22 now?"; then
    log "installing Node.js 22"
    if [ "$DRY_RUN" = 1 ]; then
      printf '[dry-run] install Node.js 22 into %s/.local\n' "$HOME"
      return 0
    fi
    if command -v brew >/dev/null 2>&1; then
      brew install node@22 2>/dev/null || brew install node
      if [ -x /opt/homebrew/opt/node@22/bin/node ]; then
        export PATH="/opt/homebrew/opt/node@22/bin:${PATH}"
      elif [ -x /usr/local/opt/node@22/bin/node ]; then
        export PATH="/usr/local/opt/node@22/bin:${PATH}"
      fi
    else
      install_node_tarball
    fi
    export PATH="${HOME}/.local/bin:${PATH}"
    hash -r 2>/dev/null || true
    major="$(node_major)"
    command -v node >/dev/null 2>&1 || die "node still missing after install"
    command -v npm >/dev/null 2>&1 || die "npm still missing after install"
    if [ "$major" -lt 22 ]; then
      die "Node.js still too old after install ($major). See https://nodejs.org"
    fi
    return 0
  fi
  die "${reason}. Install Node.js 22+ from https://nodejs.org then re-run."
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --yes|-y) YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --ref) REF="${2:-}"; shift ;;
    --git-dir) GIT_DIR="${2:-}"; shift ;;
    --bin-dir) BIN_DIR="${2:-}"; shift ;;
    --repo) REPO="${2:-}"; shift ;;
    *) die "unknown flag: $1 (try --help)" ;;
  esac
  shift
done

[ -n "$REF" ] || die "--ref needs a value"
[ -n "$GIT_DIR" ] || die "--git-dir needs a value"
case "$REF" in
  *[!A-Za-z0-9._/-]*|-*) die "bad --ref" ;;
esac
case "$REPO" in
  *[!A-Za-z0-9._/-]*|-*) die "bad --repo" ;;
esac
case "$BIN_DIR$GIT_DIR" in
  *['$`";|&<>']*) die "bad path" ;;
esac

node_major() {
  node -p "parseInt(process.versions.node, 10)" 2>/dev/null || echo 0
}

log "Paddy · $REPO@$REF"

ensure_git
ensure_node
log "node $(node -v) · npm $(npm -v | tr -d '\r')"

clone_url="https://github.com/${REPO}.git"
if [ -d "${GIT_DIR}/.git" ]; then
  log "updating ${GIT_DIR}"
  run git -C "$GIT_DIR" fetch --depth 1 origin "$REF"
  run git -C "$GIT_DIR" reset --hard FETCH_HEAD
else
  log "cloning ${clone_url} → ${GIT_DIR}"
  run mkdir -p "$(dirname "$GIT_DIR")"
  run git clone --depth 1 --branch "$REF" "$clone_url" "$GIT_DIR"
fi

if [ ! -f "${GIT_DIR}/bin/paddy.mjs" ] && [ "$DRY_RUN" != 1 ]; then
  die "checkout is missing bin/paddy.mjs — is $REPO the Paddy repo?"
fi

log "npm install"
if [ "$DRY_RUN" = 1 ]; then
  printf '[dry-run] npm install (in %s)\n' "$GIT_DIR"
else
  (cd "$GIT_DIR" && npm install --no-fund --no-audit)
fi

log "wrapper → ${BIN_DIR}/paddy"
if [ "$DRY_RUN" = 1 ]; then
  printf '[dry-run] write %s/paddy\n' "$BIN_DIR"
else
  PADDY_BIN_DIR="$BIN_DIR" node "${GIT_DIR}/scripts/link-cli.mjs"
fi

linked_usr=0
if [ "$DRY_RUN" = 1 ]; then
  if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    printf '[dry-run] also /usr/local/bin/paddy\n'
  fi
elif [ -d /usr/local/bin ] && [ -w /usr/local/bin ] && [ -f "${BIN_DIR}/paddy" ]; then
  cp "${BIN_DIR}/paddy" /usr/local/bin/paddy
  chmod 755 /usr/local/bin/paddy
  linked_usr=1
  log "also /usr/local/bin/paddy"
fi

path_has_bin=0
case ":${PATH}:" in
  *":${BIN_DIR}:"*) path_has_bin=1 ;;
esac
if [ "$path_has_bin" != 1 ]; then
  profile=""
  if [ -n "${ZSH_VERSION:-}" ] || [ -f "${HOME}/.zshrc" ]; then
    profile="${HOME}/.zshrc"
  elif [ -f "${HOME}/.bashrc" ]; then
    profile="${HOME}/.bashrc"
  else
    profile="${HOME}/.profile"
  fi
  marker="# paddy cli"
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] append PATH to %s\n' "$profile"
  elif ! grep -Fqs "$marker" "$profile" 2>/dev/null; then
    printf '\n%s\nexport PATH="%s:$PATH"\n' "$marker" "$BIN_DIR" >> "$profile"
    log "added ${BIN_DIR} to PATH in ${profile}"
  fi
fi

printf '\n\033[1;32mPaddy installed\033[0m\n\n'
cat <<EOF
  paddy              # start the desk at http://127.0.0.1:8080
  paddy update       # pull the latest and reinstall
  paddy doctor       # print install + runtime info
  paddy uninstall    # remove the wrapper

Paddy is the interface. OpenCode does the work.
EOF

if [ "$path_has_bin" != 1 ]; then
  if [ "$linked_usr" = 1 ]; then
    cat <<EOF
paddy is also at /usr/local/bin/paddy — try it:

  hash -r
  paddy

EOF
  else
    cat <<EOF
This terminal does not have ${BIN_DIR} on PATH yet. Run:

  export PATH="${BIN_DIR}:\$PATH"
  hash -r
  paddy

Or call it directly:

  ${BIN_DIR}/paddy

EOF
  fi
fi
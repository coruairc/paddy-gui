#!/usr/bin/env bash
# Paddy installer — Irish-roots super harness.
# Not affiliated with the OpenClaw Foundation or Nous Research.
#
#   curl -fsSL https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- --no-config
#   curl -fsSL …/install.sh | bash -s -- --help
set -euo pipefail

REPO="${PADDY_REPO:-coruairc/paddy-gui}"
REF="${PADDY_REF:-main}"
PREFIX="${PADDY_HOME:-${HOME}/.paddy}"
GIT_DIR="${PADDY_GIT_DIR:-${PREFIX}/src}"
BIN_DIR="${PADDY_BIN_DIR:-${HOME}/.local/bin}"
ONBOARD=1
DRY_RUN=0
YES=0

usage() {
  cat <<EOF
Paddy installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.sh | bash -s -- [flags]

Windows:
  powershell -c "irm https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.ps1 | iex"

Flags:
  --help            This text
  --yes             Install missing git / Node 22 without asking
  --no-onboard      Skip paddy config
  --no-config       Same as --no-onboard
  --ref <ref>       Git branch or tag (default: main)
  --git-dir <path>  Checkout path (default: ~/.paddy/src)
  --bin-dir <path>  Wrapper path (default: ~/.local/bin)
  --dry-run         Print actions, install nothing

If git or Node.js 22+ is missing, the installer offers to install them.
After install:  paddy gateway
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
  local sys arch sums name tmp tarball idx
  read -r sys arch <<EOF
$(node_os_arch)
EOF
  tmp=$(mktemp -d)
  idx="${tmp}/SHASUMS256.txt"
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

paddy_mark() {
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
    cat <<'PADDYMARK'
            [38;2;0;0;0m▄[0m[38;2;0;0;0m▄[0m[38;2;1;1;1m▄[0m[38;2;0;0;0;48;2;3;3;3m▀[0m[38;2;1;1;1;48;2;0;0;0m▀[0m[38;2;2;2;2;48;2;0;0;0m▀[0m[38;2;3;3;3;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;8;7;7m▀[0m[38;2;0;0;0;48;2;26;16;16m▀[0m[38;2;32;12;8m▄[0m[38;2;106;43;5m▄[0m[38;2;76;29;10m▄[0m
        [38;2;0;0;0m▄[0m[38;2;0;2;0m▄[0m[38;2;0;0;0;48;2;0;3;0m▀[0m[38;2;0;1;0;48;2;0;0;0m▀[0m[38;2;0;2;1;48;2;0;0;0m▀[0m[38;2;0;1;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;9;10;9m▀[0m[38;2;0;0;0;48;2;84;83;83m▀[0m[38;2;1;1;1;48;2;186;185;185m▀[0m[38;2;51;51;51;48;2;247;247;246m▀[0m[38;2;115;116;117;48;2;252;250;249m▀[0m[38;2;148;138;133;48;2;252;252;250m▀[0m[38;2;205;128;75;48;2;255;201;145m▀[0m[38;2;237;113;17;48;2;255;114;5m▀[0m[38;2;255;116;4;48;2;242;112;5m▀[0m[38;2;97;37;13;48;2;155;70;9m▀[0m[38;2;8;4;5;48;2;23;10;5m▀[0m[38;2;3;1;0;48;2;1;1;0m▀[0m[38;2;0;0;0m▄[0m[38;2;0;0;0m▄[0m
      [38;2;0;0;0m▄[0m[38;2;0;2;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;2;12;3m▀[0m[38;2;0;0;0;48;2;7;62;14m▀[0m[38;2;1;0;0;48;2;6;105;18m▀[0m[38;2;3;14;5;48;2;5;181;26m▀[0m[38;2;18;64;24;48;2;12;196;33m▀[0m[38;2;84;108;87;48;2;95;229;111m▀[0m[38;2;191;194;192;48;2;216;255;221m▀[0m[38;2;255;255;255;48;2;232;234;224m▀[0m[38;2;255;255;255;48;2;210;204;189m▀[0m[38;2;255;255;255;48;2;200;184;164m▀[0m[38;2;255;255;255;48;2;196;171;149m▀[0m[38;2;255;255;255;48;2;195;171;152m▀[0m[38;2;254;171;99;48;2;230;166;102m▀[0m[38;2;252;112;0;48;2;249;150;22m▀[0m[38;2;221;109;5;48;2;215;115;12m▀[0m[38;2;79;34;12;48;2;125;54;9m▀[0m[38;2;1;0;6;48;2;165;63;3m▀[0m[38;2;12;5;5;48;2;209;73;7m▀[0m[38;2;39;12;9;48;2;236;82;5m▀[0m[38;2;35;12;8;48;2;198;68;9m▀[0m[38;2;9;3;3;48;2;42;13;9m▀[0m[38;2;1;1;1m▄[0m
     [38;2;0;0;0;48;2;4;30;8m▀[0m[38;2;4;5;3;48;2;7;117;23m▀[0m[38;2;6;66;14;48;2;5;202;33m▀[0m[38;2;4;167;28;48;2;3;197;29m▀[0m[38;2;2;218;30;48;2;5;148;25m▀[0m[38;2;1;209;28;48;2;3;157;24m▀[0m[38;2;0;210;26;48;2;58;195;67m▀[0m[38;2;23;219;38;48;2;92;115;69m▀[0m[38;2;94;182;85;48;2;77;53;41m▀[0m[38;2;129;122;99;48;2;70;47;35m▀[0m[38;2;93;76;54;48;2;79;57;45m▀[0m[38;2;81;57;38;48;2;105;81;68m▀[0m[38;2;96;68;45;48;2;118;96;81m▀[0m[38;2;93;61;39;48;2;94;72;60m▀[0m[38;2;89;52;30;48;2;96;72;57m▀[0m[38;2;111;70;48;48;2;92;66;51m▀[0m[38;2;147;95;59;48;2;86;60;46m▀[0m[38;2;194;118;53;48;2;107;72;57m▀[0m[38;2;247;144;33;48;2;147;93;62m▀[0m[38;2;255;128;7;48;2;215;136;60m▀[0m[38;2;255;85;0;48;2;255;132;26m▀[0m[38;2;255;94;0;48;2;232;81;3m▀[0m[38;2;201;68;9;48;2;92;30;11m▀[0m[38;2;23;7;9;48;2;7;3;2m▀[0m[38;2;3;1;1;48;2;0;0;0m▀[0m[38;2;2;1;1;48;2;0;0;0m▀[0m
    [38;2;7;37;12;48;2;8;32;11m▀[0m[38;2;9;108;25;48;2;7;45;12m▀[0m[38;2;7;151;28;48;2;4;9;4m▀[0m[38;2;9;117;23;48;2;7;0;4m▀[0m[38;2;12;44;16;48;2;10;83;20m▀[0m[38;2;3;97;15;48;2;5;217;34m▀[0m[38;2;45;198;61;48;2;54;147;62m▀[0m[38;2;72;86;57;48;2;28;18;17m▀[0m[38;2;51;32;27;48;2;34;31;23m▀[0m[38;2;60;49;37;48;2;40;31;27m▀[0m[38;2;71;55;43;48;2;48;36;31m▀[0m[38;2;95;75;62;48;2;54;42;35m▀[0m[38;2;120;98;82;48;2;52;41;33m▀[0m[38;2;115;92;77;48;2;56;43;36m▀[0m[38;2;89;66;54;48;2;74;58;48m▀[0m[38;2;94;72;57;48;2;94;74;62m▀[0m[38;2;95;73;59;48;2;81;62;52m▀[0m[38;2;103;75;58;48;2;103;81;66m▀[0m[38;2;91;61;46;48;2;86;64;52m▀[0m[38;2;87;62;49;48;2;83;52;37m▀[0m[38;2;85;60;51;48;2;53;36;27m▀[0m[38;2;193;115;53;48;2;80;42;26m▀[0m[38;2;180;80;24;48;2;177;90;29m▀[0m[38;2;2;0;3;48;2;104;40;7m▀[0m[38;2;0;0;3;48;2;156;57;7m▀[0m[38;2;20;6;7;48;2;217;81;7m▀[0m[38;2;27;10;9;48;2;138;48;14m▀[0m[38;2;4;2;1;48;2;15;6;6m▀[0m
   [38;2;1;3;1;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;1;3;1m▀[0m[38;2;0;0;0;48;2;5;35;9m▀[0m[38;2;3;23;5;48;2;9;87;20m▀[0m[38;2;7;122;22;48;2;9;156;30m▀[0m[38;2;4;198;30;48;2;0;198;27m▀[0m[38;2;2;213;27;48;2;0;200;19m▀[0m[38;2;31;188;49;48;2;0;204;18m▀[0m[38;2;21;30;16;48;2;22;90;25m▀[0m[38;2;0;0;0;48;2;17;60;25m▀[0m[38;2;2;2;0;48;2;4;76;19m▀[0m[38;2;14;13;8;48;2;0;16;0m▀[0m[38;2;38;25;24;48;2;0;17;0m▀[0m[38;2;61;46;38;48;2;3;3;3m▀[0m[38;2;67;51;40;48;2;26;13;14m▀[0m[38;2;46;33;27;48;2;58;42;35m▀[0m[38;2;30;20;17;48;2;72;54;45m▀[0m[38;2;32;23;18;48;2;60;43;39m▀[0m[38;2;34;23;18;48;2;38;24;24m▀[0m[38;2;45;32;26;48;2;16;12;9m▀[0m[38;2;37;23;19;48;2;15;15;10m▀[0m[38;2;71;42;28;48;2;25;15;11m▀[0m[38;2;53;26;21;48;2;42;20;16m▀[0m[38;2;199;104;24;48;2;182;95;27m▀[0m[38;2;255;129;3;48;2;252;132;5m▀[0m[38;2;255;105;0;48;2;246;98;1m▀[0m[38;2;235;87;5;48;2;219;78;11m▀[0m[38;2;68;21;11;48;2;70;23;13m▀[0m[38;2;1;1;1;48;2;4;2;2m▀[0m[38;2;1;1;0;48;2;1;0;0m▀[0m
  [38;2;0;2;0m▄[0m[38;2;0;2;1;48;2;0;0;0m▀[0m[38;2;2;2;1;48;2;6;28;8m▀[0m[38;2;7;21;8;48;2;6;162;27m▀[0m[38;2;4;100;17;48;2;1;226;29m▀[0m[38;2;0;188;15;48;2;136;246;121m▀[0m[38;2;4;216;32;48;2;235;255;208m▀[0m[38;2;27;204;51;48;2;255;246;207m▀[0m[38;2;33;108;44;48;2;255;234;176m▀[0m[38;2;0;8;1;48;2;173;170;108m▀[0m[38;2;33;128;55;48;2;15;108;41m▀[0m[38;2;10;99;31;48;2;0;82;20m▀[0m[38;2;10;8;9;48;2;45;37;40m▀[0m[38;2;26;72;37;48;2;247;243;244m▀[0m[38;2;0;59;9;48;2;69;90;71m▀[0m[38;2;4;40;16;48;2;4;57;16m▀[0m[38;2;3;14;8;48;2;11;76;27m▀[0m[38;2;8;16;10;48;2;6;65;18m▀[0m[38;2;22;38;22;48;2;0;42;1m▀[0m[38;2;5;36;6;48;2;64;101;73m▀[0m[38;2;0;27;0;48;2;121;132;122m▀[0m[38;2;0;24;3;48;2;1;0;0m▀[0m[38;2;4;22;2;48;2;7;31;3m▀[0m[38;2;10;0;2;48;2;142;76;9m▀[0m[38;2;140;69;18;48;2;225;115;8m▀[0m[38;2;255;129;4;48;2;252;107;0m▀[0m[38;2;255;101;0;48;2;198;73;7m▀[0m[38;2;168;61;5;48;2;105;34;11m▀[0m[38;2;7;2;3;48;2;93;31;10m▀[0m[38;2;5;2;2;48;2;9;4;4m▀[0m[38;2;1;0;0;48;2;2;1;1m▀[0m[38;2;0;0;0m▄[0m
  [38;2;0;0;0;48;2;6;17;8m▀[0m[38;2;6;52;13;48;2;8;88;21m▀[0m[38;2;6;162;31;48;2;5;49;13m▀[0m[38;2;3;138;21;48;2;6;25;8m▀[0m[38;2;24;130;42;48;2;19;31;20m▀[0m[38;2;195;178;133;48;2;25;41;30m▀[0m[38;2;192;168;139;48;2;31;29;29m▀[0m[38;2;138;114;81;48;2;0;2;4m▀[0m[38;2;120;83;46;48;2;0;0;0m▀[0m[38;2;169;133;87;48;2;106;52;32m▀[0m[38;2;38;88;41;48;2;28;36;23m▀[0m[38;2;98;107;32;48;2;210;99;26m▀[0m[38;2;0;22;8;48;2;154;71;4m▀[0m[38;2;184;202;199;48;2;60;62;9m▀[0m[38;2;122;134;140;48;2;137;94;11m▀[0m[38;2;0;0;0;48;2;172;94;15m▀[0m[38;2;0;31;11;48;2;114;67;10m▀[0m[38;2;0;21;0;48;2;116;94;9m▀[0m[38;2;87;104;89;48;2;58;97;46m▀[0m[38;2;255;255;255;48;2;108;142;125m▀[0m[38;2;200;194;194;48;2;11;49;33m▀[0m[38;2;0;0;0;48;2;19;30;3m▀[0m[38;2;11;33;9;48;2;163;65;8m▀[0m[38;2;211;119;10;48;2;246;139;12m▀[0m[38;2;255;141;0;48;2;232;107;3m▀[0m[38;2;248;94;1;48;2;219;82;4m▀[0m[38;2;237;88;4;48;2;201;73;8m▀[0m[38;2;233;83;7;48;2;81;28;10m▀[0m[38;2;70;23;10;48;2;0;0;3m▀[0m[38;2;11;4;4;48;2;3;1;1m▀[0m[38;2;2;1;1;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m
  [38;2;2;5;2;48;2;0;0;0m▀[0m[38;2;1;0;0;48;2;0;1;0m▀[0m[38;2;3;1;2;48;2;0;1;0m▀[0m[38;2;0;1;0;48;2;0;0;0m▀[0m[38;2;5;6;6;48;2;21;41;29m▀[0m[38;2;30;49;33;48;2;41;65;50m▀[0m[38;2;22;19;18;48;2;15;11;13m▀[0m[38;2;17;16;12;48;2;3;3;3m▀[0m[38;2;4;3;2;48;2;0;0;0m▀[0m[38;2;79;35;14;48;2;26;2;0m▀[0m[38;2;23;28;14;48;2;101;88;47m▀[0m[38;2;73;45;16;48;2;23;100;37m▀[0m[38;2;255;85;7;48;2;93;58;11m▀[0m[38;2;212;60;1;48;2;230;60;2m▀[0m[38;2;208;70;5;48;2;236;86;7m▀[0m[38;2;209;66;6;48;2;241;121;16m▀[0m[38;2;201;47;0;48;2;245;117;12m▀[0m[38;2;235;99;13;48;2;206;64;3m▀[0m[38;2;192;78;0;48;2;201;54;4m▀[0m[38;2;88;48;0;48;2;231;58;4m▀[0m[38;2;131;65;2;48;2;241;56;3m▀[0m[38;2;222;61;1;48;2;168;46;10m▀[0m[38;2;216;93;17;48;2;31;18;6m▀[0m[38;2;66;36;11;48;2;0;0;3m▀[0m[38;2;103;29;12;48;2;30;11;6m▀[0m[38;2;103;35;10;48;2;2;1;3m▀[0m[38;2;35;11;10;48;2;0;0;0m▀[0m[38;2;3;1;2;48;2;0;0;0m▀[0m[38;2;1;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m
  [38;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;1;0;48;2;0;1;1m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;30;64;44;48;2;10;41;22m▀[0m[38;2;31;31;31;48;2;7;28;14m▀[0m[38;2;19;18;19;48;2;1;0;0m▀[0m[38;2;4;4;3;48;2;10;9;7m▀[0m[38;2;3;2;1;48;2;0;0;0m▀[0m[38;2;11;0;1;48;2;45;8;0m▀[0m[38;2;66;49;37;48;2;47;25;11m▀[0m[38;2;44;107;37;48;2;12;38;6m▀[0m[38;2;0;42;3;48;2;3;31;2m▀[0m[38;2;51;16;3;48;2;0;50;7m▀[0m[38;2;185;39;0;48;2;34;48;29m▀[0m[38;2;255;88;2;48;2;167;43;17m▀[0m[38;2;255;94;6;48;2;133;16;0m▀[0m[38;2;228;63;0;48;2;87;28;21m▀[0m[38;2;195;43;0;48;2;84;47;41m▀[0m[38;2;153;29;5;48;2;2;36;2m▀[0m[38;2;116;40;11;48;2;2;63;8m▀[0m[38;2;56;33;9;48;2;57;82;12m▀[0m[38;2;0;0;0;48;2;61;42;9m▀[0m[38;2;4;3;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;3;2;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;2;1;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0m▀[0m
   [38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;1;2;1;48;2;2;1;1m▀[0m[38;2;4;20;7;48;2;0;0;0m▀[0m[38;2;52;45;30;48;2;75;62;48m▀[0m[38;2;46;18;12;48;2;150;121;96m▀[0m[38;2;13;3;4;48;2;90;82;60m▀[0m[38;2;109;57;32;48;2;70;53;33m▀[0m[38;2;41;48;16;48;2;16;15;9m▀[0m[38;2;0;22;3;48;2;9;18;10m▀[0m[38;2;4;23;3;48;2;14;96;34m▀[0m[38;2;2;64;14;48;2;2;50;7m▀[0m[38;2;14;74;29;48;2;4;42;9m▀[0m[38;2;87;101;84;48;2;13;88;33m▀[0m[38;2;4;53;20;48;2;15;98;33m▀[0m[38;2;93;117;97;48;2;18;70;28m▀[0m[38;2;32;62;36;48;2;0;43;4m▀[0m[38;2;11;160;6;48;2;7;76;14m▀[0m[38;2;17;133;8;48;2;12;51;2m▀[0m[38;2;0;46;9;48;2;6;37;7m▀[0m[38;2;59;99;16;48;2;0;82;13m▀[0m[38;2;47;32;8;48;2;58;79;15m▀[0m[38;2;0;0;0;48;2;12;5;2m▀[0m[38;2;1;1;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;1;1;1m▀[0m
    [38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;1;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;14;13;10;48;2;0;0;0m▀[0m[38;2;9;10;7;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;13;17;13m▀[0m[38;2;3;0;2;48;2;46;137;66m▀[0m[38;2;29;96;46;48;2;5;100;25m▀[0m[38;2;22;87;20;48;2;11;59;13m▀[0m[38;2;44;60;14;48;2;23;22;11m▀[0m[38;2;1;42;6;48;2;16;36;15m▀[0m[38;2;0;82;18;48;2;82;93;45m▀[0m[38;2;47;75;23;48;2;100;89;44m▀[0m[38;2;0;62;8;48;2;41;58;18m▀[0m[38;2;3;42;7;48;2;0;20;4m▀[0m[38;2;1;39;8;48;2;6;28;7m▀[0m[38;2;24;18;18;48;2;37;35;37m▀[0m[38;2;81;92;60;48;2;34;29;34m▀[0m[38;2;32;110;38;48;2;72;61;33m▀[0m[38;2;39;68;3;48;2;80;60;10m▀[0m[38;2;26;14;4;48;2;6;2;1m▀[0m[38;2;0;0;0;48;2;1;1;0m▀[0m[38;2;1;1;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;1;1;1m▀[0m
     [38;2;0;0;0;48;2;2;2;2m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;2;2;1;48;2;0;0;0m▀[0m[38;2;4;6;4;48;2;4;6;4m▀[0m[38;2;43;75;51;48;2;7;25;9m▀[0m[38;2;14;64;26;48;2;0;41;3m▀[0m[38;2;0;6;0;48;2;1;24;3m▀[0m[38;2;0;11;3;48;2;4;61;17m▀[0m[38;2;0;16;6;48;2;1;66;12m▀[0m[38;2;28;18;15;48;2;0;49;7m▀[0m[38;2;108;69;42;48;2;25;35;9m▀[0m[38;2;88;57;35;48;2;45;41;14m▀[0m[38;2;75;43;23;48;2;5;32;3m▀[0m[38;2;0;0;4;48;2;0;47;7m▀[0m[38;2;3;16;3;48;2;1;22;3m▀[0m[38;2;14;11;13;48;2;5;17;1m▀[0m[38;2;0;4;11;48;2;62;35;6m▀[0m[38;2;46;22;10;48;2;14;8;4m▀[0m[38;2;39;21;7;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;1;0;0m▀[0m[38;2;1;1;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;4;4;4m▀[0m
      [38;2;2;2;2m▀[0m[38;2;0;0;0;48;2;2;2;2m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;2;0;1m▀[0m[38;2;0;3;1;48;2;7;0;0m▀[0m[38;2;1;11;1;48;2;33;62;35m▀[0m[38;2;28;99;43;48;2;30;91;46m▀[0m[38;2;4;105;29;48;2;5;51;15m▀[0m[38;2;0;82;19;48;2;1;60;13m▀[0m[38;2;0;51;7;48;2;26;44;2m▀[0m[38;2;21;19;3;48;2;61;31;6m▀[0m[38;2;10;15;3;48;2;17;1;2m▀[0m[38;2;13;49;6;48;2;40;71;9m▀[0m[38;2;0;76;16;48;2;1;65;7m▀[0m[38;2;0;51;9;48;2;2;61;14m▀[0m[38;2;14;45;1;48;2;13;28;6m▀[0m[38;2;107;83;8;48;2;85;49;10m▀[0m[38;2;12;8;2;48;2;5;2;1m▀[0m[38;2;2;1;0;48;2;0;0;0m▀[0m[38;2;1;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;0;0;0m▀[0m[38;2;0;0;0;48;2;3;3;3m▀[0m[38;2;3;3;3m▀[0m
        [38;2;3;3;2m▀[0m[38;2;8;14;1m▀[0m[38;2;20;32;0;48;2;8;30;2m▀[0m[38;2;45;92;31;48;2;12;51;14m▀[0m[38;2;37;83;52;48;2;4;4;5m▀[0m[38;2;25;22;24;48;2;12;9;7m▀[0m[38;2;19;14;18;48;2;14;10;4m▀[0m[38;2;0;2;5;48;2;16;6;1m▀[0m[38;2;82;47;5;48;2;78;33;3m▀[0m[38;2;148;68;3;48;2;148;63;2m▀[0m[38;2;127;41;0;48;2;155;58;1m▀[0m[38;2;123;85;15;48;2;108;58;10m▀[0m[38;2;9;45;15;48;2;17;19;8m▀[0m[38;2;16;14;17;48;2;14;5;6m▀[0m[38;2;20;23;26;48;2;16;14;11m▀[0m[38;2;64;37;16;48;2;3;4;6m▀[0m[38;2;108;49;9;48;2;66;24;4m▀[0m[38;2;24;3;0;48;2;44;9;2m▀[0m[38;2;4;1;1m▀[0m[38;2;6;6;6m▀[0m
            [38;2;3;2;2m▀[0m[38;2;4;1;0m▀[0m[38;2;10;3;0m▀[0m[38;2;21;7;0;48;2;0;2;3m▀[0m[38;2;30;10;0;48;2;0;1;3m▀[0m[38;2;42;12;0;48;2;0;0;2m▀[0m[38;2;43;13;0;48;2;0;0;2m▀[0m[38;2;31;8;0;48;2;0;2;3m▀[0m[38;2;22;4;0;48;2;0;3;4m▀[0m[38;2;14;3;0m▀[0m[38;2;9;1;0m▀[0m[38;2;8;2;1m▀[0m
PADDYMARK
  else
    cat <<'PADDYPLAIN'
              .-----.
           .-'#######'-.
          /########### \
         | ###     ### |
         |  (•)   (•)  |
          \    ___    /
           |  /~~~\  |
           |  |   |  |
           |  |   |  |
            \ '---' /
PADDYPLAIN
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --yes|-y) YES=1 ;;
    --no-onboard|--no-config) ONBOARD=0 ;;
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

log "Paddy Irishman · $REPO@$REF"

ensure_git
ensure_node
log "node $(node -v) · npm $(npm -v | tr -d '\r')"

clone_url="https://github.com/${REPO}.git"
if [ -d "${GIT_DIR}/.git" ]; then
  log "updating ${GIT_DIR}"
  run git -C "$GIT_DIR" fetch --depth 1 origin "$REF"
  run git -C "$GIT_DIR" checkout -q FETCH_HEAD
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
  export PATH="${BIN_DIR}:${PATH}"
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

if [ "$ONBOARD" = 1 ]; then
  log "paddy config"
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] PADDY_HOME=%s paddy config --yes\n' "$PREFIX"
  else
    PADDY_HOME="$PREFIX" "${BIN_DIR}/paddy" config --yes || log "config skipped (run paddy config later)"
  fi
fi

paddy_mark
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  printf '\n\033[1;32mPaddy installed successfully, Sláinte🍀\033[0m\n\n'
else
  printf '\nPaddy installed successfully, Sláinte🍀\n\n'
fi
cat <<EOF
  paddy gateway          # start the control plane
  paddy dashboard        # web console
  paddy chat "hello"
  paddy models
  paddy doctor

Put keys in ${GIT_DIR}/selfhost.env or ${PREFIX}/selfhost.env, then prefer a model.

EOF
if [ "$path_has_bin" != 1 ]; then
  if [ "$linked_usr" = 1 ]; then
    cat <<EOF
paddy is also at /usr/local/bin/paddy — try paddy gateway now.
If this shell still says command not found:

  hash -r
  paddy gateway

EOF
  else
    cat <<EOF
This terminal does not have ${BIN_DIR} on PATH yet. Run:

  export PATH="${BIN_DIR}:\$PATH"
  hash -r
  paddy gateway

Or call it directly:

  ${BIN_DIR}/paddy gateway

EOF
  fi
fi

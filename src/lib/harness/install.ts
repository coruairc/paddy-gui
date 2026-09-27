export const INSTALL_REPO = "coruairc/paddy-gui";
export const INSTALL_RAW =
  "https://raw.githubusercontent.com/coruairc/paddy-gui/main";
export const INSTALL_PAGES = "https://coruairc.github.io/paddy";

export const INSTALL_SH = `curl -fsSL ${INSTALL_RAW}/install.sh | bash`;
export const INSTALL_PS1 = `irm ${INSTALL_RAW}/install.ps1 | iex`;
export const INSTALL_PS1_CMD = `powershell -c "irm ${INSTALL_RAW}/install.ps1 | iex"`;

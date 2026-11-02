{
  lib,
  python3Packages,
  qt6,
  makeWrapper,
  ffmpeg,
  gpu-screen-recorder,
  wf-recorder,
  wl-clipboard,
  xclip,
  xdotool,
  xprop,
  wmctrl,
  cloudflared,
  kdotool,
  withQtWebEngine ? true,
  extraRuntimePaths ? [ ],
}:

let
  runtimeDeps = [
    ffmpeg
    gpu-screen-recorder
    wf-recorder
    wl-clipboard
    xclip
    xdotool
    xprop
    wmctrl
    cloudflared
    kdotool
  ] ++ extraRuntimePaths;
in
python3Packages.buildPythonApplication rec {
  pname = "gloaming-clipper";
  version = builtins.head (builtins.match ''.*__version__ = "([^"]+)".*'' (builtins.readFile ../gloaming/__init__.py));
  pyproject = true;

  src = lib.cleanSource ../.;

  build-system = with python3Packages; [ setuptools wheel ];

  nativeBuildInputs = [ makeWrapper ] ++ lib.optional withQtWebEngine qt6.wrapQtAppsHook;

  buildInputs = lib.optionals withQtWebEngine [ qt6.qtbase qt6.qtwebengine ];

  dependencies = with python3Packages; [
    evdev
    aiohttp
    click
    tomli-w
    psutil
    pywebview
  ] ++ lib.optionals withQtWebEngine [ pyqt6 pyqt6-webengine qtpy ];

  doCheck = false;

  dontWrapQtApps = true;

  postInstall = ''
    install -Dm644 gloaming.desktop $out/share/applications/gloaming.desktop
    install -Dm644 assets/gloaming.svg $out/share/icons/hicolor/scalable/apps/gloaming.svg
    install -Dm644 packaging/gloaming.rules $out/lib/udev/rules.d/70-gloaming-input.rules

    install -Dm644 packaging/gloaming.service $out/lib/systemd/user/gloaming.service
    substituteInPlace $out/lib/systemd/user/gloaming.service \
      --replace-fail /usr/bin/gloaming $out/bin/gloaming
  '';

  preFixup = lib.optionalString withQtWebEngine ''
    makeWrapperArgs+=("''${qtWrapperArgs[@]}")
  '';

  postFixup = ''
    for bin in $out/bin/gloaming $out/bin/gloaming-app; do
      wrapProgram $bin --prefix PATH : ${lib.makeBinPath runtimeDeps}
    done
  '';

  meta = {
    description = "Instant-replay game clip recorder for Linux, for Wayland and X11";
    homepage = "https://github.com/splitshotz/Vice";
    license = lib.licenses.gpl3Plus;
    mainProgram = "gloaming-app";
    platforms = lib.platforms.linux;
  };
}

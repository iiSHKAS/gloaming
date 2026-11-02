{ config, lib, pkgs, ... }:

let
  cfg = config.services.gloaming;
in
{
  options.services.gloaming = {
    enable = lib.mkEnableOption "the Gloaming game clip recorder";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.gloaming-clipper;
      defaultText = lib.literalExpression "pkgs.gloaming-clipper";
      description = "The Gloaming package to use.";
    };

    autoStart = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Start the clipping daemon with the graphical session. With this off,
        Gloaming only records while its window is open.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];

    # Without the setcap wrapper gsr-kms-server goes through pkexec on every recorder restart.
    programs.gpu-screen-recorder.enable = true;

    # TAG+="uaccess" on the event nodes, so the hotkey listener can read the
    # keyboard without the user being in the `input` group.
    services.udev.packages = [ cfg.package ];

    systemd.user.services.gloaming = {
      description = "Gloaming game clip recorder daemon";
      after = [ "graphical-session.target" ];
      wantedBy = lib.optionals cfg.autoStart [ "graphical-session.target" "default.target" ];

      unitConfig = {
        StartLimitIntervalSec = 60;
        StartLimitBurst = 3;
      };

      serviceConfig = {
        Type = "simple";
        ExecStart = "${cfg.package}/bin/gloaming start --no-open-ui";
        Restart = "on-failure";
        RestartSec = 3;
        # Everything the recorder needs to find the session is set by the
        # compositor, not by us, so import it rather than hardcoding a guess.
        # XAUTHORITY is the X cookie; without it X refuses the recorder (#231).
        PassEnvironment = "WAYLAND_DISPLAY DISPLAY XAUTHORITY XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS XDG_SESSION_TYPE XDG_CURRENT_DESKTOP KDE_SESSION_VERSION";
      };
    };
  };
}

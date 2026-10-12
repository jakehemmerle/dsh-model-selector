{
  description = "dsh-model-selector: omp-style model selector scene for dsh-TUI, with its test environment";

  # Pinned to the fleet: nixpkgs and nix-dsh are the revisions ~/nix-config's
  # flake.lock uses (dsh 0.2.1-alpha.2), so dsh and the patched dsh-TUI 0.14.0
  # built here are the same store paths the fleet runs. nixpkgs-tools provides
  # beads 1.3.0, as in nix-config. See nix/fleet/SOURCE.md.
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/7fc6f2c20af09cdcaf48b92ec3121860139ec668";
    nixpkgs-tools.url = "github:NixOS/nixpkgs/b6c8664de9b6cc07fe5666a29f91884ba81197c4";
    nix-dsh = {
      url = "github:jakehemmerle/nix-dsh/f0ca0d745df8cbe99bad91d59153dbd690ae6660";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, nixpkgs-tools, nix-dsh }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});
      version = (builtins.fromJSON (builtins.readFile ./package.json)).version;

      env = system: pkgs: rec {
        fleetDsh = import ./nix/fleet/dsh.nix { inherit pkgs nix-dsh; };
        dsh = fleetDsh.dsh;
        dshTui = pkgs.callPackage ./nix/fleet/dsh-tui.nix { };
        dshScope = "${dsh}/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
        tuiDir = "${dshTui}/lib/node_modules/@deepseek-harness-tui/dsh-tui";
        nodeModules = pkgs.importNpmLock.buildNodeModules {
          npmRoot = ./.;
          inherit (pkgs) nodejs;
          derivationArgs.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
        };
        browsers = if pkgs.stdenv.hostPlatform.isLinux then pkgs.playwright-driver.browsers else null;
        beads = nixpkgs-tools.legacyPackages.${system}.beads;
        # Everything the suites need at runtime, as environment variables.
        testEnv = {
          DSH_BIN = "${dsh}/bin/dsh";
          DSH_SCOPE_DIR = dshScope;
          DSH_TUI_DIR = tuiDir;
          DSH_VERSION = dsh.version;
          DSH_TUI_VERSION = dshTui.version;
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
        } // pkgs.lib.optionalAttrs (browsers != null) { PLAYWRIGHT_BROWSERS_PATH = "${browsers}"; };
        runtimeInputs = [ pkgs.nodejs pkgs.tmux pkgs.coreutils pkgs.bash ];
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [ ./index.js ./lib ./package.json ./package-lock.json ./scripts ./test ];
        };
      };
    in
    {
      packages = forAllSystems (system: pkgs:
        let e = env system pkgs; in {
          default = pkgs.stdenvNoCC.mkDerivation {
            pname = "dsh-model-selector";
            inherit version;
            src = pkgs.lib.fileset.toSource {
              root = ./.;
              fileset = pkgs.lib.fileset.unions [ ./index.js ./lib ./package.json ./README.md ./LICENSE ];
            };
            dontConfigure = true;
            dontBuild = true;
            installPhase = "mkdir -p $out && cp -r index.js lib package.json README.md LICENSE $out/";
            meta = { description = "omp-style model selector scene for dsh-TUI"; license = pkgs.lib.licenses.mit; };
          };
          inherit (e) dsh dshTui;
        });

      # Fast suites (property, contract, examples) against the pinned dsh and
      # the fleet-patched dsh-TUI, inside the build sandbox.
      checks = forAllSystems (system: pkgs:
        let e = env system pkgs; in {
          fast = pkgs.runCommand "dsh-model-selector-fast-suites" ({
            nativeBuildInputs = [ pkgs.nodejs ];
            NUM_RUNS = "1000";
          } // e.testEnv) ''
            cp -r ${e.src} src && chmod -R u+w src && cd src
            ln -s ${e.nodeModules}/node_modules node_modules
            export HOME=$TMPDIR/home && mkdir -p $HOME
            node scripts/link-host.mjs
            node --preserve-symlinks --test --test-concurrency=1 test/*.test.js 2>&1 | tee $out
          '';
          package = self.packages.${system}.default;
        });

      apps = forAllSystems (system: pkgs:
        let
          e = env system pkgs;
          exports = pkgs.lib.concatStringsSep "\n" (pkgs.lib.mapAttrsToList (k: v: "export ${k}=${pkgs.lib.escapeShellArg v}") e.testEnv);
          e2e = pkgs.writeShellApplication {
            name = "dsh-model-selector-e2e";
            runtimeInputs = e.runtimeInputs;
            text = ''
              ${exports}
              root=${"$"}{DSH_MS_ROOT:-$PWD}
              if [ ! -f "$root/test/rig/rig.mjs" ]; then echo "run from the dsh-model-selector checkout (or set DSH_MS_ROOT)" >&2; exit 2; fi
              cd "$root"
              rm -rf node_modules.nix && ln -sfn ${e.nodeModules}/node_modules node_modules.nix
              export NODE_PATH="$root/node_modules.nix"
              [ -e node_modules ] || ln -s node_modules.nix node_modules
              node scripts/link-host.mjs
              exec node --test --test-concurrency=1 --test-timeout=1800000 "${"$"}{@:-test/e2e/}"
            '';
          };
        in {
          e2e = { type = "app"; program = "${e2e}/bin/dsh-model-selector-e2e"; };
        });

      devShells = forAllSystems (system: pkgs:
        let e = env system pkgs; in {
          default = pkgs.mkShell ({
            packages = e.runtimeInputs ++ [ e.dsh e.beads pkgs.git pkgs.jq ];
            shellHook = ''
              echo "dsh $DSH_VERSION, dsh-TUI $DSH_TUI_VERSION (fleet patch stack); npm ci, then npm test / nix run .#e2e"
            '';
          } // e.testEnv);
        });
    };
}

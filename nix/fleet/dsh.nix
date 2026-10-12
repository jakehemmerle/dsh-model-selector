# The fleet's dsh, built exactly as ~/nix-config/home/dsh.nix builds it (see
# SOURCE.md for the commit): nix-dsh's package.nix (dshBase) plus nix-config's
# postInstall override (dsh-speed's web model-modal patch and the Tailscale
# trusted-login check). Kept textually identical so the store paths match the
# fleet's; do not edit by hand, re-vendor instead.
{ pkgs, nix-dsh }:
let
  dshBase = pkgs.callPackage "${nix-dsh}/package.nix" { };
  dsh = dshBase.overrideAttrs (old: {
    postInstall = old.postInstall + ''
      ${pkgs.nodejs}/bin/node ${./dsh-speed/scripts/patch-model-modal.mjs} \
        $out/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js
      substituteInPlace \
        $out/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js \
        --replace-fail '	isAuthenticated(request, secure = false) {' '	isAuthenticated(request, secure = false) {
		const tailnetLogin = process.env.DSH_TAILSCALE_TRUSTED_LOGIN;
		if (tailnetLogin && header(request.headers, "tailscale-user-login") === tailnetLogin) return true;'
    '';
  });
in
{
  inherit dshBase dsh;
}

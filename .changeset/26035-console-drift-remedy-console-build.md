---
'@objectstack/cli': patch
---

fix(cli): the Console drift warning and refusal name `pnpm console:build` instead of the retired `pnpm objectui:build`

Clause-②: no
Metadata-protocol: none

When the Console build being served was stamped from a different objectui commit than the `.objectui-sha` pin above it, `os serve` printed a warning and `os dev` refused to mount the Console (and answered `503` at `/_console/`). Both told you to run `pnpm objectui:build`, and the refusal also mentioned `pnpm objectui:refresh`. Neither script exists any more: the objectui pin and its scripts were retired when the Console moved into this workspace, and the Console is now built with `pnpm console:build`.

- **Now.** The warning ends with `rebuild it with 'pnpm console:build'.`, and the refusal (terminal and `503` body) says `Rebuild the console:` followed by `pnpm console:build`. The `objectui:refresh` line is gone. The SHAs, the `OS_ALLOW_CONSOLE_DRIFT=1` escape hatch and the status codes are unchanged.
- **Who sees it.** Only a tree that still carries its own `.objectui-sha` above a stamped Console build. The framework repository carries no pin, and `pnpm console:build` writes no stamp, so a framework checkout never reaches this message. A published install carries no pin either.

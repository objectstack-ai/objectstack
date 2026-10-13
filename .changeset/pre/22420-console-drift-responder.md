---
'@objectstack/cli': patch
---

fix(cli): a dev server that refuses a drifted Console answers `503` at `/_console/` naming the rebuild, instead of a bare `404` (#22420)

Clause-②: no

A refused Console mount answers `503` naming the remedy instead of the router's bare `404` on the same routes, as the not-built position already does. No accepted input, key or export changes.

`os dev` refuses to mount a Console whose built `dist/.objectui-sha` differs from the repository's `.objectui-sha` pin. The terminal printed the refusal, but nothing was mounted, so `GET /_console/` and `GET /` answered `404 ENDPOINT_NOT_FOUND`, the same answer as a wrong URL. That boot now mounts the same routes as the not-built answer:

- `GET /_console/` and every path under it answer `503` (`text/plain`, `no-store`). The body is the refusal's own text: both objectui SHAs, why the stale build is refused, `pnpm objectui:build`, and the `OS_ALLOW_CONSOLE_DRIFT=1` escape hatch. The pin file is named without its absolute path.
- `GET /` and `GET /_console` redirect to `/_console/`, as they do when the Console is served.

The same answer now covers an install where `@objectstack/console` does not resolve at all. That boot used to print nothing and mount nothing. It now prints ``Console package `@objectstack/console` not found``, followed by the reinstall sentence an install with no `dist/` already gets. `/_console/` answers `503` saying the Console is not installed.

`--no-ui` and `--no-console` still mount nothing, so those routes answer `404`.

---
'@objectstack/service-print': patch
---

Clause-②: no

fix(service-print): the local placement binds its browser server's control socket to `127.0.0.1` itself, instead of relying on `playwright-core`'s default host

- **What changed.** With `OS_PRINT_CHROMIUM_PATH` (option `chromiumPath`), each render and each boot probe starts a Chromium browser server and connects to it. That server's control socket is now opened with `host: '127.0.0.1'`. Before, no host was passed, so the bind followed `playwright-core`'s default (`localhost`, loopback only in the pinned 1.63.0). Whoever reaches that socket and knows its path drives a browser signed in as the requesting user. How far it reaches is now set by this package, and a `playwright-core` upgrade cannot widen it without a diff here.
- **What it means for a deployment.** Nothing changes on a host whose `localhost` is `127.0.0.1`, which is the usual case. On a host with no IPv4 loopback address, the local placement cannot open the socket. Its boot probe logs `Chromium could not be reached at the local executable …: listen EADDRNOTAVAIL …` and printing stays off. The socket is never bound to another address instead. On such a host, use the remote placement (`OS_PRINT_BROWSER_ENDPOINT`).
- **Unchanged:** the remote placement, the port (still random), every option and environment variable, and the exports.

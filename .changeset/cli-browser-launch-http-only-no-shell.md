---
'@objectstack/cli': patch
---

fix(cli)!: the CLI opens a sign-in page only for an http(s) address and never through a shell, and `os mcp connect` registers only an address that passes one parse

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, export or stored row is added, removed, renamed or re-shaped. What moves is which sign-in addresses the CLI opens in a browser, how it starts the programs it launches, and which MCP addresses and Windows installs `os mcp connect` registers with; there is nothing for a migration to rewrite and no tombstone. -->

- **Sign-in pages.** `os login` and `os cloud login` open the device-flow sign-in page only when its address is an `http:` or `https:` URL written in plain URL characters. Any other address is printed, as it always was, with a line saying it was not opened. "Browser opened automatically" is printed only when the browser opener was started, and a line says so when it could not be started. The opener is started from an argument list, with no shell: `open` on macOS, `xdg-open` on Linux, and `rundll32.exe url.dll,FileProtocolHandler` (by its path under the Windows directory) on Windows.
- **`os mcp connect` starts `claude` without a shell** on every platform. On Windows it runs the `claude.exe` (or `claude.com`) that the first matching `PATH` entry rooted at a drive letter holds, by its full path; the current directory, relative entries and entries rooted without a drive are not searched. macOS and Linux behave as before.
- **BREAKING (Windows): a batch-file `claude` is no longer run.**
  - FROM: on a Windows install whose `claude` is a batch-file shim (`claude.cmd`, which an npm global install writes), `os mcp connect` registered the server and exited 0.
  - TO: it registers nothing and exits 1, printing the `claude mcp add` line and saying why.
  - The fix: run the printed `claude mcp add …` line yourself, or install Claude Code's native Windows build and run `os mcp connect` again.
- **BREAKING: `os mcp connect` registers and prints only an address that passes one parse, on both paths.** Whether the address comes from `--url` or from the control plane, it must parse as an `http` or `https` URL, it is rebuilt from the parsed origin, and it may hold only letters, digits, `-`, `.`, `_`, `~`, `:`, `/` and an IPv6 host's brackets; an address from the control plane must also be a bare host name (an optional scheme and port, no user, path, query or fragment), and no address may hold a control character.
  - FROM: such an address was registered and printed as given.
  - TO: it is refused with exit 1; nothing is registered and no Connect line is printed.
  - The fix: for `--url`, pass a base URL in those characters (a path prefix holding a percent-encoded or punctuation character has no such spelling); for an environment, open it in the ObjectOS Cloud console and check its address.

---
'@objectstack/cli': patch
---

fix(cli)!: the CLI opens a sign-in page only for an http(s) address and never through a shell, and `os mcp connect` registers only an address that passes one parse

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, export or stored row is added, removed, renamed or re-shaped. What moves is which sign-in addresses the CLI opens in a browser, how it starts the programs it launches, and which MCP addresses and Windows installs `os mcp connect` registers with; there is nothing for a migration to rewrite and no tombstone. -->

- **Sign-in pages.** `os login` and `os cloud login` open the device-flow sign-in page only when its address is an `http:` or `https:` URL written in plain URL characters. Any other address is printed, as it always was, with a line saying it was not opened. "Browser opened automatically" is printed only when the browser opener was started, and a line says so when it could not be started. The opener is started from an argument list, with no shell: `open` on macOS, `xdg-open` on Linux, and `rundll32.exe url.dll,FileProtocolHandler` (by its path under the Windows directory) on Windows.
- **Server text prints as one line.** Every string a server supplies that `os mcp connect`, `os login` or `os cloud login` prints (an environment's name and id, an error text, the sign-in address and the user code) reaches the terminal as one line of printable characters, with control characters shown escaped and the length capped; the browser still opens the sign-in address the server gave. After its Endpoint, Name and Connect lines, `os mcp connect` prints nothing from the control plane but those lines' own name and address. `--json` records are unchanged.
- **`os mcp connect` starts `claude` without a shell** on every platform. On Windows it runs the `claude.exe` (or `claude.com`) that the first matching fully qualified `PATH` entry holds (rooted at a drive letter, or a UNC share such as `\\server\share\bin`), by its full path; the current directory, relative entries and entries rooted at the current drive (`\bin`) are not searched. macOS and Linux behave as before.
- **BREAKING (Windows): a batch-file `claude` is no longer run.**
  - FROM: on a Windows install whose `claude` is a batch-file shim (`claude.cmd`, which an npm global install writes), `os mcp connect` registered the server and exited 0.
  - TO: it registers nothing and exits 1, printing the `claude mcp add` line and saying why.
  - The fix: run the printed `claude mcp add …` line yourself, or install Claude Code's native Windows build and run `os mcp connect` again.
- **BREAKING: `os mcp connect` registers and prints only an address that passes one parse, on both paths.** Whether the address comes from `--url` or from the control plane, it must parse as an `http` or `https` URL with no user name or password, it is rebuilt from the parsed origin, and it may hold only letters, digits, `-`, `.`, `_`, `~`, `:`, `/`, `[` and `]` (an IPv6 host's brackets, and in a `--url` path prefix); an address from the control plane must also be a bare host (an optional scheme and port, no path, query or fragment), and no address may hold a control character. The printed Connect line double-quotes an address that holds a bracket, since sh-family shells read brackets as a pattern.
  - FROM: such an address was registered and printed as given; a user name or password in `--url` was dropped without a word.
  - TO: it is refused with exit 1; nothing is registered and no Connect line is printed. Each refusal names the characters accepted and a way on.
  - The fix: for `--url`, pass a base URL in those characters with no user name or password, or run `claude mcp add --transport http NAME URL` yourself with the server's MCP address (a path prefix holding a percent-encoded or punctuation character has no spelling under the rule); for an environment, open it in the ObjectOS Cloud console and check its address.

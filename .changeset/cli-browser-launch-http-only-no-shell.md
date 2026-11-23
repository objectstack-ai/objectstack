---
'@objectstack/cli': patch
---

fix(cli): the CLI opens a sign-in page only for an http(s) address, and never through a shell

Clause-②: no
Metadata-protocol: none

`os login` and `os cloud login` open the device-flow sign-in page only when its address is an `http:` or `https:` URL. Any other address is printed, as it always was, with a line saying it was not opened; "Browser opened automatically" is printed only when a browser was actually started. The page is opened by starting the platform's opener from an argument list, with no shell: `open` on macOS, `xdg-open` on Linux, and `rundll32.exe url.dll,FileProtocolHandler` (by its path under the Windows directory) on Windows.

`os mcp connect` starts `claude` without a shell on every platform. On Windows it runs the `claude.exe` that the first matching `PATH` entry holds, by its full path, and no longer searches the current directory. When that entry holds a batch-file shim (`claude.cmd`, which an npm global install writes) it does not run it and exits non-zero, saying so; run the printed `claude mcp add …` line yourself, or install Claude Code's native Windows build. macOS and Linux behave as before.

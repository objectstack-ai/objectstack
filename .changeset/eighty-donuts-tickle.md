---
'@objectstack/cli': patch
---

fix(cli): `os login --json` is a parseable NDJSON stream (#6531)

`os login --json` produced output that no consumer could read in any shape. The
device flow wrote its RFC 8628 device-authorization payload compact and, once
the token poll resolved, the result payload 2-space indented — two JSON
documents on one stdout. Driven against a live device endpoint, that stream
failed `JSON.parse(<entire stdout>)` with `Unexpected non-whitespace character
after JSON at position 200`, and read as NDJSON it failed on 5 of its 6 lines,
because the second document spanned five of them. The same two-document shape
appeared on the failure path, where an error payload could follow a
device-authorization record that had already been written.

`os login --json` is now a **newline-delimited JSON stream**: one compact
document per line, on every path — the device-authorization record, the
`--email`/`--password` result, the already-logged-in notice, and the
`{"success":false,"error":"…"}` failure record alike. Every line parses on its
own, and the verification-URL record still arrives *before* the user
authorizes, which is what makes the device flow usable from a script at all.

This is the CLI's **one declared exception** to "`--json` means exactly one JSON
document on stdout" (#6217), and it is declared rather than silent: the
`--json` flag's `--help` text says so, and so do the CLI reference page and the
device-flow section of the authentication docs. Parse this command's stdout
line by line.

Bumped as a patch: no interface is added or removed and nothing that previously
worked stops working. The device-flow output was unparseable before, so it had
no consumers to break; the only other observable change is that the
email/password result is compact rather than indented, which `JSON.parse` reads
identically. Human-mode output is untouched.

---
"@objectstack/cli": minor
---

fix(cli): `os serve` refuses a port that cannot be a port, naming what the operator set (#12662)

`--port` was a string flag whose only consumer was a bare `parseInt`. `os serve
--port abc` therefore became `NaN`, travelled the whole port policy untouched,
and reached the real `listen()` — which refused it at the socket layer:

```
ERR_SOCKET_BAD_PORT: options.port should be >= 0 and < 65536. Received type number (NaN).
```

An operator who mistyped a flag got back an error naming an internal option,
raised from a code path with no connection to the thing they typed. `--port
99999` parses fine and died in exactly the same place, and `PORT=abc` /
`OS_PORT=abc` are the same defect through a different door.

The value is now checked before anything is done with it:

```
  ✗ Invalid port: OS_PORT="abc"
     A port must be a whole number from 0 to 65535 — 0 is legal, and
     asks the kernel for any free port. Nothing was started, and no socket
     was opened.
     Correct OS_PORT in this process's environment (for example OS_PORT=3000),
     or override it with --port 3000.
```

It names **which** input was used — `--port`, `PORT` or `OS_PORT` — because a
refusal that only said "invalid port" would repeat the defect one level up. The
range it states is interpolated from the bounds the code enforces, so the
sentence cannot drift from the check. `0` is accepted: `listen(0)` binds a
kernel-assigned port, so refusing it would have broken a working input in the
name of validating it, and the ceiling is 65535 — one less than the `< 65536`
the kernel's own message names.

The check sits ahead of the port-conflict policy, so all three boot paths (the
development auto-shift, the production refusal, and a boot that enters neither)
are covered by one guard, and all three inputs are covered with it: `PORT` and
`OS_PORT` never reach flag parsing at all — they are read by the flag's
`default`, which oclif never runs a flag's parser over.

**No value that boots today is refused.** `parseInt` remains the reader, so
every spelling it tolerates — `" 3000"` with the leading whitespace production
environments carry, `"3000.0"`, `"0x0BB8"`, `"+3000"` — still boots, on the same
port, byte for byte. Only the values that used to die at the socket are refused,
and now they are refused early, in the operator's own vocabulary. Written to
**stderr** like every other `os serve` diagnostic: `stdout` carries JSON-RPC
frames whenever the stdio MCP transport is mounted.

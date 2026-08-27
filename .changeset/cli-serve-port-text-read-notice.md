---
"@objectstack/cli": minor
---

feat(cli): `os serve` says so when a port is read as something other than what the text says (#12674)

`os serve` reads its port with `parseInt`, and `parseInt` is tolerant in a way
that changes the *answer* rather than the spelling. `--port 3e3` binds port
**3**. `--port 0x0BB8` binds 3000. `--port 3000abc` binds 3000. The boot
succeeds, on a port the operator never named, and nothing anywhere says so — an
operator who wrote `PORT=3e3` meaning 3000 gets a server on port 3, and on a
non-root host that surfaces (much later, if at all) as an `EACCES` that still
does not name the coercion.

The value is now announced when it does not read as the port it selected:

```
  ⚠ PORT="3e3" was read as port 3.
     That text is not a plain decimal number, and the reader that accepts it
     is tolerant: it honours a leading 0x as hexadecimal and discards
     everything from the first character that cannot continue the number.
     Nothing downstream reads it again — 3 is the port this server asked
     for, whatever the text looks like.
     If that is not the port you meant, correct PORT in this process's
     environment (for example PORT=3000), or override it with --port 3000.
```

**Nothing is refused, and nothing binds differently.** The accept set is exactly
what it was: every spelling that boots today still boots, on the same port, byte
for byte. Whether `os serve` should take only strict decimal text is a contract
question about a published CLI's accepted input, and it is deliberately left
open. This repairs the silence, which is where the harm actually was.

The notice fires on a *difference*, so what counts as agreement is the whole of
it: leading and trailing whitespace, a leading `+` and leading zeros do not
change what the text says (`" 3000"`, `"+3000"` and `"08080"` are silent — the
first is what production `PORT` values look like, and a notice there would drone
at every ordinary boot). An exponent, a radix prefix, a fraction, a digit
separator or trailing text all do (`"3e3"`, `"1e10"`, `"0x0BB8"`, `"0b111"`,
`"3000.0"`, `"1_000"`, `"3000abc"` all speak).

It names both the text and the port it selected — never a third number, because
`3e3` looks like 3000 to a reader but `3000abc` has no second reading and a
guess would be wrong the first time it met one. Written to **stderr** like every
other `os serve` diagnostic: `stdout` carries JSON-RPC frames whenever the stdio
MCP transport is mounted.

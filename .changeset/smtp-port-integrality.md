---
"@objectstack/plugin-email": patch
---

fix(plugin-email): refuse a fractional SMTP port at construction, in the sentence that promised to (#13189)

`SmtpTransport`'s port guard was `Number.isFinite && >= 1 && <= 65535` — no
integrality test — so `port: 587.5` was ACCEPTED at construction and
`describe()` read it straight back. It could never connect. `net.connect`
refuses a fractional port with `ERR_SOCKET_BAD_PORT`, and by the time
nodemailer has re-coded it the operator sees, at SEND time, a bare
`RangeError` (`code: 'ECONNECTION'`) reading `Port should be >= 0 and < 65536.
Received type number (587.5).` — a TCP rule naming no part of the
Settings → Mail → Port field they typed it into.

⭐ And the refusal this door *did* emit stated the integer rule without
enforcing it: `587.5` **is** inside `1-65535`, so `(expected 1-65535)`
described a door that had just let it through. The check and its own sentence
disagreed, and only one of them could be satisfied.

Both move together, or the lie moves instead of leaving:

| `port` | before | after |
|:---|:---|:---|
| `587.5` | accepted; `RangeError` at send time | refused at construction: `SmtpTransport: invalid port '587.5' (expected an integer 1-65535)` |
| `1` / `465` / `587` / `65535` | accepted | accepted — unchanged |
| `0` / `-1` / `99999` | refused | refused — unchanged |
| `NaN` / `±Infinity` | refused | refused — unchanged |
| absent, or `smtp_port: ''` | 587 | 587 — unchanged; an empty field spells "not set" |

The sentence stays GENERATED from `SMTP_PORT_MIN` / `SMTP_PORT_MAX` (#12993) —
"an integer" is prose about the predicate, and neither bound was re-spelled.
⚠️ It therefore reads `(expected an integer 1-65535)` from this release on,
including in the refusal quoted by the #13190 entry above, which was written
before this change landed.

This narrows the accept set, deliberately and in exactly one dimension. The
values affected are the fractions strictly inside the range: they were
unbindable addresses, and a deployment carrying one has never delivered mail on
it — it was failing at send time, under a name that pointed nowhere near the
setting. It now fails at boot, saying which value and which rule.

⚠️ This is not a divergence from the CLI's port contract but a convergence with
it. `packages/cli/src/utils/port-contract.ts` is emphatic that a door may not
narrow what boots, and it is read as a precedent the other way — but its width
is about how a port may be *spelled* (`3e3`, `0x0BB8`, `3000.0`, `+3000`,
`08080`), every one of which `parseInt` reduces to an integer before any range
check. Both of its readers then test `Number.isInteger` outright. On
integrality that contract has been strict all along.

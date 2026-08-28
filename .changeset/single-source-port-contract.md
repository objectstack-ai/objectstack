---
'@objectstack/cli': patch
---

`os dev` / `os start` / `os serve` refuse an impossible port at their own door, from one shared contract

The port range, the reader that turns operator text into a port, and the refusal
prose now live in a single module (`packages/cli/src/utils/port-contract.ts`)
that all three commands import. Before this, only `serve` validated: a value
typed at `dev` or `start` travelled to the spawned `serve` child and was refused
one process later, under the name of the CHANNEL it arrived on rather than the
spelling the operator had used.

**FROM → TO — what changes, stated precisely.**

- **The end-to-end accept set does not change.** Since #12662 every value listed
  below already ended in a refusal; what moves is WHERE the refusal happens and
  WHAT it names. Measured before and after by driving a table of 18 port texts
  through all three real commands on all three channels (`--port`, `$PORT`,
  `$OS_PORT`) — 162 runs per side, every row identical in verdict. Values that
  boot today still boot, on the same port: ` 3000`, `3000 `, `+3000`, `08080`,
  `3e3`, `0x0BB8`, `3000.0`, `3000abc` and `0b111` are all accepted, exactly as
  before, and `parseInt`'s tolerance is deliberately preserved — a strict-decimal
  reader would refuse six values that start a server today.
- **The refusal moves earlier: from the `serve` child to the parent's own door,
  before anything is spawned and before any socket exists.**
- **The refusal names the operator's spelling.**
  - `PORT=abc os dev` — FROM `✗ Invalid port: --port "abc"` TO
    `✗ Invalid port: PORT="abc"`.
  - `OS_PORT=abc os dev` — FROM `✗ Invalid port: --port "abc"` TO
    `✗ Invalid port: OS_PORT="abc"`.
  - `os start --port 99999` — FROM `✗ Invalid port: PORT="99999"` TO
    `✗ Invalid port: --port "99999"`.
  - `os serve` is unchanged in every respect; it already named what it could see.
- **`os dev --port ""` is unchanged: still dropped, not refused.** An empty
  string is falsy, so `dev` forwards nothing and the child resolves its own
  default — measured, and preserved deliberately, because refusing it would
  narrow a published command's accept set.

No new flag, no new environment variable, no new configuration key. The range is
declared in exactly one place in the repository; `os start`'s `--port` did NOT
gain `Flags.integer({ min, max })`, because that bound would be a second copy of
the range and, measured against `@oclif/core` 4.13.3, neither a flag's `parse`
nor an integer `min`/`max` runs over a value supplied by a flag's `default` —
which is how `$PORT` and `$OS_PORT` reach the CLI.

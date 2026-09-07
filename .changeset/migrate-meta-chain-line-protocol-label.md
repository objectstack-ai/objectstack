---
"@objectstack/cli": patch
---

`os migrate meta` no longer prints the protocol version under the word "runtime", where it read as the installed package version.

The chain line used to end `(runtime 17.0.0)`. That number is `PROTOCOL_VERSION` — the protocol major padded to a semver — and it is not, and never tracks, the version of the installed `@objectstack/cli` or `@objectstack/spec`. On a 17.3.0 install the line appeared beside the real package versions of the same upgrade session (`npm view`, the changelog), so it read as "your runtime is 17.0.0": an apparent downgrade or a stale install, neither of which was true.

The value was never wrong — the label and the semver form were. The line now states the fact in the protocol's own units:

```
Chain:  protocol 17 → 17 (this runtime implements protocol 17)
```

The parenthetical is relabelled rather than dropped, because it carries a fact nothing else on screen does: when `--to` stops below this build's major, it is the only place the operator is told where the runtime actually stands (`Chain:  protocol 16 → 16 (this runtime implements protocol 17)`).

The `--json` payload is deliberately untouched: its `runtime` key still carries the same padded protocol semver. Renaming a machine-readable key is a contract change owing a reader census and a deprecation window of its own, and it is tracked separately — an e2e pin now asserts the key's current value so that move cannot happen silently.

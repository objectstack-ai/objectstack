---
'@objectstack/cli': patch
---

`os lint --eval --generator ""` no longer prints a double space in its refusal.

`bundle-require` composes its own refusal as `<filepath> is not a valid JS file`, so an
empty filepath contributes no characters and that fragment arrives with a leading space —
which landed against the space in our own `": "` separator:

```
Failed to load generator "":  is not a valid JS file      # before, both faces
Failed to load generator "": is not a valid JS file       # after
```

The composed message now drops leading spaces from the detail, so the separator carries
exactly one. The empty string still answers through the same door an unresolvable path
answers through — same `catch`, same exit code 1, same one-key `{error}` document on the
`--json` face — and every refusal whose detail does not open with a space is byte-identical,
the unresolvable-path case included.

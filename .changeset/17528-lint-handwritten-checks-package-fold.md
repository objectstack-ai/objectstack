---
'@objectstack/cli': patch
---

`os lint`'s own rubric and `os lint --score` judge the stack an ADR-0130 D4 / option-B project actually declares, instead of reporting `✓ All checks passed` on a stack they never opened

`lintConfig` runs two families: the shared author-time rule registry and
`os lint`'s **own** hand-written checks — naming, labels, empty field maps, the
intra-package duplicate advisory, hook-body lowering and the data-model
conventions. The registry learned to resolve `packages[]` earlier; the
hand-written family and `scoreMetadata`, which reaches the same function, still
read the **top level only**. On an option-B project (every definition inside
`packages[]`, none flattened up) they were handed an empty stack.

Measured through the real binary, on one object authored two ways — the same
metadata, differing only in where it is declared:

```
packages[]   os lint            exit 0   ✓ All checks passed
                                         Metadata quality: 100/100  (A)

top level    os lint            exit 0   ⚠ Label "order" should start with an uppercase letter
                                           convention/label-case        at objects[0].label
                                         ℹ Object "ob_order" has no nameField and no name-like field …
                                           object/missing-name-field    at objects[0].fields
                                         Metadata quality: 96/100  (A)
```

and after, on the same two projects:

```
packages[]   os lint            exit 0   ⚠ convention/label-case        at objects[0].label
                                         ℹ object/missing-name-field    at objects[0].fields
                                         Metadata quality: 96/100  (A)

top level    os lint            exit 0   — byte-identical to before
```

The score is the sharper half. `100/100 (A)` with every count at zero is
byte-for-byte the verdict a genuinely clean project gets, on a rubric that had
judged nothing — the same indistinguishability a swallowed linter crash used to
produce, arriving through the input instead.

**The fix folds once, at `lintConfig`'s entry, with the existing helper.**
`authoringRuleUnionStack` (`utils/stack-collections.ts`) is this package's one
resolution rule for a package-owned collection and it is present-wins: a key the
top level already carries wins, because in today's additive shape that array
already *is* the union. So a multi-package artifact is judged once, never twice,
and a stack whose top level carries its collections — every stack the platform
emits today — is returned by identity and lints byte-identically to before.

**This does not change what `scoreMetadata` scores.** It already scored the whole
project: its schema half reports `packages.0.manifest.objects.0: …` on an
option-B stack with no fold anywhere, and on today's additive multi-package shape
its lint half already read the flattened union across every package. The fold
makes the option-B shape agree with the additive one.

⛔ No authorable key, spec schema, published export or accept set moves.
`os build` rejects and accepts exactly what it did; `os lint`'s own `error`
severity remains a lint verdict, not a publish gate.

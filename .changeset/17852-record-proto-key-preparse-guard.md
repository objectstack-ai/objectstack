---
'@objectstack/spec': minor
---

**BREAKING** for authored metadata — `ObjectSchema.fields` refuses a key named `__proto__`, `constructor` or `prototype`, and `AssignmentConfigSchema.assignments` (the `assignment` flow node's variable map) refuses a key named `__proto__` — both refused with a named, located error at parse time, rather than silently accepted and then silently mishandled (objectstack#17852, objectstack#18847).

## Why

zod's `z.record()` skips a `__proto__` own key entirely, above its own key schema — the record parser's `if (key === "__proto__") continue;` runs before `def.keyType._zod.run`, so no key grammar (a regex, `.refine()`, `.superRefine()`, even a key schema that rejects every string) can ever see that key. A document whose `fields` (or `assignments`) carried a `__proto__` own key — which `JSON.parse` produces routinely — used to parse as SUCCESS with that key silently missing from the output: the validator accepted a document and handed back a *different* document. `os build` writes the release artifact from that returned document, so the failure shape is success, silent, and irreversible into the shipped artifact.

Two independent mechanisms close this, one per name class, because they are not reachable the same way:

- `__proto__` is refused by a **pre-parse guard** that reads the raw input's own keys before the record ever parses, at both `ObjectSchema.fields` and `AssignmentConfigSchema.assignments`.
- `constructor` and `prototype` — which, unlike `__proto__`, DO reach the key schema unskipped — are refused by `ObjectSchema.fields`' own key grammar (they were ordinary lowercase words its regex already admitted). They are **not** refused at `AssignmentConfigSchema.assignments`: that slot's key type carries no grammar at all (`z.string().min(1)`), both names are legal flow-VARIABLE names measured to survive parse intact today, and no ruling narrows that slot's accept set for them — only its `__proto__` half moves.

Measured: zero authored use of any of the three names as a `fields` key or an `assignments` variable name, across this repo, `examples/` and `objectui`.

## Known gap, left open on purpose

The guard runs at parse time only. It does not project into the published JSON Schema (`packages/spec/json-schema/**`) — the general gap that closes is tracked separately (objectstack#18670) and stays open after this change.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) zero authored use of `__proto__`, `constructor` or `prototype` as a `fields` key or an `assignments` variable name across this repo, examples/ and objectui — nobody has anything to rewrite, so there is no prescription to give. -->

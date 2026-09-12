---
'@objectstack/types': minor
'@objectstack/rest': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

refactor(types): one `isNativeErrorName` reader, so three doors cannot disagree about what a crash is (#17681)

The predicate that decides whether a sandboxed body's `throw` is a business
REFUSAL (4xx, the author's words relayed) or a CRASH (5xx, the words withheld)
had **three byte-identical copies** — measured, one distinct 74-character regex
literal across three packages:

| copy | package | its stated reason for being a copy |
|:--|:--|:--|
| `isScriptFaultMessage` | `@objectstack/rest` (`error-response.ts`, #7543) | the original |
| `isScriptCrash` | `@objectstack/objectql` (`hook-withheld-readonly-fault.ts`) | this package must not depend on `@objectstack/rest` for a regex |
| `sandboxRefusalMessage` | `@objectstack/runtime` (`sandbox/quickjs-runner.ts`, #17265) | rest declares one export subpath and re-exports nothing from `error-response` |

⭐ **Every reason is a statement about reaching `@objectstack/rest`, and none of
them survives moving the rule.** `@objectstack/types` now owns
`isNativeErrorName` — the name list, the `^` anchor, and the deliberate absence
of a bare `Error:`. All three packages already depend on it and it depends on
none of them, so this fold **adds zero dependency edges** and cannot cycle.

⚠️ The hazard was never style. One copy learning a new native error name and the
others not means the same throw is a refusal at one door and a crash at the
next — a crash message **leaked** at one boundary and **withheld** at another.
#16013's argument for extracting exactly this class applies verbatim: the
classification is the part nobody may get wrong, so one *tested* helper is worth
more than N correct copies that must each stay correct forever.

⛔ **No behaviour changes at any door, per case.** This is a pure refactor and
the three WRAPPERS are deliberately NOT folded, because they are not the same
shape and merging them would move a door's answer:

- rest asks a trimmed message and answers a boolean;
- objectql asks **two** slots — `err.name` **or** `err.innerMessage.trim()` —
  because a code hook and a sandboxed body carry the native name in different
  places;
- runtime asks the trimmed inner message and answers the **message**, not a
  boolean.

What the three share is the predicate, so the predicate is what moved. Each call
site keeps its own slot choice and its own trimming, and `isNativeErrorName`
deliberately does **not** trim for its callers — a contract pinned in its test.

**Shipped rather than `skip-changeset`**, measured on a real build: all four
packages publish `files[]: ["dist", …]`, and the built `dist` of each carries
the new call — `@objectstack/types` 4 files, `@objectstack/objectql` 4,
`@objectstack/rest` 3, `@objectstack/runtime` 2 — with `looksLikeInternalErrorLeak`
scoring 4 in `types/dist` as the lit control and a nonexistent symbol scoring 0.
The retired copies are gone from the artifacts too: the regex literal scores
**0** in `rest/dist`, `objectql/dist` and `runtime/dist`, and **2** in
`types/dist` (the ESM and CJS bundles).

`@objectstack/types` takes **minor**: a new export is a purely additive widening
of a published surface, which is at least minor whatever the commit type says.
The three consumers take `patch` — their artifacts change, their behaviour does
not.

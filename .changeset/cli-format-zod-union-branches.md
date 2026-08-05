---
"@objectstack/cli": patch
---

fix(cli): `os validate` / `os build` print the union branch's prescription, not a bare `invalid_union: Invalid input` (#5341)

Zod folds every branch of a failed `z.union` into ONE top-level issue whose own
`message` is the literal `"Invalid input"`; each branch's real rejection —
required-property and unknown-key prescriptions alike — sits in `issue.errors[]`
with paths relative to the union's own. The CLI's `formatZodErrors`
(`packages/cli/src/utils/format.ts`) walked only the top level, so an author who
mistyped a key inside a union member read:

```
  views:
    ✗ views.0.list.sort
      invalid_union: Invalid input
```

…while the branch that names the key, and the fix, was produced on every run and
delivered on none. Three commands print through that one function — `os
validate`, `os build` (compile) and `os plugin build` — so the terminal was the
one surface where the #4001 campaign's curated prose never arrived. It now
reads:

```
  views:
    ✗ views.0.list.sort
      invalid_union: Invalid input
        ✗ views.0.list.sort.0.order: Invalid option: expected one of "asc"|"desc"
        ✗ views.0.list.sort.0: Unrecognized key(s) on this sort entry: `direction`. … Did you mean `direction` → `order`?
```

This is the same defect's **third** consumer, and it reuses the branch-selection
policy the first two landed rather than re-deriving it: drop branches that only
say "wrong kind of value", prefer the branch complaining least so one stray key
is not reported once per branch (the #4001 批 6c regression), break ties on
`unrecognized_keys`, absolute paths, bounded expansion depth. `formatZodError`
(spec, #4971) and `zodIssuesToFields` (the REST wire, #5014) already carry it;
because the terminal needs exactly the string spec already exports, this one is
a plain `formatZodIssue` import instead of a third copy — so one mistake cannot
get three different prescriptions depending on which surface the author hit.

Strictly additive: the union's own `✗ path` / `invalid_union: Invalid input`
lines still print, non-union issues render byte-for-byte as before, and the
`N validation error(s) total` footer still counts `error.issues` — one union is
one issue however many lines explain it, which keeps the footer agreeing with
the `--json` payload beside it. The `--json` path is untouched; it passes
`error.issues` through and always carried the whole tree.

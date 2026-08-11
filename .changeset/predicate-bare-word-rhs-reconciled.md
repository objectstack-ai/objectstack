---
"@objectstack/lint": patch
---

fix(lint): one prescription for a bare unquoted word on the right of `==` (#7696)

For a single token — a bare word on the right of `==` / `!=` in a
metadata-editing form's visibility predicate, e.g. `data.type == active` —
three publish-time rules fired and prescribed **opposite** fixes:

| rule | severity | read it as | prescribed |
|---|---|---|---|
| `visibility-bare-identifier` | `error` | a dropped binding root | `<root>.active` |
| `predicate-path-unrooted` | `error` (when the word is also a schema key) | a dropped binding root | `data.active` |
| `predicate-rhs-path-shaped` | `warning` | a literal missing its quotes | `'active'` |

The `error`s were the ones that blocked the write, and they asked for a spelling
**this same gate refuses**: `data.type == data.active` is a path on the RIGHT,
which is `predicate-rhs-path-shaped`'s `error` arm. An author who obeyed the
loud finding landed on a louder one, and "fixing" that by making the path
resolve reached `predicate-path-unresolved` — a three-corner walk over metadata
that renders correctly today (objectui#4049).

**The bare-word right-hand position now produces exactly one finding.** The two
root-prescribing rules stand down for identifiers that occur *only* as a bare
right operand of `==` / `!=` on a schema-bound metadata form, and
`predicate-rhs-path-shaped`'s advisory carries both readings: it names the
quoted spelling (`== 'active'`) and the field spelling (move the path to the
LEFT, `data.active == 'yes'`), and says in as many words that adding the root in
place is not a third option. ⛔ Which reading the author meant is still not
decided — that is the thing no linter can know, and inventing an answer is what
the contradicting messages were doing.

**What this changes for you.** A `view` write whose only defect is a bare word
on the right of `==` on a metadata-editing form is no longer refused; it comes
back as an advisory on the 2xx response, at the severity #7659 already argued
for a spelling that renders correctly. Nothing else moves:

- a bare word on the LEFT (`status == active`) is still an `error`;
- a word that also occurs outside a right-hand slot is still an `error`;
- a dotted chain on the right (`data.a == data.b`) is still an `error`;
- a runtime `*.view.ts` / `*.page.ts` predicate is untouched — that surface goes
  to real CEL, where a path on the right is legal and a bare word there really
  is a dropped root, so `record.status == active` keeps its refusal and its
  `record.active` hint;
- the #7659 severity split (`error` on a dotted chain, `warning` on a bare word)
  is unchanged.

**One coverage increase, in the safe direction.** A form whose `schemaId`
resolves to no schema this package can see used to be skipped wholesale, taking
the right-hand check with it even though that check needs no schema oracle. Such
sites are now walked with no scope: the two path-resolution rules stay silent
(no oracle, no verdict) and the right-hand position is judged. Without it, the
stand-down above would have been a silence on that shape rather than a
reconciliation. Measured at 0 new findings over the shipped
`METADATA_FORM_REGISTRY` corpus and over `examples/app-showcase` /
`examples/app-crm`.

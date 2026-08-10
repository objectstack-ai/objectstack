# ADR anchors

One JSON file per anchor. Each entry pins the ADR ids that MUST stay referenced in a
file whose behaviour an accepted ADR decided — see `scripts/check-adr-anchors.mjs` for
what is checked and why, and `scripts/adr-anchors.mjs` for how these files are
assembled.

## Adding one

Add an anchor when an ADR's decision is realized in code that would look arbitrary — or
plausibly wrong, or improvable — to someone reading that file alone. Write **one new
file**, named after the path it anchors with `/` replaced by `__`:

```
packages/objectql/src/engine.ts  →  packages__objectql__src__engine.ts.json
```

```json
{
  "file": "packages/objectql/src/engine.ts",
  "adrs": ["ADR-0057", "ADR-0067", "ADR-0119"],
  "invariant": "What the ADR decided, in a sentence or two — this text is what the gate prints when the reference goes missing, so it has to teach, not just identify."
}
```

(the ids above are `engine.ts`'s real ones; a made-up `ADR-NNNN` written anywhere in the
tree fails this same gate's citation audit, so examples cite records that exist)

Then run `pnpm check:adr-anchors`.

## Two rules that are not style

- **Touch no other file.** There is no index to register a new anchor in, deliberately:
  an index would be a single append-only file every card must edit, which is the exact
  conflict this directory exists to remove (#6957). The directory listing is the index.
- **The filename is derived from `file`, and the gate enforces it.** That is what makes
  two cards anchoring *different* files merge clean while two cards anchoring the *same*
  file collide in git — a layout where the second case merges quietly is a layout that
  loses one of the two edits, on a registry where a dropped anchor produces no error
  anywhere.

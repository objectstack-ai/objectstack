---
"@objectstack/lint": patch
---

fix(lint): guard `walkPageComponents` against component cycles (#13217)

`walkPageComponents` — the one shared page-component traversal under every
page-shaped lint rule and the CLI's i18n object-sections pass — descended the
untyped composition slots inside `properties` with no cycle guard. Every one of
those slots is `z.array(z.unknown())` authored data, so a component whose
`properties.children` contains itself is **legal input**, and feeding one in
recursed until the stack died with `RangeError: Maximum call stack size
exceeded`. Because the walk is shared rather than copied, that crash was not
scoped to one rule: it took every rule standing on the walk down in the same
process.

The descent now carries an **ancestor set** — the node is added before
descending and removed on the way out — so a node that is its own ancestor
stops the descent. Measured on the shapes that matter: a direct self-reference,
an indirect cycle (`A -> B -> A`) and a longer chain (`A -> B -> C -> A`) all
terminate, through every descended slot (`properties.children`,
`properties.items[].children`, `properties.body`, `properties.footer`).

Two deliberate non-changes, both pinned:

- **An ancestor set, not a visited set.** A component object placed twice as a
  *sibling*, or reached down two different branches, is legitimate re-use at two
  distinct config paths, and every rule built on this walk must see both
  placements. A visited set would yield the first and silently drop the rest —
  trading a loud crash for missing lint coverage. This matches the predicate the
  sibling resolver `translatePage` already settled on.
- **No depth cap.** A cap and a cycle guard are different instruments. On a
  resolver a cap leaves copy untranslated; on a lint walk it would drop real
  components from the walk output and every rule would go quiet about them — a
  silent truncation that reads exactly like a clean page. With the cycle guard
  the descent is bounded by the document's own finite nesting, so a cap could
  only ever fire on acyclic input, which is the input it must not truncate.

The guard is silent: a cycle stops the descent and yields nothing extra, and no
finding or warning is produced. Deciding that a self-referential page is itself
an authoring error would be new reject behaviour on authored input, which is a
contract call and not this walk's to make. Measured on a cyclic-but-otherwise
valid page, all six rules that route through the walk report exactly what they
report for the equivalent acyclic document (zero findings either way).

No authored page in this repo carries such a cycle — swept across 57
page-shaped objects with a positive control, zero hits — so this fixes a
reachable crash, not an active incident.

---
'@objectstack/spec': minor
---

fix(spec): an object permission that declares a depth axis beside the super-user bit which short-circuits it is now REFUSED, instead of being stored and counted as coverage (#16870)

**BREAKING** — `ObjectPermissionSchema` no longer accepts a `readScope` beside
`viewAllRecords: true`. Two sibling shapes are refused with it, read off the
same resolver lines rather than guessed at.

The pair was accepted with **zero diagnostics**, materialised into
`sys_permission_set.object_permissions`, and counted by a capability census
reading the deployed shape as coverage — while the read stayed org-wide.
`PermissionEvaluator.getEffectiveScope` answers `org` on the super-user bit
**before** it consults the depth key, and `getDeclaredScope` (the ADR-0090 D10
delegated-path input) carries the identical short-circuit ahead of the identical
read, so the declared narrowing was dropped from the delegation fold as well.

⇒ the author declared a narrowing, the platform stored it, an audit of the
deployed shape reported the capability as exercised, and the read was still
org-wide. That is ADR-0049 `declared ≠ enforced` at the capability container
itself, and the accept set is the only door that stops the declaration from
being STORED: a diagnostic raised later fires after the shape is already there.

```
FROM  ObjectPermissionSchema.parse({ allowRead: true, viewAllRecords: true,
                                     readScope: 'own_and_reports' })
      -> { …, viewAllRecords: true, readScope: 'own_and_reports' }   // stored, unread

TO    -> ZodError, located at ['readScope']:
         "readScope: 'own_and_reports' is declared beside viewAllRecords: true,
          which already grants org-wide read. … Delete readScope if the org-wide
          read is intended, or set viewAllRecords: false if the narrowing is."
```

**Which pairs move, and the one that deliberately does not.** The refusal is the
two short-circuits, transcribed:

| declaration | resolver | verdict |
|:--|:--|:--|
| `readScope` + `viewAllRecords: true` | `opClass === 'read' && (viewAllRecords \|\| modifyAllRecords)` | **refused** |
| `readScope` + `modifyAllRecords: true` | same disjunct | **refused** |
| `writeScope` + `modifyAllRecords: true` | `opClass === 'write' && modifyAllRecords` | **refused** |
| `writeScope` + `viewAllRecords: true` | the write short-circuit does not name `viewAllRecords` | **accepted — honoured, and refusing it would delete a real grant** |

⛔ **What `viewAllRecords: true` GRANTS is untouched.** This changes which
declarations are accepted, never what an accepted one does — a permission-
semantics change is not in this change's remit. `viewAllRecords: true` alone,
`viewAllRecords: false` beside a `readScope` (the ordinary, honoured shape), and
a bare `readScope` all parse exactly as before; each is pinned as a
cost-direction guard in `permission.test.ts`, and an ablation that widens the
refusal one shape too far turns the `writeScope`-beside-`viewAllRecords` pin red.

**The wire surface stays tolerant.** The refinement rides on the AUTHORING
wrapper only; `EffectiveObjectPermissionSchema` extends the unrefined base, so a
server still running an older toolchain can return a stored pair in an
effective-permission response without crashing a client (#4001's authorable/wire
split). `AccessMatrixEntry` likewise keeps describing the pair: it is a derived
SNAPSHOT shape whose committed `access-matrix.json` may predate this refusal, and
its tolerance is now stated with that reason in `explain.test.ts` rather than
reading as evidence that the platform accepts the declaration.

**Scope is one object-permission entry**, which is exactly the resolver's input —
`resolveObjectPermission` returns a single entry (explicit, else the `'*'`
wildcard) and never merges two. A super-user bit in one permission set widening
past another set's `readScope` is ADR-0090's documented additive "widest wins"
semantics, not a contradictory declaration, and is not judged here.

**Nothing in the fleet moves.** Measured across shipped defaults, both seeded
examples, two built access matrices, the built artifact fixture and every tracked
`.ts` / `.json`: **0** object permissions carry any refused pair, with lit
controls on every probe (130 nodes declaring `viewAllRecords`, 53 of them `true`,
18 declaring `readScope`; 133 brace-local `viewAllRecords: true` literals).

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is added, renamed or
retired — `readScope`, `writeScope`, `viewAllRecords` and `modifyAllRecords` all
keep their spelling, position and meaning. What narrows is a COMBINATION, and it
has no mechanical conversion: the two remedies (delete the depth key, or clear
the super-user bit) express opposite author intents and only the author can
choose. The refusal message names both at the located path, which is the whole
notification channel a migration entry would have provided. -->

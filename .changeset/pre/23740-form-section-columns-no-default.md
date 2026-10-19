---
"@objectstack/spec": minor
---

**Shipped in 18.0.0-next.2**, whose CHANGELOG missed this entry (#23818); listed here one prerelease late.

feat(spec)!: a form section's `columns` has no default — undeclared, the density is the renderer's (by available width); declared, it is the author's ceiling

Clause-②: no

**BREAKING:** a parsed form section without `columns` no longer carries `columns: 1`. `FormSectionSchema.columns` drops `.default(1)`: the key stays optional with values `1`–`4`, and the string spellings `'1'`–`'4'` still parse to the number.

| A form section authored as | Parsed before | Parsed now |
|:---|:---|:---|
| `{ fields: [...] }` (no `columns`) | `columns: 1` | no `columns` key |
| `{ columns: 2, fields: [...] }` | `columns: 2` | `columns: 2` (unchanged) |
| `{ columns: '3', fields: [...] }` | `columns: 3` | `columns: 3` (unchanged) |

The two meanings, stated on the schema's describe and docblock:

- **Declared** — the author's ceiling: at most that many fields per row where the container is wide enough. A renderer collapses it on narrow containers.
- **Undeclared** — the renderer's choice, by available width. After parse a renderer can now tell "the author said nothing" apart from "the author asked for one column", which the old default erased. No pixel or breakpoint value enters the protocol.

Nothing to rewrite: every input accepted before is accepted now with the same declared value, and none refused before is accepted. A section that must stay single-column on a wide container declares `columns: 1`. A consumer that reads a parsed section's `columns` treats an absent key as "the renderer decides" rather than as `1`. `FormViewSchema.columns` (the form body) was already optional with no default and is unchanged.

<!-- adr-0087: not-required (no-migration-prescription) no key is removed, renamed or moved and no stored or authored value changes meaning when declared; only the parse-added default for an undeclared key goes away, which no conversion can restore without defeating the change -->

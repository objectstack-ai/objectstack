---
'@objectstack/lint': minor
---

fix(lint)!: the ADR-0090 D3 vocabulary freeze visits `objects[].fieldGroups[]` (#18306)

<!-- adr-0087: not-required (no-migration-prescription) an authoring-time lint rule reports a word on one more declaration surface; no key, symbol, enum member or stored value moves, so a stored metadata row is structurally identical before and after and `objectstack migrate meta` has nothing to rewrite -->

**BREAKING** in the accept-set sense — a declaration that passes today can fail tomorrow.
Landing in the launch window as `minor` (the lockstep convention: `major` is refused by
`check-changeset-no-major`, and breaking-ness is carried by this banner plus the ADR-0087
disposition above).

**Clause-②: no (narrowing)** — the rule refuses more than it did; no key is added to any
published payload and no public surface grows, so `lanes/spec.md`'s widening test is not
met. Narrowing is still a semantic-surface change, which is why it is declared here rather
than shipped silently.

`security-role-word` (ADR-0090 D3) judged an object's name, field names and labels, action
names and labels, permission sets, positions, apps and books — and not the field-group
heading that renders directly above the fields it was already judging. So on one record page
a field labelled `Role Of Record` was refused while the group header above it,
`Account & Role`, was admitted: the author renames the field and the heading keeps the word.
That is the exact "refused on one surface, admitted on another" shape (#7220) that this
rule's own split was made to avoid, one grain finer.

Both halves of the group declaration are judged, as on every other surface: `key` is an
identifier (`Field.group` assigns membership by it, and a layout section's `group` inherits
the group by it, ADR-0085 §5), `label` is the header an admin reads. ADR-0090 D3 bans the
word in "identifiers, UI copy, and documentation", and a field group declares both.

Pages, views and components stay out, unchanged: `role` there is the HTML/ARIA attribute — a
machine word with a fixed foreign meaning, not a word the author picked. `listViews`,
`recordTypes` and the other label-bearing surfaces are deliberately not swept in with this;
each needs its own reading first.

**What an author does.** Nothing is renamed for you and nothing is auto-rewritten: the
platform vocabulary is `permission_set` (capability), `position` (distribution),
`business_unit` (hierarchy), and the refusal itself names it at the exact path
(`objects[i].fieldGroups[j].key` / `.label`). A group heading reading `Account & Role`
becomes `Account & Assignment`; a group keyed `role_info` becomes `assignment`, and the
member fields' `group` pointers move with it.

Unaffected: a system object (`sys_*` / `isSystem: true`) keeps the better-auth exemption on
its field groups exactly as it keeps it on its fields, and a group carrying no reserved word
is silent.

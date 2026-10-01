---
'@objectstack/cli': minor
---

feat(cli)!: `objectstack validate` and `objectstack build` refuse a `picklistExtensions` entry whose `extend` names no picklist the stack declares (#20825)

Clause-②: no (narrowing — `objectstack validate` / `objectstack build` newly refuse a `picklistExtensions[].extend` that names no picklist the stack declares; nothing is accepted that was refused before)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling or type: `packages/spec` is untouched, and `picklistExtensions[].extend` stays the snake_case name it was. What changes is that two authoring commands now refuse one authored shape, an extension whose `extend` names no picklist in the stack. `objectstack migrate meta` could not rewrite that shape even in principle, because which list the author meant is not in the metadata. Nothing here judges a stored row. -->

**BREAKING** — an accept-set narrowing on two authoring commands, shipped as
`minor` under the launch-window convention. A stack with a `picklistExtensions`
entry whose `extend` names no picklist the stack declares — `extend: 'industy'`
beside a `picklists: [{ name: 'industry', … }]` — used to pass `objectstack
validate` and `objectstack build` (which wrote the artifact). Both now exit 1 and
name the extension and the list it names (`picklist-reference-unknown`, the rule a
field's dangling `picklist` already gets).
**One-line fix:** correct `extend` to the picklist the entry adds options to, declare
the list it names (`picklists: [{ name, label, options }]`, or a `*.picklist.ts` file
the stack imports), or remove the entry.

**Which extensions are judged.** The ones the load path registers: the top-level
`picklistExtensions` of a one-package stack, or each `packages[]` entry's own. An
`extend` resolves against every picklist the stack declares, including one a sibling
package in the same artifact owns.

**A list from a package outside the stack is reported, not refused.** When the
package declaring the extension lists a `manifest.dependencies` entry the stack does
not carry, the list may live there, and these commands cannot read it. That
extension is an `info` notice (`picklist-reference-unverified`) in `warnings` and on
the console, naming the extension, the list and the dependencies — never a failure,
not even under `--strict`.

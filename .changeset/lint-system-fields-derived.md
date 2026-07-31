---
"@objectstack/lint": patch
---

fix(lint): the seven system-field exemption lists derive from the spec's declarations (#4330)

Five rules in `@objectstack/lint` each carried their own hand-copy of
"registry-injected columns present on almost every object but absent from
authored `fields`" — and they had already drifted from one another (two more
copies had appeared by the time the fix landed). This is the shape #3786
removed from the audit-provenance family, rebuilt one package over: the same
list, maintained in parallel, each under a comment asking to be kept in sync
with one of the others.

The package now has one module, `system-fields.ts`, whose `SYSTEM_FIELDS` is
DERIVED from the spec's two declarations — `FIELD_GROUP_SYSTEM_FIELDS`
(`@objectstack/spec/data`) and `SystemFieldName` (`@objectstack/spec/system`)
— and all seven field-resolving rules consume it. A pin test holds the
boundary in both directions: the set contains exactly the two declarations'
union, and none of the rule-local exemptions.

Two deliberate behavior consequences, both in the permissive direction the
rules' own comments argue for (over-inclusion costs at worst a missed
warning; under-inclusion costs a false one):

- `widget-bindings`, `page-field-bindings` and `react-page-props` now also
  exempt `is_deleted`;
- `flow-template-paths` now also exempts `user_id`.

Names that are NOT system columns in the spec's sense (`name`, `owner`,
`record_type`, and the legacy physical spellings `_id` / `space`) stay
rule-local next to the reason each rule exempts them, instead of widening
every rule: `name` in particular is an ordinary authored field on most
objects, and exempting it package-wide would stop the field-existence rules
from catching a reference to a field the object genuinely does not have.

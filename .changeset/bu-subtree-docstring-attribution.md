---
"@objectstack/spec": patch
"@objectstack/platform-objects": patch
---

docs: fix `business_unit` sharing-rule docstrings that still attributed the BU subtree expansion to the narrow recipient (#8098)

#7807 (PR #8097, `9b519815`) narrowed the `business_unit` sharing-rule
recipient to expand exactly one unit's members, moving the subtree walk onto
`unit_and_subordinates`. Two docstrings never got the memo:
`IBusinessUnitGraphService` in `packages/spec/src/contracts/sharing-service.ts`
and the `sys_business_unit` object definition in
`packages/platform-objects/src/identity/sys-business-unit.object.ts`. Both
still said `recipient_type='business_unit'` sharing rules were driven by the
subtree walk. Both now name `unit_and_subordinates` as the subtree consumer,
with `business_unit` as the narrow (single-unit) one.

These are comment-only corrections — the `IBusinessUnitGraphService`
docstring surfaces in `@objectstack/spec`'s built `dist/**/*.d.ts` hover, and
the `sys_business_unit` docstring surfaces in
`@objectstack/platform-objects`'s built `dist/**/*.d.ts` hover; no runtime or
authoring behaviour changes.

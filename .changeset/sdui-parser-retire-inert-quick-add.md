---
'@objectstack/sdui-parser': minor
---

fix(sdui-parser)!: the interim `inert-quick-add` diagnostic is retired, mirroring objectui `6f864cf62` (objectui#8285)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) This is the ObjectStack mirror of objectui `6f864cf62`, one of the five upstream declared-breaking entries the console pin bump to objectui `e420df310f5b` carries, and the port `check:sdui-lockstep` demands so both parser copies keep one diagnostic-code set. It removes no ObjectStack-authorable key: `@objectstack/spec` already refuses `quickAdd` on `object-kanban` by tombstone, registered as `page.component.object-kanban.quickAdd` (#17260), so no document changes shape and `objectstack migrate meta` has nothing to rewrite. What moves is this package's own TypeScript surface and diagnostic payload, stated below. -->

**BREAKING**: shipped as `minor` under the launch-window convention. The save-time parser stops emitting the interim `inert-quick-add` warning for an authored `quickAdd` on `<object-kanban>`. The prop walk's own `unknown-prop` warning replaces it, so severity is unchanged and no page that saves today stops saving. The package's barrel no longer exports `checkKanbanQuickAdd`, `INERT_QUICK_ADD`, `QUICK_ADD_HOST_TYPES` or `QUICK_ADD_KEY`. A caller that matched on the `inert-quick-add` code should match `unknown-prop` on the `quickAdd` key instead, and an importer of those four names should delete the import: nothing replaces them. On the authored side, delete the `quickAdd` key: the spec refuses it by name.

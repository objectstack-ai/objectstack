---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': patch
---

fix(metadata-protocol)!: publishing an object draft judges it by the current ObjectSchema

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered publish-refuses-object-draft-the-current-schema-refuses -->

**BREAKING** for an object draft the current `ObjectSchema` refuses. Before this change it published; now it is refused at publish, and the refusal names the fix. Stored metadata is not rewritten or refused at boot, and an active row is unchanged. The refusal comes at the next publish of such a draft.

A save checks an object body against the current `ObjectSchema` and refuses it with `422 INVALID_METADATA`. Publishing a draft did not repeat that check. So an object draft saved before a stricter `ObjectSchema` rule landed went live at publish, even though that rule refuses it. One example is a sealed object with no `tenant_id` chain column (ADR-0154 D10).

Both publishes now check the draft the same way a save does: per item (`POST /api/v1/meta/object/:name/publish`) and per package (`POST /api/v1/packages/:id/publish-drafts`), including the pass that judges a batch before it writes on a store that cannot roll back. They refuse it with the same `422 INVALID_METADATA` and the same `issues[]` before anything is written. The draft stays a draft, and a package publish refuses its whole batch with nothing promoted. The draft is checked as the publish would serve it, after the stored-row conversions are applied. So a draft stored in a spelling a later release retired, which those conversions rewrite, still publishes as before.

## FROM → TO

- A pending object draft the current schema refuses, for example a sealed audit object (`lifecycle.seal`) with no `chainField` and no `tenant_id` field. That draft is refused at publish. The fix: declare the chain column, `fields: { tenant_id: { type: 'lookup', reference: 'sys_organization' } }`, or name one, `lifecycle: { seal: { valueFields: [...], chainField: 'organization_id' } }`. Then save the draft again and publish. Whatever the refusal's `issues[]` names, the fix is the one a save of the same body asks for. To find such drafts before upgrading, read each pending object draft: those whose `_diagnostics.valid` is `false` are the ones a publish will refuse.

`@objectstack/spec` adds only the upgrade-guide entry `publish-refuses-object-draft-the-current-schema-refuses`.

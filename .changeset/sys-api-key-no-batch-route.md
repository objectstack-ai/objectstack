---
"@objectstack/spec": patch
"@objectstack/platform-objects": patch
---

fix(spec,platform-objects): put `sys_api_key`'s missing batch route on the record (#7802)

`@objectstack/spec`'s `apiMethods` conformance scan was failing on `main` — and,
because the scan lives in `spec` while the object it judges lives in
`platform-objects`, failing for every PR that touched `spec` and no others.
#7769 had added `update` to `sys_api_key`'s `enable.apiMethods` so the Setup
UI's Revoke button had a working route, which tripped the rule "a whitelist that
grants single-record writes must also grant `bulk`".

Resolved as the rule's second documented outcome — a registered exemption, not a
widened object. `sys_api_key` now carries the monorepo's only
`SINGLE_RECORD_WRITE_ONLY` entry, with the evidence behind it:

- **No batch surface exists to deny.** The console renders no checkbox column on
  any of the object's list views: multi-select is auto-enabled only when a bulk
  action exists, the sole implicit one is bulk-delete, and this object grants no
  delete affordance (`managedBy: 'better-auth'` denies by default, `userActions`
  opens `edit` alone, `delete` is not in `apiMethods`).
- **A future multi-select revoke would not need `bulk` either.** `revoke_api_key`
  / `restore_api_key` are `list_item` actions; promoting one into a view's
  `bulkActions` resolves it to a `custom` def that the grid executor fans out
  through the action runner as N single-record PATCHes — never `/batch`.

So `POST /api/v1/data/sys_api_key/batch` and the `*Many` routes keep answering
405 for API keys, deliberately: the object's authorable surface is the single
`revoked` boolean that ADR-0092 D2's identity write guard admits, and nothing
asks to write it in bulk. #7769's `update` grant is untouched — the Revoke
button keeps working. Adding `bulk` later requires retiring the exemption in the
same commit; the conformance suite's stale-entry check refuses to let both stand.

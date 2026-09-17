---
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

Attach four TSDoc blocks to the declarations they describe.

TSDoc binds a block by position, so a block can end up describing a declaration
it does not document, or none at all. Four had: three in
`packages/rest/src/rest-server.ts` (the `resolveProtocol` paragraph stacked above
`resolveHostnameCached`'s own block, the exported `RestServer` class overview
orphaned by the `RestEnvRegistry` block, and the `registerSharingEndpoints` route
table orphaned by the analytics block) and one in
`packages/runtime/src/http-dispatcher.ts`, where the block above
`resolveActiveOrganizationId` still described `resolveCallerUserId`, a sibling
deleted with the multi-tenant `/cloud` control plane.

No runtime behaviour changes and no API surface moves. This is a `patch` rather
than `skip-changeset` because the block text was measured to ship: each of the
four appears in the published `dist/index.d.ts` and `dist/index.d.cts` of its
package, both of which are inside `files: ["dist", ...]`. Anyone reading
`@objectstack/rest` or `@objectstack/runtime` declarations in an editor was being
shown a description of the wrong function.

Clause-②: no

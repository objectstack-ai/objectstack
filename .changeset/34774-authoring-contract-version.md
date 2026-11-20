---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
'@objectstack/rest': patch
---

Clause-②: yes — widening: a new optional tool input, a new discovery route and one new instructions line; the major refusal applies only to a client that sends the new input, so nothing a client could send before is refused.
Metadata-protocol: none

feat(mcp): the open server states its authoring contract version, refuses a client on another spec major, and serves the restriction profile

- **`initialize` instructions.** Where a connection lists authoring tools, the open server's default instructions now carry `Authoring contract: @objectstack/spec <version>` as their second paragraph, with the `@objectstack/spec` version the server resolves. A host's own text and a configured text are unchanged. The longest default text stays under 4,096 characters.
- **`save_metadata_draft` takes an optional `clientSpecVersion`**, the `@objectstack/spec` version the client built against. Another major is refused before anything is saved (`VALIDATION_ERROR`, 400), naming both versions and the command to run: `npm i -D @objectstack/spec@<server version>`. Another minor is saved as usual, and the answer carries a `specVersionAdvisory`. A value that is not a SemVer version is refused as an input error. A save without it, or with the same major and minor, answers exactly as before. The item's own validation is still the final gate.
- **`GET /api/v1/discovery/restriction-profile`** is now served by `@objectstack/rest`, the route `os validate --target <url>` reads. It answers `{ success: true, data }`, where `data` is a `RestrictionProfileSchema` value. The open runtime restricts nothing, and `versions.spec` and `versions.skills` name the version it runs. So `os validate --target` against a self-hosted runtime now reads a profile instead of failing with a 404.

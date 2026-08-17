---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

The publish door now reports the runtime authoring gate's advisory findings (#9176). `POST /api/v1/meta/:type/:name/publish` carries the same optional, omitted-when-empty `advisories` key the save door already carries (#4463 D1/D3, #4717): `PublishMetaItemResponseSchema` declares it (`RuntimeAuthoringIssueSchema` elements, declared once in `@objectstack/spec`), and `publishMetaItem` attaches the findings the promotion-time gate run returns instead of discarding them. A clean publish's response bytes are unchanged — the key is present only when at least one `warning`/`info` finding was raised; `error` findings still refuse the promotion as the 422 envelope. This matters most for Studio / MCP / AI authors, whose designer takes draft-then-publish on every edit and has no CLI to surface the same findings.

---
'@objectstack/mcp': patch
---

mcp: a metadata outage stops being reported to MCP clients as `Agent "X" not found`

The `agent_prompt` prompt resolved its body through `metadataService.get('agent', name)`
and answered the resulting `undefined` with `Error: Agent "X" not found`. That `undefined`
carries two opposite facts (#5840, ADR-0110 D3): the name was never declared, or every
loader behind the metadata service was down. So during a metadata outage an MCP client was
told, positively, what the author had declared — from a read that never happened. The same
shape sat one bridge over: the `objectstack://objects/{objectName}` resource answered
`getObject()`'s `undefined` with `Object "X" not found`.

**Both surfaces now separate the two.** A degraded read answers `SERVICE_UNAVAILABLE` —
the same catalogued code and the same "whether it exists is unknown, retry once it is
reachable" sentence the `sys_metadata` half of this family already emits (#5532 / #5843) —
and a genuine miss keeps its not-found answer, byte for byte on the prompt surface.
MCP's `prompts/get` and `resources/read` results carry no error envelope, so the
classification travels in the payload each surface already had: the prompt's text, and the
resource's JSON body, which now names `code` and `status` on **both** answers
(`SERVICE_UNAVAILABLE`/503 vs `RESOURCE_NOT_FOUND`/404) so a client can tell them apart
without parsing prose.

**This is a diagnosis fix, not an access change.** Both surfaces were already fail-closed:
no instructions and no schema were served during an outage before this, and none are now.
The defect was the description.

Hosts whose `metadata` slot predates the optional `getDiagnosed` member report nothing
degraded — exactly what they could express before — so their behaviour is unchanged. The
object resource additionally keeps `getObject()` as its resolver and consults the
diagnosed read only as a verdict probe on the miss path, because `getObject` is its own
contract member with no documented equivalence to `get('object', name)` (and
`MetadataFacade.getObject` is not that).

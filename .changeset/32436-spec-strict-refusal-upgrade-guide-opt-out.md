---
'@objectstack/spec': patch
---

feat(spec): `strictUnknownKeyError` takes `retiredKeyUpgradeGuide: false` for a surface that never carried a retirement kit

Clause-②: no
Metadata-protocol: none

`StrictUnknownKeyErrorOptions` gains one optional member, `retiredKeyUpgradeGuide`. Left out, nothing changes: every unknown-key refusal on a protocol metadata surface still ends its fix channels with the pointer to the protocol upgrade guide, because a key whose retirement kit has aged out arrives there as a plain unknown key. Set to `false`, the refusal names the offending key and the spelling to send, and drops that pointer. Use it only for a surface that is not protocol metadata at all (the MCP tool arguments are the first), where no unknown key can be a retired one and the sentence sends the caller to a page that has nothing to do with its mistake.

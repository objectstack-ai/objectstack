---
"@objectstack/cli": patch
---

fix(cli): the `sys_secret` reference union asks the engine for family 3 instead of trusting every host to remember (#12804)

Family 3 of the cross-producer reference union — handles held at a datasource
artefact's `external.credentialsRef` — was pure over the artefacts its caller
supplied. `#12758` landed the producer half (`registerDatasourceDef` retains
`external.credentialsRef`, `ObjectQL.listDatasourceDefs()` reads it back), so
the engine could answer the question; the union never asked it. Measured on the
pre-change tree: a datasource registered in code with a bound credentials
handle, with `declaredDatasources: []`, produced a union reporting
`complete: true` while omitting that live handle. A complete-looking union that
is short one live credential is the precondition failure `#8103`'s deletion
predicate rests on.

The union now assembles family 3 from **three** sources — persisted
`sys_metadata` rows, the definitions the engine holds, and the host's declared
list — as a union, not a replacement. Neither code-side source dominates: the
engine indexes only what was REGISTERED on the runtime, so a config file
nothing ever installed is invisible to it, while a host's list can omit a
datasource a package manifest installed behind its back.

The declared gap is **re-scoped, not removed**. `declaredDatasources:
undefined` still refuses the whole union, because the residue it covers is
still unreachable: a datasource declared in code that nothing ever registered
reaches neither `sys_metadata` nor `listDatasourceDefs()`. A second refusing
shape joins it — an engine slice that cannot list its definitions gaps the
family rather than contributing an empty answer, symmetric with the host's
`undefined`. In both cases `[]` remains the way to state "there are none".

`SecretReferenceEngineLike` gains `listDatasourceDefs?()` as an **optional**
member, so every slice that satisfied the port before still satisfies it. The
three prose sites that `#12758` falsified are rewritten rather than trimmed:
the retired mechanism was "the engine drops `credentialsRef`", and the live one
is "the engine's index covers only what was registered, so the residue is
invisible until the host is asked". The operator-facing gap message carries the
new mechanism, and a test pins that it does not carry the old one.

Bump kept at `patch`, matching `#12663` which created the module: nothing here
reaches the package's entry barrel — `packages/cli/src/index.ts` names no
symbol of this module, and no consumer outside `@objectstack/cli` imports it.

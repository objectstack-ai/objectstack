---
'@objectstack/spec': minor
---

**BREAKING** for authored metadata — an `assignment` flow node's config refuses a **top-level** key named `__proto__`, with a named, located error at parse time, instead of accepting the document and silently returning one without that key (objectstack#19151).

## Why

`AssignmentConfigSchema` is deliberately open at the top level: an `assignment` node is exempt from `registerFlow()`'s undeclared-key walk by design, because its top-level keys may themselves be flow variables (the bare legacy `{ <variable>: <value> }` config), and the descriptor declares `additionalProperties: true`. That openness is spelled `.catchall(z.unknown())`.

zod has two open-key branches and both skip a `__proto__` own key before anything author-facing can judge it. `z.record()`'s branch skips it above the key schema — that is objectstack#17852, fixed for the `assignments` map one level down. `handleCatchall` skips it above the **catchall** schema, one function over in the same file. So a flow variable named `__proto__` declared at the top level of an `assignment` node config parsed as SUCCESS and came back missing: the contract accepted a document and handed back a different one, on a surface whose own keys are author-named by design.

`JSON.parse` is what produces `__proto__` as an own key, so stored flow metadata reaches this door routinely; an object literal's `{ __proto__: … }` sets the prototype instead and never reaches either loop.

## What is refused, and what is not

`__proto__` only, in this position as in the sibling one. `constructor`, `prototype` and every other reserved-looking name reach the catchall unskipped and round-trip intact — measured — so they remain legal top-level flow-variable names and nothing narrows for them. The refusal is a `z.preprocess` guard on the raw input (`refuseCatchallProtoKey`, a sibling of `refuseRecordProtoKey` sharing one mechanism), because that is the only place the key is still visible: declaring it in the object's own shape was measured to refuse *every* config, since zod reads a declared key through `input["__proto__"]` and `"__proto__" in input`, which on an ordinary object both answer through the inherited accessor.

The `assignments` map keeps its own guard. The two are different parsers at different depths and neither covers the other.

Measured: zero authored use of `__proto__` as a top-level key on an `assignment` node config, across this repo, `examples/` and `objectui` — against a lit control of 100 authored `assignment` node declarations in 26 files here and 11 files there.

## Known gap, left open on purpose

Like the sibling guard, this runs at parse time only and does not project into the published JSON Schema (`packages/spec/json-schema/**`) — the general gap tracked as objectstack#18670, which stays open after this change.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) zero authored use of `__proto__` as a top-level key on an `assignment` node config across this repo, examples/ and objectui — nobody has anything to rewrite, so there is no prescription to give. -->

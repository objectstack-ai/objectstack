---
'@objectstack/lint': patch
---

fix(lint): the field-name indexes judge an object as the registry serves it, so a formula, validation, flow, hook, sharing-rule condition, flow node write, action or hook body write, react page prop or translation key naming a field that an `objectExtensions` entry adds is no longer refused (#30471)

Clause-②: yes (widening: field-name reads accept fields a sibling package adds through `objectExtensions`, which the runtime already serves; any site that deliberately stays on declared fields says why)
Metadata-protocol: none (lint judgements, no authorable key)

- **Before.** The `record.FIELD` index of the expression passes (validation rules, formulas, flow conditions, hooks, sharing-rule conditions), the field index of the three write rules (`flow-node-write-unknown-field`, `action-body-write-unknown-field`, `hook-body-write-unknown-field`) and a react page's field props read an object's declared `fields` only. On a multi-package artifact, where a module package adds fields to an app package's object through `objectExtensions`, a read or write naming one of those fields was refused as unknown although the runtime serves the field. The translation rule folded extensions through a reader of its own that kept every entry and read the top level beside `packages[]`.
- **Now.** They read the one shared fold in `object-graph.ts`, as the field-path rules do since #30383: the declared fields plus every field an `objectExtensions` entry of any body adds, one entry per package per object. A field no body declares or adds keeps the same refusal, with the same rule id, severity and message. A field two packages write at the same deciding priority is a served name, but the expression passes judge neither its type nor whether it is nullable, since which definition wins is registration order. The write rules still leave an object that declares no field unjudged. The translation rule now keeps one entry per package per object too, so a key naming a field or rule only a replaced earlier entry of the same package adds is an orphan, as the registry serves it.

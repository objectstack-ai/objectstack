---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

fix(spec,lint)!: an `objectExtensions` entry that leaves a `controlled_by_parent` object with anything but one required `master_detail` is refused, as the same object declared directly already was (#23210)

Clause-②: no (narrowing)

<!-- adr-0087: registered cbp-extension-merged-master-refused -->

**BREAKING** (an accept-set narrowing on a published authoring surface), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0055 §1: a `controlled_by_parent` object derives its master from exactly one `master_detail` field declared `required: true`. `ObjectSchema` refuses an object that declares anything else, and so does the security-posture lint. Neither looked at the object the runtime actually runs: at boot the registry merges every `objectExtensions` entry onto its target, field by field, so an extension could add a second required `master_detail`, or demote the one master. `defineStack`, `os validate` and the lint passed the stack, and the runtime then derived no master: every read of the object denied, every write refused with `422 INVALID_METADATA`.

**What is refused, and where.**

- **`@objectstack/spec`.** `ObjectStackDefinitionSchema` (so `defineStack`, `os validate`, `os build`, the lint scorer and an artifact load) judges the rule on the merged field set of every `controlled_by_parent` object that an `objectExtensions` entry of the same stack extends. In a multi-package artifact (`packages[]`), an extension in any package judges an object any package declares. The merge is read as the registry computes it: fields by name, a later writer replacing the whole field, extensions in ascending `priority`. The issue sits at the `fields` of the extension that wrote the deciding field (`objectExtensions.0.fields`, or `packages.0.manifest.objectExtensions.0.fields`), with the message the same object gets when declared directly. `defineStack` throws `STACK_SCHEMA_INVALID` (422) carrying it.
- **`@objectstack/lint`.** `security-controlled-by-parent-ambiguous-relation` and `security-controlled-by-parent-no-relation` judge the same merged shape and report it at the same extension, in the words of the declared object's finding.

No export, signature or error code is added or removed.

## FROM → TO

| stack | FROM | TO |
|:--|:--|:--|
| `objects: [{ name: 'cbpx_line', sharingModel: 'controlled_by_parent', fields: { header: { type: 'master_detail', reference: 'cbpx_header', required: true } } }, …]`, `objectExtensions: [{ extend: 'cbpx_line', fields: { other: { type: 'master_detail', reference: 'cbpx_other', required: true } } }]` | accepted; at runtime the object derived no master and failed closed | refused at `objectExtensions.0.fields`: "Object 'cbpx_line' declares sharingModel 'controlled_by_parent' with 2 required `master_detail` fields (`header`, `other`)…" |
| the same object, extended with `fields: { header: { type: 'master_detail', reference: 'cbpx_header', required: false } }` | accepted; no master at runtime | refused at `objectExtensions.0.fields`: "…but no required `master_detail` field…" |
| an artifact built before this change that carries either shape | loaded; the object failed closed | refused at load; rebuild it from the corrected source |

**Remedy, in one line.** In the extension, drop the second master or declare it `type: 'lookup'`, and never redeclare the object's master with `required: false` or another type.

**Unchanged.**

- An extension adding any non-master field (a `lookup` to another parent included) to a `controlled_by_parent` object.
- An extension whose target the stack does not declare: another package's object, or the platform's. It is not judged, and the runtime's fail-closed refusal remains the backstop there.
- An object already refused as declared is reported once, at the object.
- In a multi-package artifact, a target on which two packages write one field at the same `priority`: the winner is the order the artifact loader registers them in, which the parse does not compute, so it is not judged.
- Stored `sys_metadata` rows: an extension is merged only when a stack or an artifact registers, so no stored row carries the shape and none is rewritten.
- The step-18 entry `cbp-extension-merged-master-refused` carries the prescription for `os migrate meta`. It is asked only of a stack that declares `objectExtensions`.

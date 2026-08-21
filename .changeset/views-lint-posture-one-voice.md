---
"@objectstack/spec": minor
---

fix(spec): read the unknown-key lint's posture from the schema the parse applies, and report each record exactly once (#10039)

An otherwise valid view container carrying one undeclared key produced two
contradicting messages from `defineStack`:

```
WARN:  defineStack: views.v1.bogusViewKey: 'bogusViewKey' is not a declared view
       key, so its value is dropped at load.
THREW: ✗ views.0: Unrecognized key(s) on this view container: `bogusViewKey`. …
```

The warning promises a silent drop — the view loads, minus one key — and the
refusal one step later says nothing loads at all. An author who reads the
warning and stops there draws the opposite conclusion from the truth, and a
warn channel that is sometimes really an error trains readers to discount it.

**Root cause: the lint read posture off a different schema than the parse.**
`lintUnknownAuthoringKeys` took each collection's unknown-key posture from
`getMetadataTypeSchema(type)`. That registry answers a different question — it
names the schema for a *persisted metadata body* of that type. What
`defineStack` applies to a *stack collection entry* is the element schema in
`ObjectStackDefinitionSchema`'s own shape, and for `view` the two are not the
same object:

- `getMetadataTypeSchema('view')` → `ViewMetadataSchema`, a strip-mode **union**
  over the three persisted runtime shapes;
- `ObjectStackDefinitionSchema.shape.views` → `z.array(ViewSchema)`, and
  `ViewSchema` is the `.strict()` defineView **container**.

`lintUnknownStackKeys` has always avoided exactly this at the top level, and its
own source says why: a schema that rejects loudly must make the lint go quiet
"rather than become a second, possibly disagreeing voice". The per-collection
walker read the same rule off the wrong schema.

The posture source is now the stack schema's own slot for the collection.
Measured across all 29 collections `PLURAL_TO_SINGULAR` names, the registry and
the stack slot agree everywhere except:

| collection | type registry | stack slot | effect |
| --- | --- | --- | --- |
| `views` | `strip` / 91 keys | `strict` / 15 keys | **leaves the lintable set** |
| `themes`, `analyticsCubes` | unregistered | `strict` | skipped either way |

So `connectors` is the honest remainder — it genuinely warns and drops — and no
other collection changes.

**Second defect, same walk: every finding on a union root was emitted twice.**
`lintUnknownKeysAgainstSchema` reported the root record itself and *also* handed
that same record to `descend`, whose object arm skipped `depth === 0` ("already
reported by the caller") while its union arm had no such guard. `view` was the
only union root in the wild, so `defineStack` never showed it — the warn-once
set in `warnUnknownAuthoringKeys` absorbed the second copy — while every other
consumer of the exported walker saw both. The root report now lives in `descend`
alone, so each record is reported by exactly one place. That also closes a
latent third copy: a discriminated-union root whose branch the author *did* pick
was reported once against the merged key set and again against the branch's, and
is now reported once, against the branch — the narrower and more accurate set.

**Nothing about what `defineStack` accepts or rejects changes.** The parse is
untouched; only which of the two existing voices speaks.

### API change

`lintUnknownAuthoringKeys` and `listLintableAuthoringCollections` now take
`ObjectStackDefinitionSchema` as a **required** parameter, injected the same way
and for the same reason `lintUnknownStackKeys` already required it —
`stack.zod.ts` imports this module, so importing the schema back would close a
cycle. Required rather than optional deliberately: an omitted argument falling
back to the type registry would silently reinstate the bug, which is the
silent-loss shape this whole rule family exists to report. Every in-repo call
site (`defineStack`, `os validate`, `os compile`) already had the schema in hand
for the sibling call on the adjacent line.

Marked `minor` rather than `patch` because of that signature, not because of any
behavioural widening — the fix itself only makes one voice go quiet.

---
'@objectstack/spec': minor
---

**BREAKING for authored metadata** — `BulkActionParamSchema` is strict, matching its single-record twin `ActionParamSchema`, and declares `dependsOn` (#18177, decision batch #146 item 4, letter A).

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-bulk-action-param-unknown-keys-refused -->

A list view's `bulkActionDefs[].params[]` entry was `.passthrough()`, so **the shape examined nothing** — and that is the whole finding, not the framing. Measured against installed spec 17.4.0, three parses per schema in one process:

| | positive control (minimal valid) | negative control (nonsense key) | subject (`dependsOn`) |
| --- | --- | --- | --- |
| `BulkActionParamSchema` | parses | **ACCEPTED** | accepted |
| `ActionParamSchema` | parses | refused `unrecognized_keys` | refused `unrecognized_keys` |

It accepted `zzz_nonsense_key_that_no_producer_emits_8755` in the **same run** that it accepted `dependsOn`. ⇒ "the bulk schema accepts it" was never evidence that a key was licensed, in either direction: a shape that examines nothing can neither authorise `dependsOn` nor refuse a typo. Both control legs are now pinned in `src/ui/bulk-action.test.ts` in their post-close form, together, so a future re-opening of the shape cannot pass as a green `dependsOn` assertion.

The maintainer's ruling: 「Breaking for authored metadata」, one-shot — no grace window, no dual spelling.

### `dependsOn` is DECLARED, not refused — and needs no edit

It was already live on this surface and the renderer honours it, so this half is a contract catching up with behaviour. `bulkParamToField` does not destructure it out, so it rides the adapter's spread onto the field metadata, where **both** widget families read it: the option family (`SelectField` / `MultiSelectField` / `RadioField` / `CheckboxesField`) gates and refreshes the offered set through `useCascadingOptions`, and the reference-bearing pickers (`LookupField`, and `UserField` through it) lower it into a hard candidate filter. Retiring it was measured off the table — an ablation removing it from that spread reddens 7 of 12 cases in the consuming repo.

Shape and description mirror **`FieldSchema.dependsOn`**, which is the single-record twin *for this key*: `ActionParamSchema` declares no `dependsOn` at all, because the single-record dialog reaches it through the field-backed route this surface does not have. One vocabulary, two doors.

```ts
params: [
  { name: 'account', type: 'lookup', object: 'showcase_account' },
  { name: 'contact', type: 'lookup', object: 'showcase_contact', dependsOn: ['account'] },
  { name: 'owner',   type: 'lookup', object: 'sys_user',
    dependsOn: [{ field: 'account', param: 'account_id' }] },   // remote key differs
]
```

On a bulk param the "record" a binding resolves against is the dialog's own in-progress param values — a bulk run holds a selection, not a row — so a binding names a **sibling param of the same def**.

### Migration — FROM → TO

Every rejection names the surface, echoes the key and carries its own fix. Nothing below is mechanical, which is why this registers as an ADR-0087 **D3 structured TODO** rather than a D2 conversion: an arbitrary unknown key has no mapping target, and deleting it automatically is the silent data loss ADR-0078 bans.

| You wrote on a bulk param | Write instead |
| --- | --- |
| `helpText: '…'` | `help: '…'` |
| `defaultValue: x` | `default: x` |
| `reference: 'sys_user'` | `object: 'sys_user'` |
| `displayField: 'name'` | `labelField: 'name'` |
| `field: 'owner'` (field-backed param) | declare it inline — `name` + `type`, plus `object` for a picker. The bulk surface has no field-backed route: `resolveActionParams` consults the object's field definitions for the single-record dialog, `toBulkParam` never does |
| `visible: '…'` on the param | move the predicate to the DEF (`bulkActionDefs[].visible`), which gates the button and narrows the run per record |
| `visibleWhen: '…'` on the param | it is a per-**option** key — write it inside `options[]` |
| `carryOver` / `defaultFromRow` / `requiresFeature` / `objectOverride` | ACTION-param contracts with no bulk equivalent: a bulk dialog runs over a selection and holds no row. Use `default` for a fixed prefill, or the def's `patch` for a value the user must not see; gate the button with the def's `visible` / `requiredPermissions` |
| `min` / `max` / `step` / `precision` / `scale` / `rows` / `accept` / `maxSize`, or the picker knobs `lookupFilters` / `lookupColumns` / `lookupPageSize` / `descriptionField` / `picker` / `subtitle` / `avatarField` / `idField` / `allowCreate` | remove the key — see the warning below |

### ⚠️ The widget-config family really was honoured, and really is refused now

This is the half of the narrowing that costs something, so it is stated rather than buried. Those keys rode the same `...extra` spread `dependsOn` rides, and whichever widget read one honoured it (`min`/`max`/`step` at NumberField / SliderField / CurrencyField / PercentField, `accept`/`maxSize` at FileField / ImageField, `rows` at TextAreaField / RichTextField, the picker knobs at LookupField). They are refused now, with one prescription naming `FieldSchema` as the shape they are real on.

⛔ **Do not read that prescription as "declare it on the object's field instead"** — the bulk surface has no field-backed param route, so the value does not reach this dialog either. If a bulk param genuinely needs one of these keys, it has to be declared on `BulkActionParamSchema`; open an issue rather than working around it. They were not declared here because the census below found no author writing one, and a declared key is published contract whose removal costs a full retirement.

**Census, with its boundary.** Taken at authoring time over the two repositories reachable from that session: `objectstack@176b03582e` (7 authored bulk-param literals) and `objectui@3e4f6324f7` (3) — **zero** carrying a key this shape does not declare. ⚠️ **hotcrm was NOT REACHABLE and is UNMEASURED, not clean.** If you keep your own metadata corpus, run `objectstack validate` before upgrading rather than inheriting this result.

### What is deliberately NOT closed

`params[].options[]` stays `.passthrough()`, on its own measurement rather than by symmetry with its parent: `bulkParamToField` spreads every option entry into the field metadata, and the option widgets read `color` / `icon` / `disabled` / `visibleWhen` beyond the declared `{ label, value }`. Closing it would delete widget config the renderer honours — the exact defect this change closes one level up. The declared pair is still type-checked.

⛔ No renderer is edited and no key is removed from any other shape. `BulkActionDefSchema` was already strict and is untouched.

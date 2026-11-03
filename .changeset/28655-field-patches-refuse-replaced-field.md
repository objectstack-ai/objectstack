---
'@objectstack/spec': minor
---

feat(spec)!: an object extension's `fieldPatches` refuses a field the same extension replaces in `fields`, keys option patches by the option-value grammar, refuses `__proto__`, and carries the field's and option's display renames

`ObjectExtensionSchema.fieldPatches` (ADR-0146 D10) is applied by the registry merge, so what it accepts now changes what every read serves. Three things it accepted are refused, each located at its key:

- a field named in both `fields` and `fieldPatches` of one extension (`fieldPatches.industry`): `fields` takes the vendor's field over whole, so the patch landed on the extension's own replacement and the author got neither answer;
- an option-patch key no option `value` can be (`fieldPatches.industry.options.Tech Sector`): the map is now keyed by `SelectOptionSchema.shape.value` itself, so the patch can address only an option that can exist;
- a `__proto__` own key in `fields`, `fieldPatches` or an option-patch map, which zod's record parser dropped while reporting success. Measured at the `/api/v1/meta` save door: the body parsed, the stored row kept the key, and the registered extension did not.

A field patch that spells a key the way the field's own rename table knows (`helpText`, `help`, `hint` or `tooltip` for `inlineHelpText`; `title` or `displayName` for `label`), and an option patch that spells one the option's table knows (`text`, `name` or `title` for `label`), now gets the rename hint instead of a bare unknown-key refusal. The rows are taken by filter from the one table each source shape reads, so a rename onto a whitelisted key reaches the patch the day it lands. The `fieldPatches` description lists its members from `BASE_FIELD_DISPLAY_WHITELIST`.

Clause-②: no (narrowing) — `ObjectExtensionSchema` refuses three inputs it accepted: a field both replaced and patched, an option-patch key outside the option-value grammar, and a `__proto__` own key in its three record slots. Nothing is widened: the renames are hints on keys already refused.

Metadata-protocol: narrowed (an object extension may no longer patch a field it replaces in `fields`, nor key an option patch by anything but a valid option value)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed. A field both replaced and patched has two opposite intents and no rewrite keeps both; an option-patch key outside the value grammar never addressed an option; a __proto__ key never survived the parse. The author decides, and each refusal names the key. -->

**BREAKING** accept-set narrowing on `ObjectExtensionSchema` (`@objectstack/spec`), at every door that parses an object extension: `defineObjectExtension`, `defineStack({ objectExtensions })`, `os validate`, the marketplace install and the `/api/v1/meta` `object_extension` save door.

- **Before.** `{ extend: 'crm_account', fields: { industry: {…} }, fieldPatches: { industry: { label: 'Sector' } } }` parsed, and the patch relabelled the extension's replacement. `fieldPatches: { industry: { options: { 'Tech Sector': { label: 'Tech' } } } }` parsed and could never match an option. A JSON body carrying `"__proto__"` under `fields` or `fieldPatches` parsed with that key silently missing.
- **Now.** Each is refused: `custom` at `fieldPatches.industry`, `invalid_key` at `fieldPatches.industry.options.Tech Sector`, `custom` at `fields.__proto__` / `fieldPatches.__proto__`.
- **Unchanged.** A patch of a field the extension does not replace, keyed by a valid option value, parses as before.
- **Who sees it.** No extension in this repository's examples, skills or docs writes any of the refused forms.

**The remedy.** Choose one answer per field: keep the patch to change only its display (the vendor's type, values and upgrades still apply), or keep the `fields` entry and set the display properties there. Key an option patch by the option's stored `value` (`technology`), not its label. Rename a `__proto__` key.

---
'@objectstack/spec': patch
---

fix(spec): `resolveBundleLocale` and the bundle reads behind every translator answer a locale only from the bundle's own keys

Clause-②: no
Metadata-protocol: none

A requested locale code that names an `Object.prototype` member (`constructor`, `toString`, `__proto__`) is found on every plain-object bundle. Until now `resolveBundleLocale` answered such a code as a registered locale, and the translators' bundle read handed back the inherited function as that locale's data. One answer was visible to readers: an object read (`/meta`) under `?locale=constructor` or `Accept-Language: constructor` served the `Object` constructor as the label of every platform-injected system field still at its English default (so the label went missing from the JSON), and under `__proto__` served `Object.prototype` there. Both reads now check for an own property: the code reads as an unknown locale and takes the same fallback `'xx'` takes, so those fields keep their English label. A bundle that really carries such a key as its own (built by `JSON.parse` or on `Object.create(null)`) still answers it, and an own key whose value is `undefined` still does not answer the exact step. No signature, export or schema changes.

---
"@objectstack/client": patch
---

`ObjectStackClient.environments` — the docblock that licenses the namespace's erased `any` now names where the family is enumerated, and the enumeration exists (#19383).

Fourteen methods on `environments.*` and the nested `environments.packages.*` return types that **contain** `any` and carry **no return annotation**. They are deliberate: the `/api/v1/cloud/*` control plane speaks snake_case, its row contracts left this repo with `@objectstack/spec/cloud`, and binding them here would typecheck and be false. Nothing mechanical held the family, though — `check:exported-any-returns` asks whether an awaited return type **IS** `any` and never whether it **CONTAINS** one (a documented scope that buys the gate zero false positives), and with no annotation on any signature line there is no text for a search to find. A 15th such method landed silently green under a paragraph that licensed it in advance.

- **What changed for a consumer**: one paragraph of published TSDoc on `environments`. It bounds the licence — the family is enumerated by name in the package's own `environments-any-family.pin.test.ts`, and a method that pin does not list is not covered by the paragraph. No export, signature, envelope key or runtime behaviour moves; the emitted declarations are otherwise byte-identical.
- **Pinned by membership, not by a CONTAINS-any detector.** A `ts.createProgram` + `TypeChecker` census over the SDK surface shows CONTAINS-any has no canonical boundary here: the population is a function of how many hops the walk is allowed (24 at three, 43 at four, 57 at five and six), an unbounded walk does not terminate, and 144 callables are still unexplored at six hops — so such a gate's green would mean "no `any` within N hops", never "no `any`".
- **And a package-wide rule would refuse the protected class.** The only other unannotated `any`-containing sites on the surface are `organizations.list` (better-auth organisation `metadata`) and `oauth.applications.list` (`Record<string, any>[]`), which is precisely the caller-shaped class the ratchet's ledger protects by name.

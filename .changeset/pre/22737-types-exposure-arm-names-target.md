---
'@objectstack/types': patch
---

fix(types): a thrown exposure refusal about a second object names that object on the REST body (#22737)

The shared REST error classification gains one arm for `OBJECT_API_DISABLED` and `OBJECT_API_METHOD_NOT_ALLOWED`. Both REST error doors ask it: `mapDataError`, and `resolveErrorResponse` behind `sendThrownError`.

When the thrown error names an object other than the one the route addressed, the body's `object` is that object, and a `405` carries the effective operation set as `allowed`. The generic data door throws this when a nested-relation condition's related object is not served by the API. The new body is the same one the REST door already sends for these codes about the addressed object. Before, the body named the route's object beside a code saying that object was switched off.

An error naming the route's own object, or a door given no route object, answers exactly as before. No code is added.

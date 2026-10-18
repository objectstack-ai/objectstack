---
'@objectstack/service-storage': patch
---

fix(service-storage): the storage family gate and the route judge the same credential

A session the ADR-0069 authentication policy HOLDS (an expired password, enforced MFA not yet enrolled) is now refused on every route of the storage family whatever else the request carries. The family door fronts routes that serve different credentials, so it judges every credential a route can serve: the held session's own posture, and a held key's owner through the shared key-admission seam. The result is a `403` with the gate's posture code before any of the family's own logic runs, so the gate and the route never judge a different credential.

No request a storage route refuses today becomes accepted, and no export, schema or accepted value changes.

Clause-②: no

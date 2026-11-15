---
'@objectstack/objectql': patch
---

fix(objectql): the security-catalog name-conflict refusals say a permission set holds one name per namespace

Clause-②: no
Metadata-protocol: none

The `SecurityCatalogNameConflictError` text, at a hot install and at a cold boot, said "Positions, permission sets and capabilities each hold one name per deployment: an assignment names a position or a permission set by its bare name". That stopped being true for permission sets when a set became identified by its package and name (ADR-0150 D2/D9). Both texts now say what the doors already do: positions and capabilities each hold one name per deployment, and a permission set holds one name per namespace, so packages of two namespaces may each hold a set of one name, while two packages of one namespace, a package with no namespace, a platform package (`base`, `system`, `sys`), the environment and the platform-requested `guest_portal` share one set of it. These are the words of the permission set `name` describe and the permission sets guide. No rule changes: the refusal still fires only where `permissionSetHoldersMeet` says two holders meet, with the same `NAMESPACE_CONFLICT` code and `422` status.

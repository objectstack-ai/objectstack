---
'@objectstack/spec': patch
---

docs(spec): the permission set `name` describe says a set is identified by its package and name, one holder of a name per namespace

Clause-②: no
Metadata-protocol: none

The `name` describe on `PermissionSetSchema` (`packages/spec/src/security/permission.zod.ts`) read "unique within the security catalog the environment serves", which stopped being true when a permission-set name became one holder per namespace (ADR-0150 D2/D9). It now says a set is identified by its package and name: packages of two namespaces may each hold a set of one name, while two packages of one namespace, a package with no namespace, a platform package (`base`, `system`, `sys`), the environment and the platform-requested `guest_portal` share one set of it. The generated reference page and the permission sets guide say the same; positions and capabilities keep one name per deployment. No schema, rule or runtime behaviour changes.

---
"@objectstack/spec": patch
"@objectstack/rest": patch
"@objectstack/lint": patch
---

fix(rest,lint,spec): prune nav entries whose destination object cannot serve, and refuse them at authoring time (#7912)

A `type: 'object'` navigation entry pointing at an object that **cannot answer a
list** was served to the client in the `/meta` payload anyway. The user saw a
menu item that could not work, and the console rendered the failure as a generic
empty state — so it read as *"you have no records"* rather than *"this page
cannot work"*.

Two independent conditions make a destination unservable, and **neither was
expressible on a nav entry**:

- `enable.apiEnabled: false` → the list answers `OBJECT_API_DISABLED` (404);
- an `enable.apiMethods` whitelist without `list` → `OBJECT_API_METHOD_NOT_ALLOWED` (405).

Both are pure functions of the object's own `enable` block — no user, no
permissions, no request context — so the destination is dead for **every**
persona, platform administrator included. That is why a `requiredPermissions`
gate could never prune such an entry: the two are independent conditions, and no
combination of permissions on the *entry* rescues an entry whose *object* is
API-disabled. One shipped that way for a year and read as correct to reviewers,
its in-code comment claiming a non-admin "403s server-side" — which implies an
admin could list. None could.

**The fact is now derived, not declared.** `filterAppForUser` consults the
destination's `enable` block for every `type: 'object'` entry and drops the ones
that cannot serve, on both the app-list and the by-name `/meta` routes and
inside `children` and `areas[]` alike. No new authorable key was minted: the
platform already knows this, on the object, in one place.

**And the prune is never silent.** A prune the author cannot see is the same
failure one layer over, so it is refused at authoring time: `os validate` /
`os build` / `os lint` now **fail** with `nav-object-unservable`, naming the
entry, the object, the offending `enable` key path and which of the two
conditions fired. The serving side logs the same facts for an entry that reaches
a running deployment anyway.

The single two-step order these consumers share — `apiEnabled` first and
independently, the whitelist second — is now declared once as
`apiExposureDenialReason` / `canServeApiOperation` in `@objectstack/spec/data`,
beside the `resolveEffectiveApiMethods` / `isApiOperationAllowed` primitives it
composes. The REST data gate, the nav prune and the authoring rule all read that
one export instead of re-spelling the order.

**Deliberately unchanged:**

- `requiresObject` keeps its client-only evaluation. It asks whether an object
  is *registered*; this gate asks whether a registered object's `enable` block
  lets it answer. An entry whose object this layer cannot find is **served**,
  not pruned.
- `visible` (CEL) is still client-side only.
- Fail-open throughout: unreadable object metadata prunes nothing, so a cold
  start or a metadata outage cannot empty a healthy deployment's sidebar.
- Objects an authoring stack does not itself declare are not judged by the lint
  rule — their `enable` block is not visible from there.

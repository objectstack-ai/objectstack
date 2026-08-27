---
"@objectstack/plugin-security": patch
---

fix(plugin-security): fail CLOSED on a non-object row in the platform-admin promotion predicate (#12515)

`bootstrapPlatformAdmin`'s local `isHumanUser` decided "is this `sys_user` row a
HUMAN?" with a bare truthiness check followed by two property comparisons:

```ts
const isHumanUser = (u: any) => u && u.id !== SystemUserId.SYSTEM && u.role !== 'system';
```

On a truthy NON-object input (`'usr_alice'`, a number, `true`) both comparisons
read `undefined` and therefore both pass, so the input scored **human**. The
same question's consolidated owner — `isHumanUserRow` in `@objectstack/plugin-auth`
— requires `typeof row === 'object'` and answers **non-human** for those inputs.
Two owners of one question, disagreeing, and the disagreement fell the wrong way
on the security-critical side: this is the copy that performs the
**platform-admin promotion**, so it failed OPEN. Its worst shape is the system
account's own id arriving as a bare string, which the old spelling would have
promoted.

The predicate now mirrors `isHumanUserRow` — the same `typeof` guard, and a real
boolean return instead of echoing a falsy input back:

```ts
const isHumanUser = (u: any) =>
  !!u && typeof u === 'object' && u.id !== SystemUserId.SYSTEM && u.role !== 'system';
```

**Why mirroring rather than a stricter rule of its own.** Over-tightening this
predicate has a worse failure mode than the bug: an install that cannot promote
its first admin is locked out of itself. The guard was therefore measured before
it was chosen, not after. Against a real `SqlDriver` over the shipped `SysUser`
declaration, every row a real `sys_user` read yields is a plain object — zero
truthy non-objects, and zero rows whose verdict moves when the guard is added.
The mirrored guard is also already the incumbent on this exact population:
`plugin-auth`'s dev-admin seed filters the byte-identical read (`sys_user`,
`where: {}`, `limit: 50`, system context) through `isHumanUserRow` today.

**No reachable behaviour changes.** The divergence is unreachable through any
live call site, so this ships as a hardening of malformed-input handling rather
than a behavioural fix. The 14 existing agreement cases in the cross-package
pin are byte-for-byte unmoved; the pin gains the non-object class it previously
had to exclude (it would have failed), which is what now stops the asymmetry
returning — consolidating the two copies into a shared package stays declined,
so nothing else was going to retire it.

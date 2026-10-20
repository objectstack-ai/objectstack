---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a delegated agent's own leg does not collect an object's declared default row scope (#24341)

Clause-②: no

An agent acting on behalf of a user (ADR-0090 D10) is judged on two legs that the read door ANDs together: its own sets, which are a capability ceiling and carry no row policy, and its delegator's sets. Since the row-policy collection began applying an object's declared `defaultRowScope` where the held sets carry no row policy, the ceiling's silent leg collected that default too. Where the delegator's own leg is wider than the default, the agent then read fewer rows than its delegator. The platform administrator is the case in point: the administrator's own leg skips row policies on the identity objects, so an agent acting for the administrator would have read only the administrator's own rows there, where it read every row before.

The collection no longer adds an object's default on a delegated principal's own leg, so a ceiling's silence is not read as the object's default. The delegator's leg collects the default exactly as any principal's does, and a principal that acts for no one keeps the default whenever its sets are silent.

What moves, against `18.0.0-next.5`: on an object that declares `defaultRowScope`, an agent acting for a user reads the rows its delegator's side admits, and its explain output names no object default on the agent's side. Before this release's reader, that was already so.

**Unchanged.**

- A principal that acts for no one, a human or otherwise, collects an object's default when its sets carry no row policy for the object and operation, as before.
- The delegator's side, the superuser bypass, and every authored policy are judged as before.
- No export, option or type moves.

---
'@objectstack/core': minor
---

New export `objectNotFoundError(object)`: the one `OBJECT_NOT_FOUND` envelope the data door and the engine's in-process verbs refuse an unresolved object name with

Clause-②: yes

`@objectstack/core` exports `objectNotFoundError(object: string): Error`. The error it returns carries `code: 'OBJECT_NOT_FOUND'`, `status: 404`, the requested name on `object`, and the message `Object '<name>' not found`. It lives here beside `recordNotFoundError`, and for the same reason: the engine cannot import `@objectstack/metadata-protocol`, where the data door first wrote this envelope (ADR-0076 D2). The data door's object-existence gate and `@objectstack/objectql`'s resolver both build their refusal from it, so the two answer one name space with one envelope. Additive: nothing that existed before changes.

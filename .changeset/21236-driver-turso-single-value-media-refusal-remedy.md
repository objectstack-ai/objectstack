---
'@objectstack/driver-turso': minor
---

Both transports now word the JSON-column filter refusal on a single-value file-class field (`file`, `image`, `avatar`, `video`, `audio`) the way `@objectstack/driver-sql` does: the media-column move, not `$contains`, which answers no rows on that field.

Clause-②: no

The local transport inherits the new words from `SqlDriver`. The remote transport refuses in its own filter compiler, and now reads the same class from the driver, so one filter gets one message on both transports. The refused operators and fields do not change. Remote mode never moves its media columns, so a single-value file-class field is a JSON column there on every deployment; the remote transport refuses to plan the column step of `objectstack migrate files-to-references` (`NOT_IMPLEMENTED` / 501), as before, so on that transport the prescribed move is not yet available.

`RemoteTransport.setJsonColumnResolver` now takes a resolver that answers the column's class (`JsonColumnFieldClass`, from `@objectstack/core`), or `undefined` for a column that is not JSON, in place of `true` / `false`. `TursoDriver` supplies it. A host that calls the method itself returns `'multi-value-or-json'` where it returned `true`, and `undefined` where it returned `false`. That replaces the setter's published parameter type, so a host resolver that returns a boolean no longer compiles: a host that injects its own resolver updates its signature, which is why this release is `minor`.

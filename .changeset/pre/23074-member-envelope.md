---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

A language the environment added to an email template, which the package does not ship, is no longer treated as packaged code

Clause-②: no

An `email_template` is identified by its name and its `locale`, so the languages of one template form a bundle. When an administrator customizes a template in a language its package does not ship (for example a `zh-CN` version of a template the package ships in `en-US` only), that version is the environment's own item. Until now it was registered and served wearing the package's protection envelope, taken from the shipped `en-US` version:

- the registry's artifact lookup answered the environment's `zh-CN` version as the package's own `zh-CN` artifact;
- `GET /meta/email_template/:name?member=zh-CN` and the `/meta/email_template` list served it with `provenance: 'package'`, the package's id and its version;
- the registry heal that runs after `DELETE ?member=zh-CN` refused to retire it as packaged code.

- `@objectstack/metadata-protocol`: the artifact envelope (`_packageId`, `_packageVersion`, `_provenance`, and an artifact lock) is copied only onto a version of the same language as the shipped artifact. Each place that copies it looks up the artifact of the body's own language first. A language the package does not ship is registered and served as the environment's item. A language the package does ship keeps its envelope, its lock and its reset exactly as before. Types without languages are unchanged.
- `@objectstack/objectql`: `SchemaRegistry.removeRuntimeShadow(type, name, member)` lifts a named language's shadow only when the package ships that language. For any other language it declines, and the heal's last step (`removeOverlayEntry`) retires the entry. Naming no language still sweeps the whole bundle, as before.

A lock still binds the template name, at the read and at the write gate alike: a template the package locks stays locked in every language.

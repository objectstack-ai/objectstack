---
"@objectstack/plugin-dev": patch
---

fix(plugin-dev): a service that IS installed and fails to construct is no longer reported as "not installed" (#7926)

Every optional-service load in `DevPlugin.init()` ended in a bare `catch {}`
whose only act was to warn that the package was **not installed**. So any
failure at all — a bad config, a missing peer, a deliberate refusal, a genuine
bug in a constructor — came out as an absent package, and the operator went off
to install something they already had.

The measured instance (#6915 / PR #7924): `InMemoryDriver`'s constructor refuses
a non-`single` tenancy posture with a message naming the detected posture, both
env knobs (`OS_TENANCY_POSTURE` / `OS_MULTI_ORG_ENABLED`) and the
`@objectstack/driver-sql` remedy including `connection: { filename: ':memory:' }`.
Under `OS_TENANCY_POSTURE=isolated` an operator saw none of it — only
`✘ @objectstack/runtime or @objectstack/driver-memory not installed — skipping
driver`. A well-written refusal replaced by a false diagnosis, which is the
shape Prime Directive #10 forbids.

Each `catch` now binds the error and tells the two cases apart:

- **Absent** — today's wording and today's advice, unchanged, plus the
  resolver's own message. That last part matters for the case the code alone
  cannot separate: a package that resolves but whose *own* dependency does not
  raises the same code, and the appended message names the specifier that
  actually failed, so "install X" stays actionable.
- **Present but failed** — a distinct line at `error` level that says the
  package **is** installed, states that installing it again will not help, and
  carries the underlying `code` and `message` verbatim.

The classifier is the module system's own resolution verdict —
`ERR_MODULE_NOT_FOUND` from the ESM loader, `MODULE_NOT_FOUND` from the CJS
build's `require()`, both measured on node v22 rather than assumed — never a
match against message text. It reads no plugin's private refusal semantics, so
it does not compete with the "which stage threw" classifier the organizations
block uses one screen below.

The code is read through the error's `cause` chain, because a loader failure
does not always arrive bare: a host that transforms modules can hand back its
own error with the real one on `cause`. The **outermost** error carrying a
`code` decides, so a plugin's typed refusal is never re-read as a resolution
failure just because something deeper in its chain happens to be one.

Fixed at all eleven optional loads (objectql, driver, app metadata, i18n,
storage, realtime, auth, the setup/account app packages, security, REST,
dispatcher). The REST site differed and is handled on its own terms: its `#3963`
no-auth precondition was a `throw` *inside* the load `try`, so DevPlugin's own
refusal to serve a data API without auth was reported as
`ℹ @objectstack/rest not installed` at debug level. That check now runs before
the import and reports itself.

Behaviour is otherwise unchanged: a failed slot stays empty and `init()` still
returns. Whether DevPlugin should refuse to start when a driver refuses is a
product-shape question and is deliberately not decided here.

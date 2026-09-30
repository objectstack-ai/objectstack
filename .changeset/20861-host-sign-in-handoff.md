---
'@objectstack/plugin-auth': minor
---

feat(plugin-auth): a host declares its own sign-in handoff route with `hostSignInHandoff`, and the `no_sign_in_account_at_boot` boot report stops calling that deployment a dead end (#20861)

Clause-②: yes (widening)

`AuthPluginOptions` gains one option, `hostSignInHandoff?: boolean` (default
`false`). The HOST that constructs the plugin sets it when it signs people in
through a handoff route of its own: a route that is not a login-page provider
and that creates the session without writing a `sys_account` row. A hosted
kernel whose owner signs in through the control plane is the case it is for.
That owner can still sign in when the login page shows no platform sign-in
button:

```ts
new AuthPlugin({ /* … */ hostSignInHandoff: true });
```

With it declared, human `sys_user` rows and zero `sys_account` rows are that
deployment's normal state. The boot report then logs the shape at `debug` and
names `hostSignInHandoff` as the reason. It no longer logs an `error` saying
nobody can sign in. The option's only reader is that boot report.

- It is a declaration, not a detection. The option is the only way to set it:
  there is no environment variable or setting. Nothing infers it from an
  environment's name, from a control plane's platform-SSO flag, or from missing
  rows.
- The login page is not changed. `getPublicConfig()` returns the same value with
  or without the option, and no provider is registered.
- Set it only where the host really serves such a route. On a deployment with
  no such route, the option turns the error for a deployment nobody can sign in
  to into a quiet `debug` line.
- A deployment that does not declare it gets the same report as before. That
  includes every self-hosted deployment with no delegated sign-in path.

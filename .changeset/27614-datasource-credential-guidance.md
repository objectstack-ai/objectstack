---
'@objectstack/spec': patch
---

docs(spec): the datasource `password` refusals prescribe a credential shape the parse accepts

Clause-②: no
Metadata-protocol: none

No key is added and nothing is accepted or refused that was not before; only the text of two refusals changes.

- **Top-level `password` on a datasource.** The refusal used to say "interpolate it from the environment inside `config`". Every driver contract refuses `config.password` (and a `user:password@` URL), so following it produced a second refusal. It now names the connection form's secret field, or `external.credentialsRef` set to a `sys_secret:` handle the secret store minted, and says that key is valid on a managed datasource too.
- **`password` inside `external`.** The refusal's example was `credentialsRef: "secret:warehouse/password"`, which parses but is not a handle the shipped secret binder resolves, so the datasource stayed unconnected at boot. The example is now a `sys_secret:` handle, and the text says only those resolve.

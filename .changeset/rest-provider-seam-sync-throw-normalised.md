---
"@objectstack/rest": patch
---

fix(rest): a provider seam that throws SYNCHRONOUSLY no longer discards the whole execution context (#13280)

`RestServer.computeExecCtx` reached its host-wired providers as
`provider(environmentId).catch(() => undefined)`. That handler is attached to
the promise the call RETURNS, so it can only ever see a *rejection*. A provider
that throws BEFORE returning a promise — an ordinary non-`async` function,
which the seam's own type (`(environmentId?: string) => Promise<T>`) cannot
stop a host from wiring — threw while the expression was still being
evaluated, so there was no promise to attach to and the `.catch` was never
reached. The throw escaped to `computeExecCtx`'s outer `catch`, which discards
the ENTIRE execution context, identity included.

Measured on a real `RestServer` with a real `registerPackageRoutes`, both
callers holding a valid session and identical grants, the fault differing ONLY
in how the provider fails:

| seam | fails as | before | after |
|:--|:--|:--|:--|
| `settingsServiceProvider` | rejecting promise | 200 | 200 |
| `settingsServiceProvider` | synchronous throw | **401 UNAUTHENTICATED** | **200** |
| `objectQLProvider` | rejecting promise | 403 | 403 |
| `objectQLProvider` | synchronous throw | **401 UNAUTHENTICATED** | **403** |
| `authServiceProvider` | either | 401 | 401 |

⇒ the wire answer was decided by whether the host happened to declare its
provider `async`. A localization/settings fault, occurring AFTER identity had
already resolved and having nothing to do with authorization, told an
authenticated administrator "Authentication is required to access this
endpoint."

`computeExecCtx` now reaches those seams through one helper that invokes the
provider inside a `try`, so a synchronous throw and a rejected promise reach
the same answer. Each seam still degrades according to what it supplies — the
three do NOT collapse to a common answer (200 / 403 / 401), and that is pinned.

⚠️ This IS an observable wire-behaviour change for one fault shape
(a synchronously-throwing post-identity provider: 401 → 200). It is graded
`patch` because it is a defect repair with no surface change: no export is
added, removed or renamed, no authorable key or schema moves, and the built
`dist/index.d.ts` is byte-identical with and without it (measured by building
the package twice at the same commit; `dist/index.js` differs, which is the
control proving the rebuild saw the change). No host can reasonably have
depended on a settings outage revoking its callers' identity.

⛔ Deliberately NOT changed: `computeExecCtx`'s outer `catch`. Whether a
post-identity fault SHOULD discard identity is a separate, unruled behaviour
decision on a public door; this change only makes the two ways of failing
agree, which is correct under either answer to that question.

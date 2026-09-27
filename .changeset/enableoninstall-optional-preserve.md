---
'@objectstack/spec': minor
---

fix(spec): `enableOnInstall` becomes `optional()` so absence survives the parse

The install door was ruled onto three states — 「缺省 = 保持，有旗 = 设置」 — and
implements them: `enableOnInstall: true` enables the row, `false` disables it,
and an **absent** key makes no lifecycle call at all, so a package an operator
disabled stays disabled across an upgrade or a re-install. A fresh id has no
state to keep and lands enabled.

The published declarations said something else. `z.boolean().default(true)`
resolves absence **at parse time**, so a request that omitted the key came out
of the parse byte-identical to one that set `true` — the third state did not
exist on the published surface, while the door went on acting on it. That is a
declared default the runtime deliberately stops applying, on a contract this
repo does not own both ends of.

All three declarations now spell `z.boolean().optional()`, with the semantics
written on the field in the `describe` and the docblock:

- `api/PackageInstallRequest` (`src/api/package-api.zod.ts`) — the authority.
- `kernel/InstallPackageRequest` (`src/kernel/package-registry.zod.ts`) — the
  copy restated on the in-process protocol primitive. It is re-exported through
  `src/api/protocol.zod.ts`, so it publishes under `api/InstallPackageRequest`
  too: one declaration, two published defs.
- `marketplace/MarketplaceInstallRequest` — a different party's key on a
  different door, moved with the others so the consistency matrix stays one row
  per state. Not a fold.

**Runtime behaviour is deliberately UNCHANGED**, and nothing in this repo starts
or stops being refused. Nothing parses an install body through these schemas on
the serving path — the door reads the raw body, and `PackageApiContracts` is a
declarative catalog entry rather than a parse. The accept set does not move
either: absent, `true` and `false` are accepted before and after, and a string
or `null` is refused before and after.

### Migration: FROM → TO

| FROM | TO |
| :--- | :--- |
| omitting the key and expecting an unconditional enable, because the schema said `default: true` | send `enableOnInstall: true` — the only spelling the door has ever read as "enable" |
| omitting it and expecting the package's current state to be left alone | change nothing; that is what the door already does, and now what is declared |
| sending `enableOnInstall: false` | unchanged in every respect |
| reading `PackageInstallRequestParsed.enableOnInstall` (or the `InstallPackageRequestParsed` / `MarketplaceInstallRequestParsed` copies) after parsing a body without the key | it now yields `undefined` instead of `true` — the third state, and the one the door acts on |
| reading the published JSON Schema's `default` keyword for this key | it is gone; the key is still `type: "boolean"` and still not `required` |

**Who is actually affected:** a client or SDK outside this repo that validates
its request through the published schema and sends the **parsed** object. It
materialised `enableOnInstall: true` from the declared default and sent it
explicitly — and an explicit `true` is a force-enable, so that caller silently
re-enables a package an operator deliberately disabled, on every upgrade, while
a caller sending the identical body without validating preserves the disable.
Identical request bodies, opposite behaviour, decided by whether the caller
validated before sending. A caller that never parsed its own request body is
unaffected in every direction.

The four moved published defaults are declared in
`DEFAULT_CHANGES_BY_MAJOR` (`packages/spec/scripts/lib/default-changes.ts`),
each with the consumer prescription above; `check:authorable-surface` prints
them in full on every build that accepts them.

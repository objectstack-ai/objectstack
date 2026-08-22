---
"@objectstack/plugin-security": patch
"@objectstack/service-package": patch
"@objectstack/trigger-schedule": patch
"@objectstack/trigger-record-change": patch
"@objectstack/embedder-openai": patch
"@objectstack/driver-sqlite-wasm": patch
"@objectstack/spec": patch
---

docs: name packages that exist in seven published documents, and gate the class (#10893)

A published README ships inside the npm tarball, so an install instruction in one
reaches every reader of the package. Nine `@objectstack/` names across seven
published documents named a package that is in **no directory of this repo**, and
five of those sat on `import` lines inside runnable fences.

`check:published-readme-exports` could not see any of it, by construction. It
resolves a documented import against the package's built type surface through the
workspace member map, so a specifier that is not a member has no type entry to
compare against and the gate reads no further — strict about a member that exists,
silent about one that does not. The gate now makes the member-existence claim
first: an `@objectstack/`-scoped specifier that names no workspace member is a
finding, and the run header prints the scoped population as `N/N` so a recogniser
that stops matching shows up as a denominator that fell.

What each dead claim now says, and why:

- **`@objectstack/trigger-schedule`** and **`@objectstack/trigger-record-change`**
  each misnamed **themselves**. Both READMEs — including their `# ` titles and
  every fenced import — said `@objectstack/plugin-trigger-…`, a name that has
  never been published. The exported class names (`ScheduleTriggerPlugin`,
  `TimeRelativeTriggerPlugin`, `RecordChangeTriggerPlugin`) were correct all
  along; only the package name was wrong, so this is a rename pinned by each
  package's own `name` field.
- **`@objectstack/plugin-security`** told readers to `install
  @objectstack/plugin-org-scoping` and register an `OrgScopingPlugin` from it. No
  such package exists. The organization wall ships as the enterprise
  `@objectstack/organizations` runtime, whose `OrganizationsPlugin` registers the
  `org-scoping` service this plugin probes — the name `objectstack serve` and
  `objectstack doctor` both print. Asking for the wall without it is a refusal to
  boot (ADR-0093 D5), not a silent downgrade, and the page now says so. The
  tenant-isolation bullet pointed at `@objectstack/service-tenant`, which is the
  cloud control-plane runtime from the separate `cloud` repository and not where
  the wall comes from either.
- **`@objectstack/service-package`** described packages being "delivered to
  runtime kernels that load them through `@objectstack/service-marketplace`". That
  package was never built: ADR-0003, ADR-0016 and ADR-0025 all name it as future
  work. The loading half that does exist here is
  `@objectstack/cloud-connection`'s `MarketplaceInstallLocalPlugin`.
- **`@objectstack/embedder-openai`** had a fenced example importing
  `KnowledgeTursoPlugin` from `@objectstack/knowledge-turso` — the worst shape,
  because a reader pastes it. No knowledge adapter in this repository consumes an
  `IEmbedder` at all: `knowledge-memory` and `knowledge-ragflow` take no embedder
  option, and the adapters the contract is written for are not here. The example
  is now the `embed()` surface that does exist, with the gap stated rather than
  papered over with a substitute package name.
- **`@objectstack/driver-sqlite-wasm`**'s "When to use" table compared it against
  `@objectstack/driver-sqlite` and `@objectstack/driver-postgres`. Neither has
  ever existed; `@objectstack/driver-sql` covers PostgreSQL, MySQL and SQLite
  through Knex, choosing the client from its optional peers.
- **`@objectstack/spec`**'s published `prompts/architecture.md` instructed code
  generators to write `import { User } from '@objectstack/protocol'`. The package
  is `@objectstack/spec`, which the same sentence names as the path being
  replaced.

Four `@objectstack/` names that are **not** in this repo are deliberately left as
they are, because prose may name a package this repo does not build and a runnable
import may not: `@objectstack/security-enterprise` (the enterprise edition, whose
install hint the CLI prints and a CLI test pins), `@objectstack/service-tenant`
(the cloud runtime), `@objectstack/framework` (the umbrella install name), and the
two names `service-datasource`'s README recalls as its own past.

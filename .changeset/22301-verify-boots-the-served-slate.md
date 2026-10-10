---
'@objectstack/core': minor
'@objectstack/verify': minor
'@objectstack/plugin-email': minor
'@objectstack/service-sms': minor
'@objectstack/cli': patch
---

`bootStack` mounts the always-on capability slate `objectstack serve` mounts for every app, and builds each provider from the app's configuration the way `serve` builds it

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the in-process verification boot of @objectstack/verify: a configuration whose mail or SMS settings (or the OS_EMAIL_* / OS_SMS_* environment) name a transport that cannot deliver, or whose analytics cubes the analytics service refuses, now fails the boot where the provider was absent or built with defaults. The other categories are closed on facts: every bumped package publishes (not unpublished); no ADR-0087 id covers these paths and this diff adds none (not registered / already-registered); and the narrowed surface is a runtime boot function, not an interface or a type (not runtime-interface-only / type-surface-only). -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes.

**`@objectstack/verify` — the composition `serve` mounts, built the way `serve` builds it.** For one configuration, `bootStack(config, opts)` already mounted the providers the app's `requires` names and the plugins in its own `plugins` array. It now also:

- **Mounts the always-on slate** `serve` mounts for every app, whether or not `requires` names it: `queue`, `job`, `cache`, `settings`, `email`, `storage`, `sms`, `sharing`, `messaging`, `analytics` and `package-registry`. Before, a slate provider was mounted only where a mounted plugin hard-depended on it, so an app's tests ran without the inbox delivery, the mail service, the file storage and the package registry its users' server has.
- **Builds each provider from the app's configuration**, by the same rule `serve` reads: the analytics service gets the app's `analyticsCubes` (the top level, then each package body's), the email service the app's `email` block with `OS_EMAIL_*` over it, the SMS service the `sms` block with `OS_SMS_*` over it, and the storage service the `OS_STORAGE_LOCAL_ROOT` root (`.objectstack/data/uploads` under the working directory by default). Before, each was built with its own defaults: no cubes, no mail configuration.
- A caller's `extraPlugins`, `security` and `analytics` instances still take precedence by identity, and are not handed the configuration. A suite that needs a provider configured its own way (a temporary storage root, a mail transport) passes its instance in `extraPlugins`.
- Not mounted, because they are decisions about a server process rather than about the configuration: `serve`'s MCP endpoint (`OS_MCP_SERVER_ENABLED`) and its pinyin search (`OS_SEARCH_PINYIN_ENABLED`). A suite that exercises either passes the provider in `extraPlugins`.

**What now fails that booted before (the narrowing).** A provider `bootStack` constructs and cannot build fails the boot, naming the capability token and the package — whether the app declared the token or the slate appended it. `serve` logs a slate provider it cannot build and boots on; a test boot does not, so an app's tests never pass on a composition its server does not run. In practice:

- a configuration whose `email` or `sms` settings, or the `OS_EMAIL_*` / `OS_SMS_*` environment of the test process, name a transport that cannot deliver (`provider: 'smtp'` with no host, `resend` / `postmark` with no API key, an unknown provider tag) is refused with the reader's own remedy. Set `OS_EMAIL_PROVIDER=log` / `OS_SMS_PROVIDER=log` in the test environment if it is not meant to send mail or SMS;
- an `analyticsCubes` entry the analytics service refuses (a cube over an object the API does not serve) fails the boot with the analytics service's own refusal, where the cubes were never handed to it.

**`@objectstack/core`** exports the rule both boots read: `resolveServedCapabilities` (which capability tokens a served boot mounts providers for — the declared `requires`, `email` for a declared `auth`, the host's own defaults, the always-on slate unless the preset is `minimal`, and `job` / `queue` ahead of what schedules background work) and `resolveCapabilityArgument` (what each provider is constructed with), with their `ServedCapabilities`, `CapabilityArgumentInput` and `CapabilityArgument` types; and `resolveStorageCapabilityArg`, `resolveStorageLocalRootEnv` and `StorageCapabilityArg`, moved here from the CLI.

**`@objectstack/plugin-email`** exports `resolveEmailCapabilityArg`, `resolveDeploymentAppName` and `EmailCapabilityArg`, and **`@objectstack/service-sms`** exports `resolveSmsCapabilityArg` and `SmsCapabilityArg` — the readers that build each provider from the deployment's configuration, moved from the CLI to sit beside the transport vocabulary they refuse against. `resolveCapabilityArgument` reads each off the provider module it is handed.

**`@objectstack/cli`**: `serve` reads both rules from `@objectstack/core` and composes exactly what it composed before. `os verify` boots through `bootStack`, so it now mounts the always-on slate and builds the providers from the app's configuration. The moved functions stay importable from the `serve` command module.

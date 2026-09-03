---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): the mail transport, brand and locale bindings no longer depend on `registerRoutes`

`AuthPlugin` bound five things to the live kernel on `kernel:ready` — the
outbound mail transport (`setEmailService`), the SMS transport
(`setSmsService`), the deployment email locale (`setDefaultEmailLocale`), the
brand name (`setAppName`) and the SMS locale (`setDefaultSmsLocale`) — from
inside the same hook that mounts `/api/v1/auth/*`, and that hook was gated on
`registerRoutes`.

`registerRoutes` answers a transport-mounting question: should this plugin put
its own routes on the kernel's `http-server`. The bindings are service
composition, and they are true of an embedding regardless of who serves the
routes. So an embedding that serves auth routes itself — the whole point of
`registerRoutes: false` — came up with no mail transport, no locale on either
channel and no brand binding. Silently: the `logger.info` lines that report the
wiring were inside the same skipped block, and the `localization` settings
namespace was not even read. One visible consequence was that the workspace
language could not reach auth mail on such a host at all, and
`/api/v1/auth/config` answered `requireEmailVerification: false` because
`resolveRequireEmailVerification()` saw no transport.

The composition block now registers as its own unconditional
`ctx.hook('kernel:ready', …)` — the shape the sibling diagnosis and dev-seed
hooks in this plugin already use — placed before the route hook so a routing
host keeps the ordering the single combined hook gave it.

Route registration itself stays gated: a `registerRoutes: false` kernel still
mounts no auth routes.

**Behaviour change for `registerRoutes: false` embeddings.** They now resolve
the `email`, `sms`, `i18n` and `settings` services at `kernel:ready`, apply
`branding.workspace_name` and `localization.locale` (subscribing to both), seed
the built-in auth SMS templates when phone sign-in is enabled, and emit the
four wiring `info` lines. Hosts that had compensated by wiring these by hand
should expect the plugin's own binding to run as well; both paths are
idempotent setters, and an explicit workspace setting keeps outranking a
manifest default exactly as it does on a routing host. Nothing changes for a
host that leaves `registerRoutes` at its default.

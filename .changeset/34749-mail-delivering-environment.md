---
'@object-ui/console': patch
---

fix(console): the setup checklist reads a host's own mail transport as delivering

Clause-②: no
Metadata-protocol: none

`GET /api/settings/mail` states a transport that the host hands over, which no provider option names, as `live.provider = { value: null, source: 'environment' }`. The settings contract says in-use is read from `source`, never from a `null` value. The first-run checklist still required a non-empty `value`, so on a hosted environment its Email delivery row stayed not done while mail was being delivered. This included a deployment whose saved mail values would pass on their own.

The checklist now reads in-use from `source`. `environment` with a `null` value is in use, `none` is not, and a page without the statement still falls back to the saved mail values. The built-in AI row follows the same rule. If the server ever states its provider as `environment` with a `null` value, the row is done, keeps the `environment` source and says the platform manages the provider, because there is no option name to show.

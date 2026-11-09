---
'@objectstack/cli': patch
---

feat(cli): `createConsoleStaticPlugin` takes a `cloudflareWebAnalytics: { token }` option that adds the Cloudflare Web Analytics beacon to the console document

Clause-②: yes (widening)
Metadata-protocol: none

- **The option.** `createConsoleStaticPlugin(distPath, { cloudflareWebAnalytics: { token } })`, also on the published `@objectstack/cli/console` subpath. The document that plugin serves then carries a deferred `script` tag for `https://static.cloudflareinsights.com/beacon.min.js` with the token as its `data-cf-beacon` JSON, stamped with the document's nonce like every other script on the page, and its `content-security-policy` adds `https://cloudflareinsights.com`, where the beacon reports page views, to `connect-src`. `script-src` is unchanged: the nonce admits the beacon tag, and no host is added.
- **Per mount.** It is an option, not an env var, so a host that mounts the Console more than once (a control plane and its tenant planes) passes it to the one mount it means to count.
- **Refused at boot.** A token that is not 32 hexadecimal digits (or a missing one) throws when the plugin starts, and the message gives the value's length and kind, not the value.
- **Unchanged without it.** Left out, the document and its policy are byte-identical to before.

---
'@object-ui/console': patch
---

fix(console): a Console served from a host with an underscore or a trailing dot registers the mobile shell's push device again, without an origin

Clause-②: no
Metadata-protocol: none

- **`@object-ui/console`:** the push device registration sent `window.location.origin` for any `http:` or `https:` page. The server refuses an `origin` its host pattern cannot carry, an underscore (`http://my_svc:3000`, a container or compose service name) or a trailing dot (`https://crm.example.com.`), and a refused member refuses the whole registration, so that device got no pushes at all. The Console now keeps the origin only when the published `RegisterDeviceRequestSchema` (`@objectstack/spec/api`) accepts it, the same schema the server parses the body with; otherwise the device registers without `origin`, as the spec describes, and its pushes carry no origin. Every other host still sends its origin.

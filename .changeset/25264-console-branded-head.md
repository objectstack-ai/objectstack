---
'@objectstack/cli': patch
---

feat(cli): the console document carries the runtime branding in its `<title>`, description and Open Graph tags, written on the server, so a link preview shows the product's name

Clause-②: no
Metadata-protocol: none

`createConsoleStaticPlugin` (what `os serve` mounts at `/_console/`) used to serve the console shell with the empty `<title>` it ships, and no description or `og:*` tags. Only the shell's inline script set the title, in the browser, from `GET /api/v1/runtime/config`. A link-preview crawler or `curl` runs no script, so it saw a blank title.

Every console HTML answer (the shell and the SPA fallback) now reads the branding from that same door, in-process and for the same request, and writes:

- `<title>` and `og:title` from `branding.productName`, the name the script sets as the tab title;
- `<meta name="description">` and `og:description` from `branding.pwaDescription`;
- `og:image` from `branding.logoUrl`, resolved against the request origin;
- `og:url`, the request origin (its scheme from `x-forwarded-proto` when a proxy states `http` or `https`).

Every value is HTML-escaped, and a missing value writes no tag. A composition that mounts no `runtime/config` door gets the document exactly as before. A branding read that fails serves the document as before and logs one `warn`.

Nothing to change: `OS_PRODUCT_NAME`, `OS_PWA_DESCRIPTION`, `OS_LOGO_URL`, the `RuntimeConfigPlugin` options and, under `single`, a saved Setup → Branding name and logo reach the tags the way they reach the console.

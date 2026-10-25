---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/cli': patch
'@objectstack/runtime': patch
'@objectstack/objectql': patch
'@objectstack/metadata': patch
'@objectstack/metadata-core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/mcp': patch
'@objectstack/driver-turso': patch
'@objectstack/plugin-email': patch
'@objectstack/service-mailbox': patch
---

fix(deps): the declared `zod` floor moves to `^4.6.6`, past GHSA-mrhx-c7xc-m3w5, and `postal-mime` and `nodemailer` move to their patched releases

Clause-②: no
Metadata-protocol: none

- **`zod` `^4.6.5` → `^4.6.6`** in every package that depends on it. zod 4.6.5 and earlier can exhaust memory validating an oversized array against an array schema with no length limit ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)). 4.6.6 also changed zod's `v4/core` type declarations, so a project that had already moved its own zod to 4.6.6 or later could get a second, older zod under these packages whose types do not assign to its own; with both ranges at `^4.6.6` the two can resolve to one copy. If your project pins zod below 4.6.6, raise it to `^4.6.6`.
- **`@objectstack/service-mailbox`: `postal-mime` `^4.0.5` → `^4.0.8`.** Decoding a header made of many joined RFC 2047 encoded words took quadratic time, so one crafted message could block the event loop for seconds ([GHSA-f2hq-32vh-53cc](https://github.com/advisories/GHSA-f2hq-32vh-53cc)).
- **`@objectstack/plugin-email`: `nodemailer` `^10.0.2` → `^10.1.4`**, for three moderate advisories fixed in 10.1.4 (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h).

No API, schema or behaviour of these packages changes. The generated spec artifacts (JSON schemas, API surface, declaration map) are identical under zod 4.6.7.

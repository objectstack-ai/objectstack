---
'@objectstack/rest': patch
---

fix(rest): the API docs viewer escapes the request-derived openapi URL for the attribute it lands in

The `GET {base}/docs` viewer page builds the sibling openapi URL from the request and places it into a `data-url="…"` attribute of a script element. It interpolated that value into the attribute with no escaping, so a character the attribute context interprets reached the served markup as itself rather than as the matching HTML entity. The value is now escaped for its attribute context (ruling 3C on #25040: every outlet that renders a value into HTML escapes it by the context it lands in): the five characters a quoted attribute or element text interprets become their entities, and a browser decodes each back to the original character for the page script. A URL carrying none of those characters is served byte-identically.

Clause-②: no

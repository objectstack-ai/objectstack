---
'@objectstack/connector-rest': patch
---

fix(connector-rest): a `baseUrl` that carries a query string sends each action to its own path

Clause-②: no
Metadata-protocol: none

A REST connector whose `baseUrl` carries a fixed query parameter (`https://api.example.com/v1?region=eu`, `?api-version=2024-01`) used to put every action's path inside that query: the base and the path were joined as text, so `/items` became `…/v1?region=eu/items` and the request went to `/v1`. The request URL is now built from the parsed base: the path joins the base's path with one slash between, the base's query parameters stay the query, and the action's own parameters (written inline in `path`, or in `query`, an api-key `paramName` included) come after them. **On a clash the action's value wins**: it is the more specific intent, and refusing would break a working action the day its base gains the parameter.

A base without a query sends exactly the URL it sent before, and a path still only ever lands under the base's origin (a path like `//other.example` or an absolute URL stays a path segment). A base fragment keeps the place the text join gave it.

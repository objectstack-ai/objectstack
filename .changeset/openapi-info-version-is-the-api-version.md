---
'@objectstack/rest': patch
---

`GET {basePath}/openapi.json` no longer falls back to the spec package's
compile-time version when `api.version` is configured empty

The served `info.version` has always carried the API version identifier
(`api.version`, default `'v1'`), under a comment claiming it carried "the
runtime version so consumers don't pin to the spec package's compile-time
version". Both halves were false: the runtime version never reached the field,
and the `|| enriched.info.version` fallback published exactly the compile-time
version the comment said the line existed to avoid.

The fallback was reachable rather than dead, though not because the contract
permits it: `RestApiConfigSchema` declares
`version: z.string().regex(/^[a-zA-Z0-9_\-\.]+$/)`, which refuses `''`. Nothing
parses this config against that schema — both hops into the server are casts —
so `normalizeConfig`'s `??` is the only guard, it does not catch `''`, and the
document advertised `@objectstack/spec`'s package version. It now serves the configured value as
written, so a misconfigured deployment stays visibly misconfigured instead of
silently switching the field to a different kind of fact. Every non-empty
`api.version` — including the default — serves exactly what it served before.

`info.version` is deliberately not the runtime version: OpenAPI 3.1 defines it
as "the version of the OpenAPI document (which is distinct from the OpenAPI
Specification version or the API implementation version)". Callers who want the
serving artifact read `{basePath}/discovery` or `/health`.

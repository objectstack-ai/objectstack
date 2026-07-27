---
"@objectstack/spec": minor
---

feat(spec)!: remove the never-implemented GraphQL surface from the product plan (#2462 follow-on)

GraphQL was schema-only from day one: the spec shipped 20+ config schemas
(`GraphQLTypeConfig`, federation, persisted queries, …), the dispatcher's
`handleGraphQL` answered 501 unconditionally (`kernel.graphql` was never
assigned in the monorepo), and THREE separate mounts advertised the dead
endpoint. Per the product decision, the surface is deleted rather than
maintained:

- **spec**: `api/graphql.zod.ts` + `contracts/graphql-service.ts` deleted;
  `graphql` removed from `CoreServiceName`, `ApiProtocolType`, the
  query-adapter dialects, `graphql-playground` from testing-UI types; the
  `graphqlApi`/network capability booleans, discovery/router route fields
  dropped. Breaking for consumers referencing those exports/enum members (shipped as minor per the launch-window convention, cf. #3486/#2377).
- **runtime**: `handleGraphQL`, the if-chain branch, the dispatcher-plugin
  and hono-adapter mounts, discovery advertisement, and the now-dead
  `resolveRequestExecutionContext` helper removed.
- **plugin-dev**: the graphql stub family removed.
- **qa**: authz-conformance matrix rows, ratchet high-risk id, discover
  patterns and identity pins for the GraphQL surface retired; expression
  ledger covers updated.
- **NOT removed**: the `'graphql'` protocol option on external datasource
  lookups (third-party systems may speak GraphQL) and cloud's reserved
  slug — those are not our API surface.

`/graphql` now 404s (was an unconditional 501); the anonymous-deny posture
matrix shrinks by the two GraphQL rows.

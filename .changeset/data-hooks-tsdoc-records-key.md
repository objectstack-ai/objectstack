---
"@objectstack/client-react": patch
---

Fix the `useQuery` and `usePagination` TSDoc `@example` blocks in
`packages/client-react/src/data-hooks.tsx`, which read `data?.value` — a key
`PaginatedResult` (declared at `packages/client/src/index.ts:310`) does not
have. `PaginatedResult` declares exactly `records`, `total`, `object`, and
`hasMore`, so `data?.value` was always `undefined`; once the query resolved,
`data` was a real object and `.map` on `undefined` threw, taking the copied
component down. Both examples now read `data?.records`, matching the
hand-written doc that covers the same hooks (`content/docs/api/client-sdk.mdx`).

Swept all four `@example` blocks in the file: the `useMutation` and
`useInfiniteQuery` examples never referenced `.value` and needed no change.

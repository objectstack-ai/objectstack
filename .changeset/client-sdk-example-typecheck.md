---
"@objectstack/client-react": patch
"@objectstack/client": patch
"@objectstack/spec": patch
---

fix(client-react): correct two broken TSDoc `@example` blocks the SDK docs shipped verbatim (#10969)

TSDoc `@example` blocks are preserved into the published `dist/*.d.ts` (confirmed by
building and reading the emitted declarations), so they reach consumers directly in their
editor's hover tooltip — copying one is the intended usage. Two were actively wrong:

- `useAutoRefresh`'s example read `data.map(...)`. `data` is a `PaginatedResult` (or
  `null`), which has no `.map` — copied verbatim, this throws once the query resolves.
  Fixed to `data?.records.map(...)`.
- `useMetadata`'s example called `client.meta.getObject(...)`, a method that does not
  exist on the client (only `getItem`/`getItems`/`getView` do). Fixed to the real
  `client.meta.getItem('object', ...)`, matching `useObject`'s own implementation.

While in there: every other `@example` on this surface (18 more, across
`client-react`'s `data-hooks.tsx`/`metadata-hooks.tsx`/`realtime-hooks.tsx`/`context.tsx`
and `client`'s `index.ts`) is now genuinely self-contained and copy-paste-able — each
previously omitted the `import` for the hook or type it demonstrated, and three
`realtime-hooks.tsx` examples wrote a literal `useQuery(...)` (three dots) as a prose
placeholder, a syntax error once copied.

**`@objectstack/spec`: dev tooling only, nothing published changes.** The gate that now
type-checks the surface above (`check:skill-examples`, `packages/spec/scripts/`) lives in
this package but is not part of it — `scripts/` is outside `@objectstack/spec`'s publish
`files` allowlist (confirmed via `check:published-files`), so no consumer-visible surface
moves. Named here only because the fixed-version group requires every package with a
source diff to be covered by a changeset; the actual version bump is a byproduct of the
group moving together, not a claim that spec shipped something new.

No exported type, function signature, or runtime behaviour changed on any of the three — patch.

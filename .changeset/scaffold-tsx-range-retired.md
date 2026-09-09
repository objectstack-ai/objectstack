---
'@objectstack/cli': patch
---

chore(cli): retire `SCAFFOLD_TSX_RANGE`, a conditional statement nothing satisfies

`SCAFFOLD_TSX_RANGE` and its docblock are removed from `src/commands/init.ts`. The
`os create example` template was the only emission that ever declared a `tsx` range,
and its retirement left the constant reaching no scaffold at all.

**The docblock is the reason, and it is not a false statement.** It read *"The `tsx`
range a scaffolded project declares **when its scripts need it**"* — a conditional
whose antecedent no longer holds anywhere on the tree. Vacuously true, so no review
looking for false statements catches it; what it misleads is a reader's default
assumption that some scaffold satisfies the antecedent.

**No surviving scaffold should declare `tsx`, measured rather than assumed.** All four
surviving emissions (`os init -t app` / `-t plugin` / `-t empty`, `os create plugin`)
plus the bundled `create-objectstack` blank template run every script they emit through
`objectstack`, `tsc` or `vitest`; none executes a `.ts` entrypoint directly, which is
the only thing `tsx` is for. The capability is not missing either: `@objectstack/cli`
— which every one of those emissions declares — carries `tsx` as its own dependency.
Declaring it a second time in a scaffold would have announced a lower floor
(`^4.21.0`) for a tool the project never names.

**Nothing importable is withdrawn.** This package's `exports` map is `.` / `./console`
/ `./hook-body` / `./package.json`, with no subpath pattern, and `src/index.ts`
re-exports only the oclif command classes — so no consumer could ever import this
symbol. It is a `patch` and not a breaking change for that reason, but it is not
`skip-changeset` either: the CLI builds with plain `tsc`, so the constant really did
ship. Measured across a before/after build of `packages/cli`, four files inside the
published `files[]` move — `dist/commands/init.js`, `dist/commands/init.d.ts` and both
`.map` siblings — and the other 496 are byte-identical.

No assertion is added for the retired range. `test/scaffold-emission-policy.e2e.test.ts`
already records why: a row in that table is owed by a range some emission really
declares, and by nothing else. Its comment is updated to describe the retirement rather
than the intermediate state it used to describe.

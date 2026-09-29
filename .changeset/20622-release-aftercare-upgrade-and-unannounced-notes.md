---
'@objectstack/cli': patch
---

Upgrade note for a lockfile-preserving upgrade, and the changes 17.5.0 shipped without release notes (#20622)

Clause-②: no

**Upgrading with a scanner.** The raised dependency floors (`hono ^4.13.5` in `@objectstack/plugin-hono-server`) cover the `hono` that objectstack loads. A lockfile-preserving upgrade can keep an older `hono` copy under `@modelcontextprotocol/sdk` (reached through `@objectstack/cli` → `@objectstack/mcp`). objectstack never loads that copy: `@objectstack/mcp` imports only the SDK's `server/mcp`, `server/stdio`, `server/webStandardStreamableHttp` and `types` modules, none of which imports `hono`. A scanner still reports it. Run `pnpm update hono` (or your package manager's equivalent) to move it to the patched line.

**Shipped in 17.5.0 without notes.** The changesets below were in the tree 17.5.0 was published from, but its version commit did not consume them, so they shipped inside 17.5.0 without release notes. Their notes appear in this release for the first time. Breaking entries come first.

Breaking:

- #20458 feat(spec)!: retire the inner name on cube measures and dimensions — the record key is the member's name
- #20504 fix(spec,driver-turso)!: refuse a forced mode replica with no syncUrl at authoring and at construction
- #20567 feat(spec)!: RealtimeEventType names the emitted data.record.* / data.records.* vocabulary (carries two changesets)

Also shipped:

- #20568 fix(spec): os migrate meta guidance for fourteen more migration-entry families states each lesson in words, not tracker numbers (stage 7)
- #20572 refactor(spec): step 18 rationale as key-sorted fragments, conversionIds derived, so two retirements merge clean
- #20576 docs(spec): re-anchor the dead tracker citations in ui/ and two freed sites to the commits that decided them (stage 5)
- #20577 fix(spec,objectql): name the aggregated column at `having`, PostgreSQL only at `where`
- #20579 fix(spec,cli): os validate / os build read the ADR-0087 conversions defineStack applied — --json conversions and --strict see the producer's record
- #20582 feat(sdui-parser): the manifest marks the html tier's intrinsic tags `tier: 'html'`, ported from objectui's lockstep copy
- #20584 fix(plugin-security): an organization-less permission-set read resolves organization-less rows only
- #20585 fix(service-automation,metadata-protocol,metadata,runtime): withhold a flow's inbound-hook secret from every served definition, and keep it on a round trip
- #20591 fix(spec): nextUtcCalendarDay and utcInstantMs read years 0001..0099 as written, not as 1900..1999
- #20598 fix(plugin-security): security/explain answers enforcement's refusal for a row-level policy comparing two fields of no shared comparison class
- #20605 fix(plugin-audit): describe sys_comment reactions and mentions by the shape they store
- #20606 docs(spec): re-anchor the dead tracker citations in the packages/spec/src remainder to the commits and ADRs that decided them (stage 6)

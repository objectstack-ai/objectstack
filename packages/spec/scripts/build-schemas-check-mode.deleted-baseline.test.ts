// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 530 — spawns the real producer once per single-cause fixture: every case runs the real schema generator (build-schemas.ts --check) in its own sandbox git tree, one fixture per cause; measured 2026-10-23 on its first CI reading after #25372 split build-schemas-check-mode.test.ts (run 39963105499, Test Core, head dce4c6406): 420.84 s x 1.25, rounded up; one reading only, its wall tracks the run's load, so re-measure once the window has more
//
// Deleted authorable-surface baseline lines must prove themselves (#4650).
//
// One of the `build-schemas-check-mode.*.test.ts` files (#25372 split the one
// file so the repo project's workers run its blocks in parallel). The family's
// header — what `--check` pins and why every case runs in a sandbox git tree —
// and the shared sandbox, helpers and constants live in
// `build-schemas-check-mode.fixture.ts`.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RENAMED_DEFS } from './lib/renamed-defs';
import { RETIRED_KEYS_BY_MAJOR } from '../src/migrations/registry';
// Read ONLY to keep the #17356 fixture honest about which SET its root lives in
// — never to assert gate behaviour, which is read off the spawned run's output.
import {
  listMetadataTypeSchemaTypes,
  listUnregisteredKindSchemaTypes,
} from '../src/kernel/metadata-type-schemas';
// Read ONLY to keep the #18301 fixture honest about the TREE FACT it models — a
// key that left the shape whose door still answers an author with a prescription
// — never to assert gate behaviour, which is read off the spawned run's output.
import { MetricSchema } from '../src/data/analytics.zod';
// Read ONLY to keep the #18301 DOOR fixture honest about the tree fact it models
// — ONE `strictObject` declaration whose shape entries two emitted defs share,
// one of which never closed its door. Never to assert gate behaviour.
import { RateLimitConfigSchema } from '../src/shared/http.zod';
import { ServerRateLimitConfigSchema } from '../src/system/stack-server.zod';
import { ViewItemSchema } from '../src/ui/view.zod';
import { AUTHORABLE_SURFACE_DIR_NAME } from './lib/sharded-artifacts';
import {
  CURRENT_MAJOR,
  DELETED_AGED,
  DELETED_LIVE,
  DELETED_SERVER_TWIN,
  EAGER_SCHEMAS_ENV,
  git,
  minRegisteredMajorForLeaf,
  PRESCRIPTION_BULLET,
  pristineSurface,
  readSurfaceBase,
  RETIRED_MARK,
  run,
  seedBase,
  seedManifest,
  seedSurface,
  SERVER_TWIN_DEF,
  shardBytes,
  SHARED_TWIN_DEF,
  SPAWN_TIMEOUT_MS,
  surfaceBasePath,
  surfaceDir,
  TWIN_LEAF,
  TWIN_VALID,
  useSharedSandbox,
} from './build-schemas-check-mode.fixture';

// The repo-root `scripts/` every sandbox here symlinks in, and the generator
// imports from (#16175): an input from outside this package, so it is named in
// this file — `check:cross-package-test-inputs` reads a test file's own source,
// not the fixture module it imports (#25372).
const ROOT_SCRIPTS = fileURLToPath(new URL('../../../scripts', import.meta.url));

useSharedSandbox(ROOT_SCRIPTS);

const readSurface = () => shardBytes(surfaceDir);

/** Reachable def, tombstoned at base but never registered in the ADR-0087 registries. */
const DELETED_UNREGISTERED = 'data/Object:zzRetiredButUnregistered4650 [RETIRED]';

/** #5898's pin, in the shape the issue measured it. A tombstone whose LEAF is
 *  spoken for by an old, unrelated ADR-0087 clause — `.type` is registered at
 *  protocol 11 by `flow-node-http-callout-rename` (`flow.node.type`, a flow
 *  node's type) — and which nothing declares in RETIRED_KEYS_BY_MAJOR.
 *
 *  Until #5898 check (c) dated the aging clock by exactly this leaf match and
 *  took the `Math.min`, so this deletion was WAVED THROUGH as an aged-out
 *  tombstone: `data/Index:type`, the live specimen, was deletable at major 17
 *  one major after its own honest clause (`object.indexes[].type`, major 17)
 *  registered it. The def here is real and root-reachable, the prop is
 *  synthetic — the real key cannot be used, because check (c) only ever sees a
 *  key the build STOPPED emitting. */
const DELETED_LEAF_COLLIDER_LEAF = 'type';

const DELETED_LEAF_COLLIDER = `data/Object:${DELETED_LEAF_COLLIDER_LEAF} [RETIRED]`;

/** Emitted but not reachable from any metadata-type root: a REST response
 *  envelope no metadata document is ever parsed against (the issue's own
 *  over-collection example). */
const DELETED_UNREACHABLE = 'api/SessionResponse:zzOverCollected4650';

/** #17356's pin. A def whose ONLY root is an UNREGISTERED KIND — `connector`,
 *  bound in `UNREGISTERED_KIND_SCHEMAS` by #6245 and deliberately absent from
 *  `listMetadataTypeSchemaTypes()`. `integration/RetryConfig` sits two hops
 *  from that root (`connector.retryConfig`, unwrapped once through `optional`),
 *  and `stack.connectors[]` / `PUT /api/v1/meta/connector/:name` both parse a
 *  real metadata document through it. (The def was `integration/DataSyncConfig`,
 *  the measured specimen below, until protocol 18 retired it whole with
 *  `connector.syncConfig` — ADR-0049; `RetryConfig` is the connector's other
 *  open block on the same root at the same depth.)
 *
 *  Until #17356 the gate built its roots from `listMetadataTypeSchemaTypes()`
 *  alone, so this def read `null` and check (c) proof 2 WAIVED a bare deletion
 *  of its baseline line as "over-collection, never parsed against a metadata
 *  document" — the false "unreachable" the #4650 docblock names as the
 *  dangerous direction. Measured on `main` at ca7886047b27 by deleting
 *  `integration/DataSyncConfig:timestampField` from both the schema and the
 *  baseline: `gen:schema` exit 0, with the proof-2 line printed.
 *
 *  The prop is synthetic for the reason every fixture here is: check (c) only
 *  ever sees a key the build STOPPED emitting, and the def is judged by its
 *  DEF half (`key.slice(0, key.indexOf(':'))`), so a synthetic leaf under the
 *  real def runs the identical code path as the real deletion did. */
const DELETED_VIA_UNREGISTERED_KIND_DEF = 'integration/RetryConfig';

const DELETED_VIA_UNREGISTERED_KIND = `${DELETED_VIA_UNREGISTERED_KIND_DEF}:zzOnlyRootIsAnUnregisteredKind17356`;

/** The unregistered kind that def's only root lives in. */
const UNREGISTERED_KIND_ROOT = 'connector';

/** Def the build no longer emits at all — the literal #4643 cluster. */
const DELETED_GONE_DEF = ['identity/Session:userId', 'identity/Session:token'];

/** Base key under a def RENAMED_DEFS moved: carried, so never a deletion.
 *  Was `integration/RateLimitConfig:maxRequests` until #4911 retired that def
 *  outright and its rename entry was absorbed (a rename whose target stops
 *  being emitted cannot stay in the table), then `integration/FieldMapping`
 *  (the #4703 connector rename, 7 keys) until protocol 18 retired its target
 *  whole with `connector.fieldMappings` the same way. Re-pointed at the #4703
 *  import-side rename, which carries 4 keys — an ENUM rename (0 keys carried)
 *  would make this fixture vacuous. */
const DELETED_BY_RENAME_SOURCE_DEF = 'data/FieldMapping';

const DELETED_BY_RENAME = `${DELETED_BY_RENAME_SOURCE_DEF}:source`;

/** The SAME property under the rename's TARGET def. The committed surface is the
 *  post-rename snapshot, so it records this one and not `DELETED_BY_RENAME`; an
 *  upstream anchor from before the rename is the mirror image, and holding both
 *  at once is the #17383 collision. */
const CARRIED_BY_RENAME = `${RENAMED_DEFS[DELETED_BY_RENAME_SOURCE_DEF]}:source`;

/** #18301's pin — the GUIDANCE ROUTE, and the only fixture here that is a REAL
 *  completed retirement rather than a synthetic key.
 *
 *  `data/Metric:filters` was removed from `MetricSchema`'s shape outright (#10414,
 *  ADR-0049) with its prescription left in the closed shape's `guidance` table. A
 *  retirement done that way never carries the `[RETIRED]` mark, because there is
 *  nothing left in the shape to mark — so proof 1 could not apply to it at any
 *  major, and while proof 2 was broken (#17356) proof 2 was answering instead. The
 *  key is usable verbatim here for the same reason the synthetic ones are not:
 *  check (c) only ever sees a key the build STOPPED emitting, and this one really
 *  has stopped. */
const GUIDANCE_ROUTE_DEF = 'data/Metric';

const GUIDANCE_ROUTE_LEAF = 'filters';

const DELETED_GUIDANCE_ROUTE = `${GUIDANCE_ROUTE_DEF}:${GUIDANCE_ROUTE_LEAF}`;

/** The dark control, and the reason proof 4 is not a blanket waiver: the SAME def
 *  — same reachability, same closed door — with a key nothing prescribes for. */
const DELETED_GUIDANCE_UNNAMED = `${GUIDANCE_ROUTE_DEF}:zzNotPrescribed18301`;

/** The SHAPE of a maintainer ruling (2026-09-10, #16320) that retired a key while
 *  DELIBERATELY withholding the tombstone: a bare deletion from a reachable def
 *  that is a plain `z.object`, not a `strictObject`, so nothing declares a
 *  prescription for it and proof 4 has no route to it — which is what keeps this
 *  card an ADDED proof rather than a reversal of that ruling. The ruling's own
 *  key, `integration/DataSyncConfig:schedule`, was this fixture until protocol 18
 *  retired `DataSyncConfig` whole (ADR-0049), after which a line under it rides
 *  the vanished-def proof instead and would pin nothing here. So the fixture
 *  keeps the ruling's shape — the same `schedule` leaf on the connector's other
 *  open block, same root, same depth. If someone later writes a `guidance` entry
 *  that reaches it, this assertion flips, and it SHOULD. */
const WITHHELD_TOMBSTONE = 'integration/RetryConfig:schedule';

const DELETED_SHARED_TWIN = `${SHARED_TWIN_DEF}:${TWIN_LEAF}`;

/** #18578's LIT leg: a def whose declaration NAMES the key and which this gate
 *  cannot watch deliver it.
 *
 *  `ui/ViewItem` is a discriminated union of two `strictObject` arms that share
 *  one `VIEW_ITEM_SURFACE` table, and `confg` is the one-letter typo that table
 *  exists for. The probe writes `{ [key]: null }` and nothing else, so the
 *  DISCRIMINATOR is missing and the union answers `invalid_union` on `viewKind`
 *  before any arm's door is reached — measured, not assumed, and the same
 *  document written whole DOES raise the prescription
 *  (`ui/view-authoring-wire-split.test.ts`). So the key is promised, the author
 *  really is answered, and this gate has still watched no delivery.
 *
 *  ⛔ That is exactly the state proof 4 must read as NO EVIDENCE rather than as
 *  proof: "the door is open" would be a guess here, and a wrong guess waives a
 *  deletion in the one direction this gate must not err in. Its verdict says only
 *  THAT the prescription did not arrive, never why. */
const UNREACHED_DOOR_DEF = 'ui/ViewItem';

const UNREACHED_DOOR_LEAF = 'confg';

const DELETED_UNREACHED_DOOR = `${UNREACHED_DOOR_DEF}:${UNREACHED_DOOR_LEAF}`;

describe('build-schemas.ts — deleted baseline lines must prove themselves (#4650)', () => {
  beforeAll(() => {
    // Fixture validity, asserted loudly instead of silently going stale.
    const keys = pristineSurface;
    for (const injected of [
      DELETED_LIVE,
      DELETED_UNREGISTERED,
      DELETED_LEAF_COLLIDER,
      DELETED_UNREACHABLE,
      DELETED_VIA_UNREGISTERED_KIND,
      ...DELETED_GONE_DEF,
      DELETED_AGED,
      DELETED_BY_RENAME,
      DELETED_GUIDANCE_ROUTE,
      DELETED_GUIDANCE_UNNAMED,
      DELETED_SHARED_TWIN,
      DELETED_SERVER_TWIN,
      DELETED_UNREACHED_DOOR,
      WITHHELD_TOMBSTONE,
    ]) {
      expect(
        keys.includes(injected) || keys.includes(injected.replace(' [RETIRED]', '')),
        `fixture ${injected} already exists in the committed baseline — pick another`,
      ).toBe(false);
    }
    expect(
      keys.some((k) => k.startsWith('identity/Session:')),
      'identity/Session is emitted again — the vanished-def fixture needs a new def',
    ).toBe(false);
    // The #5898 pin is only a pin while its leaf STILL collides with a clause
    // old enough that the pre-#5898 matcher would have waved the deletion
    // through. If either half stops holding, the test below still passes while
    // asserting nothing about leaf-name matching — so both are loud here.
    const colliderMajor = minRegisteredMajorForLeaf(DELETED_LEAF_COLLIDER_LEAF);
    expect(
      colliderMajor !== null,
      `'.${DELETED_LEAF_COLLIDER_LEAF}' is no longer registered by ANY ADR-0087 clause — the ` +
        `#5898 fixture has stopped modelling a leaf collision; re-pick a colliding leaf`,
    ).toBe(true);
    expect(
      colliderMajor !== null && CURRENT_MAJOR - colliderMajor >= 2,
      `'.${DELETED_LEAF_COLLIDER_LEAF}' collides only at major ${colliderMajor}, which has NOT ` +
        `aged out at major ${CURRENT_MAJOR} — the pre-#5898 matcher would have rejected this ` +
        `deletion anyway, so the pin no longer discriminates; re-pick an older colliding leaf`,
    ).toBe(true);
    expect(
      Object.values(RETIRED_KEYS_BY_MAJOR).flat(),
      `${DELETED_LEAF_COLLIDER} is now declared for real — the pin needs an UNdeclared key`,
    ).not.toContain(DELETED_LEAF_COLLIDER.replace(RETIRED_MARK, ''));
    // #17356's fixture is only a pin while its def's root is still an
    // UNREGISTERED kind. Both halves are loud here: enrol `connector` into the
    // registered set (reversing #6245) and the test below still passes while
    // asserting nothing about this gate's own root union — the exact way a pin
    // goes quiet. This pair is also acceptance 4 of the card, stated where it
    // fails rather than where it is believed.
    expect(
      listMetadataTypeSchemaTypes(),
      `'${UNREGISTERED_KIND_ROOT}' is now a REGISTERED metadata type — #6245's boundary moved, ` +
        `so the #17356 fixture no longer models a def rooted only in UNREGISTERED_KIND_SCHEMAS`,
    ).not.toContain(UNREGISTERED_KIND_ROOT);
    expect(
      listUnregisteredKindSchemaTypes(),
      `'${UNREGISTERED_KIND_ROOT}' left UNREGISTERED_KIND_SCHEMAS — re-pick the fixture's root`,
    ).toContain(UNREGISTERED_KIND_ROOT);
    expect(
      keys.some((k) => k.startsWith(`${DELETED_VIA_UNREGISTERED_KIND_DEF}:`)),
      `${DELETED_VIA_UNREGISTERED_KIND_DEF} is no longer emitted with authorable keys — check (c) ` +
        `would route this fixture to the vanished-def proof instead; re-pick the def`,
    ).toBe(true);
    // #18301's fixture is only a pin while `data/Metric:filters` is still a
    // completed guidance-route retirement in the tree. Three halves, all loud,
    // because each can rot on its own and each rots the pin into a green that
    // asserts nothing about proof 4.
    expect(
      keys.some((k) => k.startsWith(`${GUIDANCE_ROUTE_DEF}:`)),
      `${GUIDANCE_ROUTE_DEF} is no longer emitted with authorable keys — check (c) would route ` +
        `this fixture to the vanished-def proof instead; re-pick the def`,
    ).toBe(true);
    expect(
      Object.keys(MetricSchema.shape),
      `'${GUIDANCE_ROUTE_LEAF}' is DECLARED on the shape again — it would reach the aging clock, ` +
        `not the unrecognized-key path, so this fixture no longer models the guidance route`,
    ).not.toContain(GUIDANCE_ROUTE_LEAF);
    // The lit leg and the dark leg of the same read: the retired key's rejection
    // carries a prescription bullet, an undeclared neighbour's does not.
    // No inner `name`: it is a retiredKey() tombstone now, and carrying it would
    // fail `lit` for that reason instead of the guidance-route key under test.
    const metric = { label: 'Revenue', type: 'sum', sql: 'amount' };
    const lit = MetricSchema.safeParse({ ...metric, [GUIDANCE_ROUTE_LEAF]: [{ sql: '1 = 1' }] });
    const dark = MetricSchema.safeParse({ ...metric, zzNotPrescribed18301: 1 });
    expect(lit.success, `writing '${GUIDANCE_ROUTE_LEAF}' is accepted again — re-pick the fixture`).toBe(false);
    expect(
      lit.success ? '' : lit.error.issues.map((i) => i.message).join('\n'),
      `'${GUIDANCE_ROUTE_LEAF}' is rejected with no prescription — the \`guidance\` entry that IS ` +
        `proof 4's evidence has gone; this fixture models nothing`,
    ).toContain(PRESCRIPTION_BULLET);
    expect(
      dark.success ? '' : dark.error.issues.map((i) => i.message).join('\n'),
      'an UNdeclared metric key now renders a prescription bullet too — the lit leg above has ' +
        'stopped discriminating, so it no longer reads the guidance table',
    ).not.toContain(PRESCRIPTION_BULLET);
    // #18301's DOOR fixture is only a pin while the tree still holds ONE
    // declaration answering for TWO defs. Each half rots on its own, and each
    // rots the pin into a green that asserts nothing about the one direction
    // this gate must not err in.
    expect(
      Object.keys(RateLimitConfigSchema.shape),
      `${SHARED_TWIN_DEF} and ${SERVER_TWIN_DEF} no longer declare the same key SET — the ` +
        `registry match is keyed off the sorted key set, so this fixture no longer reaches it`,
    ).toEqual(Object.keys(ServerRateLimitConfigSchema.shape));
    expect(
      Object.entries(RateLimitConfigSchema.shape).every(
        ([name, prop]) => (ServerRateLimitConfigSchema.shape as Record<string, unknown>)[name] === prop,
      ),
      `${SERVER_TWIN_DEF} no longer shares ${SHARED_TWIN_DEF}'s shape ENTRIES — the declaration ` +
        `match is by instance identity, so the two defs would stop answering to one declaration ` +
        `and this fixture would pass while modelling nothing`,
    ).toBe(true);
    // Both doors, read as a pair. #18578 is the reason they agree: the shared
    // schema carries the strictness and the tables, so the def mounted bare on
    // `apis[].rateLimit` refuses the key with the same prescription the server
    // key always got. Before that it ACCEPTED the key and dropped it, and proof 4
    // waiving THAT is what this whole block exists to prevent.
    const sharedTwin = RateLimitConfigSchema.safeParse({ ...TWIN_VALID, [TWIN_LEAF]: 'ip' });
    const serverTwin = ServerRateLimitConfigSchema.safeParse({ ...TWIN_VALID, [TWIN_LEAF]: 'ip' });
    for (const [def, result] of [[SHARED_TWIN_DEF, sharedTwin], [SERVER_TWIN_DEF, serverTwin]] as const) {
      expect(
        result.success,
        `${def} now ACCEPTS '${TWIN_LEAF}' — its door re-opened, so the DARK leg below would be ` +
          `asserting that proof 4 admits a def which drops an authored key in silence`,
      ).toBe(false);
      expect(
        result.success ? '' : result.error.issues.map((i) => i.message).join('\n'),
        `${def} rejects '${TWIN_LEAF}' with no prescription — the \`guidance\` entry that is this ` +
          `pair's evidence has gone`,
      ).toContain(PRESCRIPTION_BULLET);
    }
    // #18578's LIT fixture is only a pin while the probe still cannot watch
    // `ui/ViewItem` deliver. Both halves are loud: the bare document must fail
    // BEFORE any arm's door (no `unrecognized_keys` at all), and the whole
    // document must succeed in raising the prescription — otherwise the key is
    // either delivered (and the fixture models nothing) or not prescribed for
    // (and it models the wrong verdict).
    const bareDoor = ViewItemSchema.safeParse({ [UNREACHED_DOOR_LEAF]: null });
    expect(
      bareDoor.success,
      `${UNREACHED_DOOR_DEF} now ACCEPTS a bare '${UNREACHED_DOOR_LEAF}' — re-pick the fixture`,
    ).toBe(false);
    expect(
      bareDoor.success ? [] : bareDoor.error.issues.map((i) => i.code),
      `${UNREACHED_DOOR_DEF} now answers the PROBE's own document with an unrecognized-key ` +
        `issue — the probe reaches a door after all, so this def no longer models the boundary`,
    ).not.toContain('unrecognized_keys');
    const wholeDoor = ViewItemSchema.safeParse({
      name: 'a.b', object: 'a', viewKind: 'list', [UNREACHED_DOOR_LEAF]: { columns: [] },
    });
    expect(
      wholeDoor.success ? '' : wholeDoor.error.issues.map((i) => i.message).join('\n'),
      `'${UNREACHED_DOOR_LEAF}' no longer raises its prescription on a WHOLE ${UNREACHED_DOOR_DEF} ` +
        `document — the declaration this fixture is about has gone, so the gate's verdict would ` +
        `be 'nothing prescribes' rather than 'prescribed and not delivered'`,
    ).toContain(PRESCRIPTION_BULLET);
    // The manifest ratchet runs first; keep it current so every run reaches (c).
    seedManifest((s) => s);
  });

  it(
    'fails on deletions of reachable keys — a live key and an undeclared tombstone each say why',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedBase((s) => [...s, DELETED_LIVE, DELETED_UNREGISTERED].sort());
      const canonical = seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('authorable baseline line(s) were deleted without proof (#4650)');
      expect(output).toMatch(/data\/Object:zzNeverRetired4650 — def reachable .* LIVE \(never tombstoned\)/);
      expect(output).toMatch(
        /data\/Object:zzRetiredButUnregistered4650 — .*tombstoned, but no entry in RETIRED_KEYS_BY_MAJOR/,
      );
      // The remedy names the retirement route, not a hand-edit.
      expect(output).toContain('gen:schema');
      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    "#5898 pin — an undeclared tombstone is NOT dated by an unrelated clause that ends in its leaf",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The gate's own vocabulary, stated as the fixture guard above proves it:
      // `.type` IS registered — at protocol 11, by a flow-node rename — and this
      // key is NOT in RETIRED_KEYS_BY_MAJOR. Before #5898 those two facts
      // combined into "registered at major 11 ⇒ aged out ⇒ deletion allowed",
      // exit 0. The retirement it actually belongs to (`object.indexes[].type`)
      // is major 17; the clock was started six majors early by a coincidence of
      // spelling, and `Math.min` guaranteed the earliest such coincidence won.
      seedBase((s) => [...s, DELETED_LEAF_COLLIDER].sort());
      const canonical = seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('authorable baseline line(s) were deleted without proof (#4650)');
      expect(output).toMatch(
        new RegExp(
          `data/Object:${DELETED_LEAF_COLLIDER_LEAF} — .*tombstoned, but no entry in RETIRED_KEYS_BY_MAJOR`,
        ),
      );
      // Specifically NOT the aged-out verdict, and specifically not dated by the
      // colliding clause's major. Asserting the absence is the pin: a leaf-name
      // matcher restored here makes the run exit 0 with exactly these strings.
      expect(output).not.toMatch(
        new RegExp(`data/Object:${DELETED_LEAF_COLLIDER_LEAF} — .*tombstone aged out`),
      );
      expect(output).not.toMatch(
        new RegExp(`data/Object:${DELETED_LEAF_COLLIDER_LEAF} — .*registered at major \\d+`),
      );
      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    'still fails after the deletion is COMMITTED (the CI shape): the anchor is the merge base with origin/main, not HEAD',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      seedBase((s) => [...s, DELETED_LIVE].sort());
      const canonical = seedSurface((s) => s);
      // Commit the sabotaged (canonical-minus-line, relative to base) file so
      // the worktree is CLEAN — the state CI checks out. A `git show HEAD:`
      // anchor would now compare the commit to itself and never fire.
      git('add', AUTHORABLE_SURFACE_DIR_NAME);
      git('commit', '-q', '-m', 'PR commit deleting a baseline line');

      const check = run(['--check']);
      expect(check.status).toBe(1);
      expect(check.output).toContain('deleted without proof (#4650)');
      expect(check.output).toContain(DELETED_LIVE);

      // Write mode (gen:schema) must refuse identically — regeneration cannot
      // bless a deletion either.
      const write = run([]);
      expect(write.status).toBe(1);
      expect(write.output).toContain('deleted without proof (#4650)');
      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    'allows deletions that carry their own proof: unreachable def, vanished def — each with its reason printed',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The third proof — an aged-out tombstone — needs a RETIRED_KEYS_BY_MAJOR
      // entry since #5898, so it is exercised in the block at the bottom that can
      // write the table. `DELETED_AGED` stays out of this fixture deliberately:
      // left in, it would now be a violation, and this test asserts on `allowed`.
      seedBase((s) => [...s, DELETED_UNREACHABLE, ...DELETED_GONE_DEF].sort());
      const canonical = seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(output).toContain('baseline deletion(s) since');
      expect(output).toContain('carry their own proof (#4650)');
      // Narrow exception (2026-08-02 ruling): computed in-gate from the real
      // Zod graph, waiving ONLY the tombstone requirement.
      expect(output).toMatch(/api\/SessionResponse:zzOverCollected4650 — def not reachable from the \d+ metadata-type roots/);
      expect(output).toContain('BUILTIN_METADATA_TYPE_SCHEMAS + EXTRA_METADATA_TYPE_SCHEMAS');
      expect(output).toContain('not a license to change the schema');
      // Whole-def removal is the manifest ratchet's jurisdiction.
      expect(output).toContain('identity/Session:* (2 line(s))');
      expect(output).toContain('json-schema.manifest/ (#2978)');
      expect(readSurface()).toBe(canonical);
      expect(status).toBe(0);
    },
  );

  it(
    '#17356 — a def rooted only in an UNREGISTERED kind is reachable, and a genuinely unreachable one still is not',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // BOTH directions in ONE run, because either alone is satisfiable by a
      // gate that is simply wrong in the other direction: "always reachable"
      // passes the first assertion and destroys proof 2, "always unreachable"
      // passes the second and restores the defect.
      //
      // The defect: `computeSurfaceReachability()` built its roots from
      // `listMetadataTypeSchemaTypes()`, which per #6245 deliberately does not
      // enumerate `UNREGISTERED_KIND_SCHEMAS`. `connector` lives there, so the
      // BFS never started from it, `integration/DataSyncConfig` (then this
      // fixture's def; `integration/RetryConfig` since protocol 18) read `null`,
      // and a bare deletion of one of its baseline lines was waived as
      // over-collection — for a def `stack.connectors[]` parses on every boot.
      // The gate now enumerates its own reachability root union; the KIND
      // vocabulary `listMetadataTypeSchemaTypes()` answers is untouched (the
      // `beforeAll` guard above asserts that half).
      seedBase((s) => [...s, DELETED_VIA_UNREGISTERED_KIND, DELETED_UNREACHABLE].sort());
      const canonical = seedSurface((s) => s);

      const rx = (key: string, tail: string): RegExp =>
        new RegExp(`${key.replace(/[/$]/g, '\\$&')} — ${tail}`);

      // Read the gate as CI runs it FIRST — `gen:schema` exports
      // OS_EAGER_SCHEMAS=1, and only there does the card's acceptance sentence
      // ("answers a root-graph hit rather than null") have a literal reading.
      const eager = run(['--check'], EAGER_SCHEMAS_ENV);

      // Direction 1 — the unregistered-kind root is a root: no waiver, and the
      // verdict names the reason a reader has to act on (the entry was LIVE).
      expect(eager.status).toBe(1);
      expect(eager.output).toContain('authorable baseline line(s) were deleted without proof (#4650)');
      expect(eager.output).toMatch(
        rx(DELETED_VIA_UNREGISTERED_KIND, 'def reachable from the metadata-type roots; .*was LIVE'),
      );
      // Specifically NOT the proof-2 waiver, for this key. Asserting the absence
      // is the pin: narrow the roots back to `listMetadataTypeSchemaTypes()` and
      // the run exits 0 printing exactly the string below.
      expect(eager.output).not.toMatch(rx(DELETED_VIA_UNREGISTERED_KIND, 'def not reachable from the'));

      // Direction 2 — conservatism is not turned around. A REST response
      // envelope no metadata document is parsed against still reads unreachable
      // and still carries its own proof, in this same run.
      expect(eager.output).toContain('carry their own proof (#4650)');
      expect(eager.output).toMatch(rx(DELETED_UNREACHABLE, 'def not reachable from the \\d+ metadata-type roots'));
      // The waiver message names all three sources of the union it computed, so
      // a reader judging a waiver is not reading the pre-#17356 claim that the
      // roots are the REGISTERED set.
      expect(eager.output).toContain('BUILTIN_METADATA_TYPE_SCHEMAS + EXTRA_METADATA_TYPE_SCHEMAS');
      expect(eager.output).toContain('UNREGISTERED_KIND_SCHEMAS');

      // Same two directions under the lazy-Proxy graph, where the def resolves
      // through the derived-clone bridge rather than by identity. The VERDICT is
      // what this gate acts on, so it is the verdict that is pinned in both
      // regimes; the wording differs and is deliberately not asserted here.
      const lazy = run(['--check']);
      expect(lazy.status).toBe(1);
      expect(lazy.output).toMatch(rx(DELETED_VIA_UNREGISTERED_KIND, 'def .*was LIVE \\(never tombstoned\\)'));
      expect(lazy.output).not.toMatch(rx(DELETED_VIA_UNREGISTERED_KIND, 'def not reachable from the'));
      expect(lazy.output).toMatch(rx(DELETED_UNREACHABLE, 'def not reachable from the \\d+ metadata-type roots'));

      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    '#18301 — a guidance-route retirement on a reachable def proves itself; the same deletion, unnamed, does not',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // FOUR keys, ONE run, because every one of them is satisfiable by a gate
      // that is simply wrong somewhere else — and a proof that admits everything
      // and a proof that admits nothing both pass a one-legged test:
      //
      //   - `DELETED_GUIDANCE_ROUTE`  a blanket waiver passes this alone;
      //   - `DELETED_GUIDANCE_UNNAMED` the SAME def, so a gate that keyed proof 4
      //     off the def rather than the KEY passes the first and fails here;
      //   - `WITHHELD_TOMBSTONE`      the 2026-09-10 ruling, which this card adds
      //     a proof beside and must not reverse;
      //   - `DELETED_UNREACHABLE`     proof 2's own territory, unchanged — it
      //     would move if proof 4 had been written as a widening of proof 2
      //     instead of a fourth proof beside it;
      //   - `DELETED_AGED`            the DISJOINTNESS, measured rather than
      //     argued: `data/Object:compactLayout` is a `[RETIRED]` baseline entry
      //     AND a real `guidance` key on the same def, so a proof 4 that did not
      //     require the entry to be un-marked takes this deletion off proof 1's
      //     aging clock. It did, on the way in — the two #5898 cases at the
      //     bottom of this file are what caught it.
      seedBase((s) => [
        ...s,
        DELETED_GUIDANCE_ROUTE,
        DELETED_GUIDANCE_UNNAMED,
        WITHHELD_TOMBSTONE,
        DELETED_UNREACHABLE,
        DELETED_AGED,
      ].sort());
      const canonical = seedSurface((s) => s);

      const rx = (key: string, tail: string): RegExp =>
        new RegExp(`${key.replace(/[/$]/g, '\\$&')} — ${tail}`);

      // Read the gate as CI runs it first: `check:authorable-surface` exports
      // OS_EAGER_SCHEMAS=1, so `zodByDefKey` holds the real instances and the
      // declaration registry proof 4 reads is populated by construction.
      const eager = run(['--check'], EAGER_SCHEMAS_ENV);

      // Direction 1 — proof 4 fires, and the verdict carries its own evidence:
      // which def, that the door is closed, and the key it prescribes for BY
      // NAME. A reader judging this waiver is not taking the deleter's word.
      expect(eager.output).toContain('carry their own proof (#4650)');
      expect(eager.output).toMatch(
        rx(
          DELETED_GUIDANCE_ROUTE,
          `def reachable from the metadata-type roots; writing '${GUIDANCE_ROUTE_LEAF}' on it is ` +
            `REFUSED as an unrecognized key`,
        ),
      );
      expect(eager.output).toContain('carries the prescription its `strictObject` declaration owes');
      // Specifically NOT proof 2. `data/Metric` hangs off the `analytics_cube`
      // root, one of the four unregistered kinds #18131 put into the root union,
      // so before that repair this key read unreachable and was waived for the
      // WRONG reason — which is exactly how the class stayed invisible.
      expect(eager.output).not.toMatch(rx(DELETED_GUIDANCE_ROUTE, 'def not reachable from the'));

      // Direction 2 — the same deletion, on the same def, with nothing naming
      // the key: still a violation. This is what makes proof 4 a proof and not a
      // waiver for the def.
      expect(eager.status).toBe(1);
      expect(eager.output).toContain('authorable baseline line(s) were deleted without proof (#4650)');
      expect(eager.output).toMatch(
        rx(DELETED_GUIDANCE_UNNAMED, 'def reachable from the metadata-type roots; .*was LIVE'),
      );
      expect(eager.output).not.toMatch(rx(DELETED_GUIDANCE_UNNAMED, 'def .*is REFUSED as an unrecognized key'));
      // …and not the "declared but not delivered" verdict either: nothing NAMES
      // this key, so its reader is not sent looking for a `guidance` entry that
      // was never written.
      expect(eager.output).not.toMatch(rx(DELETED_GUIDANCE_UNNAMED, 'def .*declaration NAMES'));

      // Direction 3 — the withheld tombstone stays withheld. Nothing prescribes
      // for `schedule`, so proof 4 has no route to it and the deletion is still
      // refused, on the same verdict it was refused on before this card.
      expect(eager.output).toMatch(rx(WITHHELD_TOMBSTONE, 'def .*was LIVE \\(never tombstoned\\)'));
      expect(eager.output).not.toMatch(rx(WITHHELD_TOMBSTONE, 'def .*is REFUSED as an unrecognized key'));

      // Direction 4 — proof 2's repaired conservatism is untouched: a def no
      // metadata document is ever parsed against still reads `null` and is still
      // waived by proof 2, with proof 2's words and not proof 4's.
      expect(eager.output).toMatch(rx(DELETED_UNREACHABLE, 'def not reachable from the \\d+ metadata-type roots'));
      expect(eager.output).not.toMatch(rx(DELETED_UNREACHABLE, 'def .*is REFUSED as an unrecognized key'));

      // Direction 5 — the two proofs are DISJOINT, not merely different. This key
      // satisfies every OTHER condition proof 4 tests: reachable def, closed
      // shape, and `compactLayout` really is in `data/Object`'s `guidance` table.
      // What disqualifies it is that its baseline entry carried `[RETIRED]`, so it
      // is a tombstone and stays on proof 1's clock — here refused for want of a
      // RETIRED_KEYS_BY_MAJOR declaration, exactly as before this card.
      const agedKey = DELETED_AGED.replace(RETIRED_MARK, '');
      expect(eager.output).toMatch(rx(agedKey, 'def .*tombstoned, but no entry in RETIRED_KEYS_BY_MAJOR'));
      expect(eager.output).not.toMatch(rx(agedKey, 'def .*is REFUSED as an unrecognized key'));

      // The same five verdicts under the lazy-Proxy graph, where every def
      // resolves through `zodShapeOf`'s lazy getter rather than by identity. The
      // VERDICT is what this gate acts on, so it is the verdict pinned in both
      // regimes.
      const lazy = run(['--check']);
      expect(lazy.status).toBe(1);
      expect(lazy.output).toMatch(rx(DELETED_GUIDANCE_ROUTE, 'def .*is REFUSED as an unrecognized key'));
      expect(lazy.output).toMatch(rx(DELETED_GUIDANCE_UNNAMED, 'def .*was LIVE \\(never tombstoned\\)'));
      expect(lazy.output).toMatch(rx(WITHHELD_TOMBSTONE, 'def .*was LIVE \\(never tombstoned\\)'));
      expect(lazy.output).toMatch(rx(DELETED_UNREACHABLE, 'def not reachable from the \\d+ metadata-type roots'));
      expect(lazy.output).not.toMatch(rx(agedKey, 'def .*is REFUSED as an unrecognized key'));

      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    '#18301 — proof 4 reads the DOOR, not the registry: a promise the gate cannot watch kept is no proof',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The case the contract review found, pinned in the spelling the tree
      // really holds — and #18578 moved that spelling, so read both halves.
      //
      // ## What this used to pin, and why it could not stay
      //
      // `ServerRateLimitConfigSchema` was
      // `strictObject({… guidance: { keyBy, store } }, RateLimitConfigSchema.shape)`,
      // so ONE declaration answered for TWO emitted defs by shape identity — and
      // only one of them had ever closed its door. Everything the first cut of
      // proof 4 read said the two were the same:
      //
      //   - both emit `additionalProperties: false` (measured: in `io: 'output'`
      //     zod says `false` for a non-closing shape too — the ledger reading at
      //     docs/audits/2026-07-unknown-key-strictness-ledger.md);
      //   - both match that one declaration by sorted key set AND by per-entry
      //     instance identity, because the strict one was BUILT from the open
      //     one's shape object;
      //   - both are reachable, so proof 2 answers for neither.
      //
      // #18578 closed the open twin rather than leaving a live silent strip in
      // the tree for this test to point at, which is what the fixture guard's own
      // "re-pick the pair" instruction prescribes. The pair is now the DARK leg.
      //
      // ## What it pins now
      //
      // The invariant is unchanged and is the only one that matters here: proof 4
      // admits a deletion ONLY where it has watched the def answer, and reads
      // every other state as no evidence. So the LIT leg is a def whose
      // declaration NAMES the key and whose delivery this gate cannot observe —
      // `ui/ViewItem`, a discriminated union the probe's one-key document cannot
      // drive past `viewKind` to any arm's door. Its author IS answered; this
      // gate has still seen nothing, and guessing "the door is open" or "the door
      // is closed" are both wrong here. It refuses.
      seedBase((s) => [...s, DELETED_SHARED_TWIN, DELETED_SERVER_TWIN, DELETED_UNREACHED_DOOR].sort());
      const canonical = seedSurface((s) => s);

      const rx = (key: string, tail: string): RegExp =>
        new RegExp(`${key.replace(/[/$]/g, '\\$&')} — ${tail}`);

      const eager = run(['--check'], EAGER_SCHEMAS_ENV);

      // DARK — BOTH twins are admitted by proof 4, on the door's own evidence.
      // One declaration, two defs, and since #18578 one door: the def mounted
      // bare on `apis[].rateLimit` answers exactly as the server key does. The
      // `shared/` row is the regression guard for that card — re-open the shared
      // shape and it stops being admitted here.
      expect(eager.output).toContain('carry their own proof (#4650)');
      expect(eager.output).toMatch(
        rx(DELETED_SERVER_TWIN, `def .*; writing '${TWIN_LEAF}' on it is REFUSED as an unrecognized key`),
      );
      expect(eager.output).toMatch(
        rx(DELETED_SHARED_TWIN, `def .*; writing '${TWIN_LEAF}' on it is REFUSED as an unrecognized key`),
      );

      // LIT — refused, and refused in words that name what is actually missing.
      // The `guidance` entry exists; what this gate could not obtain is a reading
      // of it being delivered, so the plain "was LIVE (never tombstoned)" verdict
      // would send its reader to write an entry that is already there.
      expect(eager.status).toBe(1);
      expect(eager.output).toContain('authorable baseline line(s) were deleted without proof (#4650)');
      expect(eager.output).toMatch(
        rx(DELETED_UNREACHED_DOOR, `def .*; a \`strictObject\` declaration NAMES '${UNREACHED_DOOR_LEAF}', but writing it`),
      );
      expect(eager.output).not.toMatch(rx(DELETED_UNREACHED_DOOR, 'def .*is REFUSED as an unrecognized key'));
      // …and it is not being waived by some OTHER proof either. The def is
      // root-reachable, so proof 2 must not answer for it — without this leg the
      // case would pass on a gate that had simply stopped emitting proof 4 at all.
      expect(eager.output).not.toMatch(rx(DELETED_UNREACHED_DOOR, 'def not reachable from the'));

      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    "#18301 — the remedy names four proofs, and names what the fourth one needs",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The remedy is the only thing an author who hits this gate reads. Until
      // this card it listed three routes and a guidance-route retirement matched
      // none of them, so the honest next step was invisible — the #12574 shape,
      // one proof further on.
      seedBase((s) => [...s, DELETED_GUIDANCE_UNNAMED].sort());
      seedSurface((s) => s);

      const { status, output } = run(['--check'], EAGER_SCHEMAS_ENV);

      expect(status).toBe(1);
      expect(output).toContain('A line may only leave this file when:');
      for (const route of ['     1.', '     2.', '     3.', '     4.']) {
        expect(output, `the remedy stopped naming route ${route.trim()}`).toContain(route);
      }
      // Route 4 states all three halves of its own evidence — the un-marked
      // baseline entry, the closed door, the named key — and the narrowing that
      // keeps it from being a blanket waiver. The un-marked half is the one a
      // reader most needs: without it route 4 reads as a way around route 1.
      expect(output).toContain('its baseline entry was NOT `[RETIRED]`');
      expect(output).toContain('writing the key on its def is');
      expect(output).toContain('REFUSED as an unrecognized key carrying the prescription its');
      // The remedy must not repeat the claim this round removed — that the
      // published `additionalProperties: false` proves the door. It now says the
      // opposite in the gate's own words, because an author reading route 4 is
      // exactly who would otherwise go looking for that field.
      expect(output).toContain("zod emits `false` for a stripping shape too");
      expect(output).toContain('an enumerated');
      expect(output).toContain('entry counts, a RegExp one does not');
      expect(output).toContain("A key that IS marked is a tombstone");
    },
  );

  it(
    'check (a) is intact: a key the BUILD stops emitting while still recorded is fatal before (c) ever runs',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const phantom = 'data/Object:zzPhantom4650';
      seedBase((s) => [...s, phantom].sort());
      const withPhantom = seedSurface((s) => [...s, phantom].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/1 authorable key\(s\) disappeared from the contract/);
      expect(output).toContain(phantom);
      expect(output).not.toContain('deleted without proof');
      expect(readSurface()).toBe(withPhantom);
    },
  );

  it(
    "check (a)'s remedy names every route and claims exhaustiveness for none (#12574)",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Same trip condition as the test above — this one reads the REMEDY rather
      // than the verdict. The message once said tombstoning was the only route and
      // that an aged-out tombstone was "the ONE legitimate reason to delete": a
      // claim of exhaustiveness that check (c) below already contradicted in its
      // own logic (proofs 2 and 3), and that measurably re-routed a dev off a
      // documented route. The pin is on the FORK — the precondition question, both
      // of its answers, and the absence of the exhaustiveness claim.
      seedBase((s) => [...s, 'data/Object:zzPhantom12574'].sort());
      seedSurface((s) => [...s, 'data/Object:zzPhantom12574'].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);

      // The fork is asked as a question about the def, not decreed.
      expect(output).toContain('Does anything still PARSE this def');

      // Route A — the def survives, so there is a reader to warn.
      expect(output).toContain('tombstone the key instead of deleting it');
      expect(output).toContain('retiredKey(');

      // Route B (#4650 proofs 2 and 3) — nothing parses the def, or the whole def
      // is leaving: the baseline line goes with the key, and check (c) adjudicates.
      expect(output).toContain('not reachable from the metadata-type roots');
      expect(output).toContain('the whole def is leaving this build');
      expect(output).toContain('gen:schema');
      expect(output).toContain('#4650 proofs');
      // The 2026-08-02 ruling's limit travels with the route it waives.
      expect(output).toContain("waives THIS file's tombstone requirement only");

      // The aged-out tombstone survives as A route, no longer as THE reason.
      expect(output).toContain('aged out (one major, #25767)');
      expect(output).toContain('RETIRED_KEYS_BY_MAJOR');
      expect(output).not.toContain('ONE legitimate reason');

      // Still gate (a) talking: (c) never ran.
      expect(output).not.toContain('deleted without proof');
    },
  );

  it(
    'fails --check on a hand-edit that changes no key (generated-form mismatch, #4662), and write mode regenerates it',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      seedBase((s) => s);
      const canonical = seedSurface((s) => s);
      // One SHARD is hand-edited, not the whole set — the sharded shape of the
      // #4662 fixture, and a strictly narrower one: the gate has to name the
      // shard rather than notice the aggregate moved.
      const editedShard = path.join(surfaceDir, 'data.json');
      fs.writeFileSync(
        editedShard,
        fs
          .readFileSync(editedShard, 'utf8')
          .replace('Ratchet of every AUTHORABLE key', 'Ratchet  of every AUTHORABLE key'),
      );
      const handEdited = readSurface();
      expect(handEdited).not.toBe(canonical);

      const check = run(['--check']);
      expect(check.status).toBe(1);
      expect(check.output).toContain('does not match its generated form');
      expect(check.output).toContain('~ authorable-surface/data.json  (stale)');
      expect(readSurface()).toBe(handEdited);

      const write = run([]);
      expect(write.status).toBe(0);
      expect(write.output).toContain('🔑 authorable-surface/ updated');
      expect(write.output).toContain('touched: data.json');
      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    'fails LOUDLY when NO anchor of either kind is available — a deletion check that silently skips is the bypass again',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Until #5235 an unresolvable origin/main was fatal on its own. It no
      // longer is (the in-tree anchor takes over — see the #5235 block below),
      // but the property this test was written for is untouched and pinned here:
      // with NOTHING left to anchor on, the build fails rather than skipping.
      const head = seedBase((s) => s);
      seedSurface((s) => s);
      const anchor = readSurfaceBase();
      git('update-ref', '-d', 'refs/remotes/origin/main');
      fs.rmSync(surfaceBasePath);
      try {
        const { status, output } = run(['--check']);
        expect(status).toBe(1);
        expect(output).toContain('No baseline to anchor');
        expect(output).toContain('#4650');
        // Both remedies are named — neither is an env var.
        expect(output).toContain('authorable-surface.base.json');
        expect(output).toContain('git fetch origin main');
      } finally {
        fs.writeFileSync(surfaceBasePath, anchor);
        git('update-ref', 'refs/remotes/origin/main', head);
      }
    },
  );

  it(
    'a declared def rename is not a deletion: base keys are carried through RENAMED_DEFS before comparing',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      expect(Object.keys(RENAMED_DEFS)).toContain(DELETED_BY_RENAME_SOURCE_DEF);
      // The carried key must actually land under the NEW def, or this asserts
      // nothing — a rename entry whose target lost the key is check (a0)'s case.
      expect(pristineSurface).toContain(
        `${RENAMED_DEFS[DELETED_BY_RENAME_SOURCE_DEF]}:source`,
      );
      // ⚠️ The old key is INJECTED and the carried one REMOVED, which is what an
      // upstream anchor from before the rename really looks like: the property
      // is recorded under the OLD def and not yet under the new one. Injecting
      // alone left the base recording `source` under BOTH defs — a shape no
      // real landing produces, and one #17383's collision guard now refuses
      // outright (measured: the run exits 1 before this check is reached), so
      // the fixture would have been asserting about a build that never got here.
      seedBase((s) => [...s.filter((k) => k !== CARRIED_BY_RENAME), DELETED_BY_RENAME].sort());
      seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(output).not.toContain('deleted without proof');
      expect(output).not.toContain('carry their own proof');
      expect(status).toBe(0);
    },
  );

  // ─── #17383 — a rename may MOVE keys, it may never MERGE two onto one ─────
  // `checkRenameTable` validates the table against the defs the build EMITS, so
  // this shape is invisible to it: one well-formed rename, source unemitted,
  // target emitted. The damage is in the BASELINE, where the carry's plain
  // `Map.set` collapses the two entries and drops one side's recorded retired
  // state and default — before any ratchet below runs.

  it(
    'refuses a rename whose baseline records the same property under BOTH defs, and writes nothing',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The target keeps `CARRIED_BY_RENAME`, so the base records `source` under
      // the source def AND the target def. That is the collision.
      seedBase((s) => [...s, DELETED_BY_RENAME].sort());
      const surfaceBytes = seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('would COLLAPSE keys of the upstream baseline');
      expect(output).toContain(
        `${DELETED_BY_RENAME_SOURCE_DEF} → ${RENAMED_DEFS[DELETED_BY_RENAME_SOURCE_DEF]}`,
      );
      expect(output).toContain('under the TARGET def — source');
      // The remedy is the one the two-sources rule already prescribes.
      expect(output).toContain('retiredKey()');
      // A check reports; it does not write (#4711).
      expect(readSurface()).toBe(surfaceBytes);
    },
  );

  it(
    'does NOT refuse a rename into a populated target when no property name is shared',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The cost this guard can impose, pinned: the target def is populated in
      // the base (three other keys survive the filter below), and the carried
      // property name is not one of them. `Map.set` collapses only entries that
      // are the SAME key, so this merge writes every key exactly once and loses
      // nothing. Refusing a populated target as such would redden most of the
      // committed table.
      const baseKeys = [
        ...pristineSurface.filter((k) => k !== CARRIED_BY_RENAME),
        DELETED_BY_RENAME,
      ].sort();
      const targetDef = RENAMED_DEFS[DELETED_BY_RENAME_SOURCE_DEF];
      expect(
        baseKeys.filter((k) => k.startsWith(`${targetDef}:`)).length,
        'the target def must still hold keys in the base, or this pins nothing',
      ).toBeGreaterThan(0);
      seedBase(() => baseKeys);
      seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(output).not.toContain('would COLLAPSE keys');
      expect(status).toBe(0);
    },
  );
});

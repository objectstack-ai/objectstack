// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * GATE — the REST `/packages` door's field allowlist must not silently drop a
 * key the PRODUCER stamps.
 *
 * ## The defect this exists to catch
 *
 * `REGISTRY_PACKAGE_RESPONSE_FIELDS` (`package-routes.ts`) is a hand-written
 * allowlist, and that was a deliberate trade: a newly declared or
 * producer-stamped field becomes an explicit decision at this door, and drift
 * shows up as a **missing field** rather than as the `500 Converting circular
 * structure to JSON` the projection replaced.
 *
 * The other half of that trade is this file. Within one day of the allowlist
 * landing, the protocol started stamping an ADR-0070 D2 `writable` verdict on
 * every `getMetaItems({ type: 'package' })` row. The allowlist did not list it,
 * so the door would have answered **200 with the verdict simply absent** — no
 * 500, no red, and nothing on the wire a consumer could tell apart from "this
 * package has no verdict". It was caught by someone happening to read a sibling
 * pin. That is not a mechanism.
 *
 * ⚠️ `writable` itself is now pinned by name in
 * `package-list-writable-carry.test.ts`, so the *known* field is covered. What
 * was missing — and is what this file supplies — is the GENERAL case: **nothing
 * generalised to the NEXT stamped key.** The next ADR-0070-style verdict lands
 * with exactly the same silence.
 *
 * ## The invariant, and why it is derived rather than listed
 *
 *     served key set  ⊇  producer key set  −  DELIBERATELY_NOT_SERVED
 *
 * Both sides are MEASURED by running real code in this test:
 *
 *  - the producer side is the real `ObjectStackProtocolImplementation`
 *    (`getMetaItems({ type: 'package' })`) over a real `SchemaRegistry` — the
 *    same path production reads, including the `writable` stamp and the
 *    `decorateMetadataItem` graft;
 *  - the served side is this door's real `GET /api/v1/packages` output.
 *
 * ⛔ Neither side is a hand-written key list. A fixture that hand-listed the
 * producer's keys would be a THIRD copy of the same truth and would drift
 * alongside the two it is meant to compare. The only hand-kept artifact here is
 * {@link DELIBERATELY_NOT_SERVED} — an explicit, annotated exclusion register,
 * which the card requires to be exactly that: a decision that must be written
 * down, never an omission that accumulates in silence.
 *
 * ⛔ The allowlist is NOT derived from `packages/spec`. That was weighed and
 * rejected on the originating card (it makes the published surface a side
 * effect of a schema edit, and adds a spec import edge to `@objectstack/rest`).
 * This file is the detector that makes the hand-list honest — not a re-opening
 * of that decision.
 *
 * ## Why the invariant is `⊇` and not `=`
 *
 * This door must KEEP dropping an undeclared member that leaks onto a registry
 * item — that is the whole point of projecting rather than spreading, and a
 * set-equality gate would force such a member back onto the wire and re-open
 * the `500`. So the gate is one-directional, and the fixture installs its
 * packages through the real `SchemaRegistry.installPackage`: over a clean
 * install the producer's key set IS "declared record fields + producer stamps",
 * which is exactly the set that must survive. A future producer key that
 * genuinely should not be published therefore arrives here as a red, and is
 * answered by writing it into {@link DELIBERATELY_NOT_SERVED} with a reason —
 * an explicit decision at the door, which is what the card asked for. The last
 * test in this file pins the drop so the two claims stay visibly compatible.
 *
 * ## The twin door has a DIFFERENT invariant — do not assume symmetry
 *
 * The runtime dispatcher twin (`packages/runtime/src/domains/packages.ts`)
 * solved the same near-miss the other way: `writable` is NOT an allowlist
 * member there, and the door stamps it AFTER the projection instead. Asserting
 * "the allowlist contains every stamped key" over there would red on a correct
 * door. Its own half of this gate is
 * `packages/runtime/src/domains/package-door-producer-key-carry.test.ts`, which
 * states the ordering invariant instead. Two pins, one shape — see that file's
 * header for why they are not one file.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';

/**
 * Keys the producer puts on a package row that this door deliberately does NOT
 * serve. **Explicit and annotated by construction** — an entry added here is a
 * published-surface decision someone wrote down, which is the whole difference
 * between this register and the silent omission it replaces.
 *
 * Empty today: every key the real producer stamps on a package row is carried.
 * Measured, not assumed — {@link producerKeysOf} reads the real
 * `getMetaItems({ type: 'package' })` output, and the assertion below fails
 * with the offending key names when that stops being true.
 *
 * ⛔ Adding a key here to make a red test green is the defect one level up. The
 * question an entry must answer is "why must this door withhold it?", and the
 * answer belongs in the comment beside it.
 */
const DELIBERATELY_NOT_SERVED: readonly string[] = [];

/** The engine's own `actionActivation -> store -> engine` cycle, reproduced. */
function cyclicEngine(): Record<string, unknown> {
  const engine: Record<string, unknown> = { name: '_ObjectQL' };
  const store: Record<string, unknown> = { name: 'ObjectStoreActionActivationStore', engine };
  engine.actionActivation = { name: 'ActionActivationProjection', store };
  return engine;
}

/** A host-constructed connector plugin that takes the engine on init. */
class FakeConnectorPlugin {
  name = 'connector-rest';
  engine: unknown;
  init(engine: unknown) { this.engine = engine; }
}

/** Booted app package, explicit `scope: 'project'` — the producer says read-only. */
const CODE_PROJECT = 'com.example.showcase';
/** Platform-delivered plugin package. */
const SYSTEM_SCOPED = 'com.objectstack.setup';
/** Studio-created database base: installed, never booted, scope-less. */
const DB_BASE = 'com.acme.mybase';


/**
 * Seat a value on every DECLARED-BUT-UNSET field of a record.
 *
 * `installPackage` leaves the optional lifecycle fields as own properties
 * holding `undefined`, and {@link definedKeys} — correctly — cannot see a key
 * the wire could never carry. The consequence was MEASURED, and it is the
 * reason this helper exists: over a bare install the coverage assertion below
 * observed only 4 of the record's 12 declared fields, and deleting
 * `installedVersion` from the door's allowlist left this gate GREEN. A gate
 * blind to two thirds of the surface it names is the defect it was written to
 * catch, one level up.
 *
 * The fill is DERIVED from the record's own key set — every own key whose value
 * is `undefined` gets one — so this is still not a hand-written list of field
 * names, and a field added to the record tomorrow is seated without an edit
 * here. The values are deliberately meaningless: this gate compares KEY SETS,
 * and what each field must CONTAIN is pinned by that field's own tests.
 */
function seatDeclaredFields(record: Record<string, unknown>): void {
  for (const k of Object.keys(record)) {
    if (record[k] === undefined) record[k] = `__seated__${k}`;
  }
}

/**
 * A registry in the showcase's shape, built through the REAL
 * `SchemaRegistry.installPackage` — so the records under test are the records
 * production holds, not a literal someone typed next to the assertion.
 */
function realRegistry(): SchemaRegistry {
  const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
  (registry as unknown as { logLevel: string }).logLevel = 'silent';

  const plugin = new FakeConnectorPlugin();
  registry.installPackage({
    id: CODE_PROJECT,
    name: 'Showcase',
    namespace: 'showcase',
    version: '0.3.16',
    type: 'app',
    scope: 'project',
    description: 'Kitchen-sink showcase workspace',
    objects: [{ name: 'invoice', fields: { total: { type: 'currency' } } }],
    apps: [{ name: 'showcase', label: 'Showcase' }],
    plugins: [plugin],
  } as never);
  // Init AFTER install — the measured ordering: the manifest serialised cleanly
  // during boot and only became cyclic once the plugins came up.
  plugin.init(cyclicEngine());

  registry.installPackage({
    id: SYSTEM_SCOPED, name: 'Setup', namespace: 'setup', version: '9.3.0',
    type: 'plugin', scope: 'system',
  } as never);

  registry.installPackage({
    id: DB_BASE, name: 'My Base', namespace: 'mybase', version: '1.0.0', type: 'app',
  } as never);

  // Every declared field carries a value from here on — see
  // `seatDeclaredFields` for the measurement that made this necessary.
  for (const id of [CODE_PROJECT, SYSTEM_SCOPED, DB_BASE]) {
    seatDeclaredFields(registry.getPackage(id) as unknown as Record<string, unknown>);
  }

  return registry;
}

/**
 * The real producer, over that registry. `manifests` is what `ObjectQL.registerApp`
 * records for every package of a loaded artifact — the ADR-0070 D2 predicate
 * reads it FIRST, so it is what separates a booted (read-only) package from a
 * Studio-created (writable) base and makes the `writable` stamp non-constant.
 */
function realProducer(registry: SchemaRegistry): ObjectStackProtocolImplementation {
  const engine: Record<string, unknown> = {
    registry,
    manifests: new Map<string, unknown>([
      [CODE_PROJECT, registry.getPackage(CODE_PROJECT)?.manifest],
      [SYSTEM_SCOPED, registry.getPackage(SYSTEM_SCOPED)?.manifest],
    ]),
    // No `sys_metadata` overlay in this fixture: the subject is the registry
    // half's key set, and an overlay row would only add rows, not keys.
    //
    // `find` is the ONLY engine verb `getMetaItems` reaches (the rest of the
    // read goes through `engine.registry`, which is real here). Deliberately no
    // `findOne` double: it belongs to the single-item read this file never
    // drives, and a fake looser than `ObjectQL.findOne` is how a dead REST route
    // once shipped with its suite green — so the honest fixture omits the verb
    // rather than stubbing it. `check:engine-double-contract` enforces that.
    find: async () => [],
  };
  return new ObjectStackProtocolImplementation(engine as never, () => new Map());
}

type ProducerRow = Record<string, unknown> & { manifest?: { id?: unknown } };

/**
 * The keys of `row` that a RESPONSE can actually carry.
 *
 * `Object.keys` alone is the wrong instrument here and the difference is
 * measured, not theoretical: `SchemaRegistry.installPackage` seats the optional
 * record fields as own properties holding `undefined`, so a package installed
 * without settings still answers `'settings' in record === true`. Both doors
 * omit undefined-valued fields on purpose ("the bytes are unchanged for every
 * entry that already served fine"), and `JSON.stringify` would drop them
 * anyway — so a gate counting them would red on every package for a key no
 * consumer could ever have observed, and the first repair anyone reached for
 * would be to widen the exclusion register until the real signal was buried.
 *
 * What this gate is about is a key that HAS a value and does not reach the
 * wire. That is the near-miss (`writable: false` is a value), and it is what
 * this filter keeps in view.
 */
const definedKeys = (row: Record<string, unknown>): Set<string> =>
  new Set(Object.keys(row).filter((k) => row[k] !== undefined));

/** The row id, keyed the way both the producer and the door key it. */
function rowId(row: ProducerRow): string | undefined {
  const fromManifest = row?.manifest?.id;
  if (typeof fromManifest === 'string') return fromManifest;
  return typeof row.id === 'string' ? row.id : undefined;
}

/** MEASURE the producer's key set — never a literal. */
async function producerKeysOf(
  protocol: ObjectStackProtocolImplementation,
): Promise<Map<string, Set<string>>> {
  const res = await protocol.getMetaItems({ type: 'package' });
  const out = new Map<string, Set<string>>();
  for (const item of (res.items ?? []) as ProducerRow[]) {
    const id = rowId(item);
    if (id) out.set(id, definedKeys(item));
  }
  return out;
}

interface Captured { status: number; body: any }

/** A durable half that finds nothing, so only the registry half is exercised. */
const EMPTY_DB = { list: async () => [], get: async () => null };

function mount(protocol: ObjectStackProtocolImplementation) {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: () => {},
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  } as never;
  // The authorization gate (#7033 / #7023) is not this file's subject.
  registerPackageRoutes(server, (() => EMPTY_DB) as never, '/api/v1', {
    resolveExecutionContext: async () => ({
      userId: 'u_pkg', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    }),
    // The REAL producer, bound as the door's protocol seam.
    protocol: { getMetaItems: (req: never) => protocol.getMetaItems(req) },
  } as never);
  return routes;
}

async function drive(
  routes: Map<string, RouteHandler>,
  method: string,
  path: string,
  req: Record<string, unknown> = {},
): Promise<Captured> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`no handler for ${method} ${path}`);
  const captured: Captured = { status: 200, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as never,
    res,
  );
  return captured;
}

/**
 * THE DETECTOR. Shared in shape with the runtime twin: the keys a door drops
 * are `producer − served − excluded`, and a non-empty answer is the defect.
 *
 * Returns the dropped keys rather than asserting, so the caller can name the
 * row in the failure message — a bare "expected [] to equal ['writable']" does
 * not say which package or which door.
 */
function droppedKeys(
  producer: ReadonlySet<string>,
  served: ReadonlySet<string>,
  excluded: readonly string[],
): string[] {
  const exempt = new Set(excluded);
  return [...producer].filter((k) => !served.has(k) && !exempt.has(k)).sort();
}

describe('GATE: REST GET /packages carries every key the producer stamps', () => {
  it('control: the producer really does stamp keys the RECORD does not declare', async () => {
    // ANTI-VACUITY. If the producer stamped nothing beyond the stored record,
    // the coverage assertion below could pass over an allowlist that had never
    // been asked a hard question. `writable` (ADR-0070 D2) is the stamp the
    // near-miss was about, so its presence is what makes this gate load-bearing
    // — and its absence would mean the producer changed under us, which is a
    // decision, not a green.
    const registry = realRegistry();
    const perRow = await producerKeysOf(realProducer(registry));

    expect([...perRow.keys()].sort()).toEqual([DB_BASE, CODE_PROJECT, SYSTEM_SCOPED].sort());

    // Every declared slot on the record must be OBSERVABLE, or the coverage
    // assertion silently shrinks to whatever the fixture happened to populate.
    // Measured before `seatDeclaredFields` existed: 8 of 12 declared fields sat
    // at `undefined`, and deleting one of them from the allowlist left this
    // gate green. Stated as a property of the record — never as a count.
    const record = registry.getPackage(CODE_PROJECT) as unknown as Record<string, unknown>;
    const unobservable = Object.keys(record).filter((k) => record[k] === undefined);
    expect(unobservable, 'declared fields the fixture leaves unobservable').toEqual([]);

    const recordKeys = definedKeys(record);
    const stamped = [...perRow.get(CODE_PROJECT)!].filter((k) => !recordKeys.has(k));
    expect(stamped).toContain('writable');
  });

  it('every producer key survives to the wire, for every package', async () => {
    // THE GATE. Remove a stamped key from `REGISTRY_PACKAGE_RESPONSE_FIELDS` —
    // or land a new producer stamp without adding it — and this reds with the
    // key's own name, instead of shipping a 200 with the field absent.
    const registry = realRegistry();
    const protocol = realProducer(registry);
    const perRow = await producerKeysOf(protocol);

    const res = await drive(mount(protocol), 'GET', PKGS);
    expect(res.status).toBe(200);

    const served: ProducerRow[] = res.body?.data?.packages ?? [];
    expect(served.length).toBe(perRow.size);

    const routes = mount(protocol);
    const report: string[] = [];
    for (const [id, producerKeys] of perRow) {
      const row = served.find((p) => rowId(p) === id);
      expect(row, `package ${id} vanished from the response entirely`).toBeDefined();
      const dropped = droppedKeys(producerKeys, definedKeys(row as ProducerRow), DELIBERATELY_NOT_SERVED);
      if (dropped.length) report.push(`list ${id}: ${dropped.join(', ')}`);

      // The DETAIL door runs the same producer through the same projection, and
      // is the other place a dropped key would ship as a 200.
      const one = await drive(routes, 'GET', `${PKGS}/:id`, { params: { id } });
      expect(one.status, `GET ${PKGS}/${id}`).toBe(200);
      const detail = one.body?.data?.package as ProducerRow | undefined;
      expect(detail, `package ${id} vanished from the detail response`).toBeDefined();
      const detailDropped = droppedKeys(producerKeys, definedKeys(detail as ProducerRow), DELIBERATELY_NOT_SERVED);
      if (detailDropped.length) report.push(`detail ${id}: ${detailDropped.join(', ')}`);
    }

    // The failure text names the door, the package and the key, because the
    // reader of a red here is someone who just added a producer stamp and needs
    // to be told which allowlist to decide about.
    expect(
      report,
      'REST GET /packages dropped producer-stamped key(s). Either add them to '
      + '`REGISTRY_PACKAGE_RESPONSE_FIELDS` in package-routes.ts, or record the '
      + 'withholding in `DELIBERATELY_NOT_SERVED` in this file with the reason.',
    ).toEqual([]);
  });

  it('control: the detector reports a dropped key rather than passing vacuously', async () => {
    // Proves the assertion above can FAIL, without mutating source. The door is
    // real and so is the drop: an undeclared key on the producer's row is
    // exactly what the allowlist deletes, and the detector must say so.
    const registry = realRegistry();
    const protocol = realProducer(registry);
    const real = await producerKeysOf(protocol);

    const res = await drive(mount(protocol), 'GET', PKGS);
    const row = (res.body?.data?.packages ?? []).find((p: ProducerRow) => rowId(p) === CODE_PROJECT);
    const servedKeys = definedKeys(row as ProducerRow);

    // A hypothetical next verdict, stamped by the producer and not yet decided
    // about at this door.
    const withNextStamp = new Set([...real.get(CODE_PROJECT)!, 'nextVerdict']);
    expect(droppedKeys(withNextStamp, servedKeys, DELIBERATELY_NOT_SERVED)).toEqual(['nextVerdict']);
    // …and the exclusion register is the one way to make that green again.
    expect(droppedKeys(withNextStamp, servedKeys, ['nextVerdict'])).toEqual([]);
  });

  it('the projection still drops an undeclared LIVE member — the gate does not undo it', async () => {
    // The coverage assertion is one-directional (⊇), on purpose: this door must
    // keep degrading an unserializable member to a missing field. A gate written
    // as set EQUALITY would have forced that member back onto the wire and
    // re-opened the 500.
    const registry = realRegistry();
    (registry.getPackage(CODE_PROJECT) as Record<string, unknown>).liveEngineHandle = cyclicEngine();

    const res = await drive(mount(realProducer(registry)), 'GET', PKGS);
    expect(res.status).toBe(200);
    expect(() => JSON.stringify(res.body)).not.toThrow();
    const served: ProducerRow[] = res.body?.data?.packages ?? [];
    expect(served.some((p) => 'liveEngineHandle' in p)).toBe(false);
  });
});

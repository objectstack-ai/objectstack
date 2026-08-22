// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The introspected remote primary key: absent from the definition, present as
 * a comment in the rendered source.
 *
 * ## The defect this pins closed (#11000)
 *
 * `generateObjectDraft` emitted `fields.<f>.primaryKey: true` and
 * `renderObjectSource` rendered `, primaryKey: true` onto the field line.
 * `primaryKey` is **not a key of the spec field schema**, so the generator had
 * a pinned path producing a draft the platform's own toolchain refused on both
 * instruments the rendered file is annotated for:
 *
 *  - `tsc --noEmit` against `ServiceObject` — `TS2353: Object literal may only
 *    specify known properties, and 'primaryKey' does not exist in type …`;
 *  - `ObjectSchema.safeParse` — `unrecognized_keys` at `["fields","<f>"]`.
 *
 * ## The ruling
 *
 * Maintainer, 2026-08-22 live session (「同意所有」, item 8) — **D**:
 * stop emitting the key; the introspected key survives **as a comment** in the
 * generated source (information preserved for the reader, zero contract face).
 * The alternative of an authorable spelling on the binding
 * (`external.primaryKey: string[]`) is **deferred, not rejected** — it returns
 * as its own `packages/spec` card when federated upsert has a live runtime
 * consumer.
 *
 * ## Why FOUR directions and not one
 *
 * "The draft parses now" is satisfiable by an implementation that simply drops
 * `opts.primaryKey` on the floor — it would go green on a parse-only suite
 * while discarding exactly what the ruling said to preserve. So the
 * information-preservation direction is pinned as its own case, and is the one
 * that reddens under ablation of the comment renderer.
 *
 * ## The instruments
 *
 * `ObjectSchema.safeParse` is asserted in full (`success === true`), not merely
 * "no `unrecognized_keys`": what the field-drop has to buy is the whole
 * definition's verdict, and #11059's `sharingModel` repair is part of that same
 * verdict. The `tsc --noEmit` half of the acceptance runs against the built
 * artifact in the PR's harness rather than in-process here — this file imports
 * the service through a RELATIVE specifier (`../external-datasource-service.js`),
 * which cannot route through the package's `exports`, so these cases measure
 * `src/` and are correct without a build.
 */

import { describe, it, expect } from 'vitest';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import { ObjectSchema } from '@objectstack/spec/data';
import {
  ExternalDatasourceService,
  type DatasourceLike,
} from '../external-datasource-service.js';

/**
 * A remote schema with three shapes of key in one fixture: a single-column key
 * (`orders.order_id`), a COMPOSITE key (`order_lines.order_id + line_no`) and a
 * table with NO key at all (`events`).
 *
 * The composite table spells BOTH members `primaryKey: true`. That is what a
 * complete introspection reports; #10997 (SQLite returns only the first column
 * of a composite key) is a separate, unfixed defect in the engine lane, and
 * pinning this generator against the truncated shape would bake that defect in
 * as if it were the contract. What this file does owe #10997 is that the
 * rendered comment must not CLAIM completeness — asserted below.
 */
function remoteSchema(): IntrospectedSchema {
  return {
    dialect: 'postgres',
    introspectedAt: '2026-08-22T00:00:00.000Z',
    tables: {
      'mart.orders': {
        name: 'mart.orders',
        indexes: [],
        columns: [
          { name: 'order_id', type: 'text', nullable: false, primaryKey: true },
          { name: 'amount', type: 'numeric(10,2)', nullable: true, primaryKey: false },
        ],
      },
      'mart.order_lines': {
        name: 'mart.order_lines',
        indexes: [],
        columns: [
          { name: 'order_id', type: 'text', nullable: false, primaryKey: true },
          { name: 'line_no', type: 'integer', nullable: false, primaryKey: true },
          { name: 'sku', type: 'text', nullable: true, primaryKey: false },
        ],
      },
      'mart.events': {
        name: 'mart.events',
        indexes: [],
        columns: [
          { name: 'payload', type: 'jsonb', nullable: true, primaryKey: false },
          { name: 'at', type: 'timestamptz', nullable: true, primaryKey: false },
        ],
      },
    },
  };
}

function svc(): ExternalDatasourceService {
  return new ExternalDatasourceService({
    introspect: async () => remoteSchema(),
    getDatasource: async (name): Promise<DatasourceLike> => ({ name, schemaMode: 'external' }),
    getObject: async () => undefined,
    listObjects: async () => [],
    getNamespace: () => 'wh',
  });
}

/** Every field record in a draft definition, flattened for key inspection. */
function fieldRecords(draft: { definition: Record<string, unknown> }): Array<[string, object]> {
  return Object.entries(draft.definition.fields as Record<string, object>);
}

describe('direction 1 — the unauthorable key is ABSENT from the definition', () => {
  it('drops it on the option-supplied path', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'orders', {
      primaryKey: ['order_id'],
    });

    for (const [name, record] of fieldRecords(draft)) {
      expect(Object.keys(record), `field '${name}'`).toEqual(['type']);
    }
    // Spelled twice on purpose: the loop above forbids ANY extra key, this
    // line names the one the defect was about, so a regression reports it.
    expect(JSON.stringify(draft.definition)).not.toContain('primaryKey');
  });

  it('drops it on the introspection-supplied path', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'orders');

    const fields = draft.definition.fields as Record<string, object>;
    expect(Object.keys(fields.order_id)).toEqual(['type']);
    expect(JSON.stringify(draft.definition)).not.toContain('primaryKey');
  });

  it('renders no `primaryKey:` onto the field LINE either', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'orders', {
      primaryKey: ['order_id'],
    });
    expect(draft.source).toContain("order_id: { type: 'text' },");
    expect(draft.source).not.toContain('primaryKey: true');
  });
});

describe('direction 2 — the draft PARSES, which it could not before', () => {
  it('accepts the whole definition on the key-set path', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'orders', {
      primaryKey: ['order_id'],
    });

    const parsed = ObjectSchema.safeParse(draft.definition);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
  });

  it('accepts it on the composite-key path too', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'order_lines', {
      primaryKey: ['order_id', 'line_no'],
    });
    const parsed = ObjectSchema.safeParse(draft.definition);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
  });

  it('POSITIVE CONTROL — the same definition with the key put BACK is refused', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'orders', {
      primaryKey: ['order_id'],
    });
    const fields = draft.definition.fields as Record<string, Record<string, unknown>>;
    const poisoned = {
      ...draft.definition,
      fields: { ...fields, order_id: { ...fields.order_id, primaryKey: true } },
    };

    const parsed = ObjectSchema.safeParse(poisoned);
    expect(parsed.success).toBe(false);
    // The instrument is live and refusing for THE reason #11000 measured, not
    // for some incidental one. Without this, the green above could be a schema
    // that stopped refusing anything at all.
    expect(JSON.stringify((parsed as { error: unknown }).error)).toContain('unrecognized_keys');
  });
});

describe('direction 3 — the information is PRESERVED as a comment (load-bearing)', () => {
  it('names the single key column', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'orders', {
      primaryKey: ['order_id'],
    });
    expect(draft.source).toContain('// Remote primary key: order_id');
  });

  it('names EVERY member of a composite key, in order', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'order_lines', {
      primaryKey: ['order_id', 'line_no'],
    });
    expect(draft.source).toContain('// Remote primary key: order_id, line_no');
  });

  it('names the field name, not the remote column, when the field was renamed', async () => {
    // The comment sits directly above the `fields:` block, so it has to speak
    // that block's vocabulary — otherwise it points at a line that is not there.
    const draft = await svc().generateObjectDraft('warehouse', 'orders', {
      primaryKey: ['order_id'],
      rename: { order_id: 'remote_order_id' },
    });
    expect(draft.source).toContain('// Remote primary key: remote_order_id');
  });

  it('does NOT overclaim completeness — #10997 is unfixed and in another lane', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'order_lines', {
      primaryKey: ['order_id', 'line_no'],
    });
    // The caveat, not merely "some comment exists": a reader who trusts this
    // list as the complete key can be wrong today, through no fault of this
    // generator, and the file has to say so.
    expect(draft.source).toContain('#10997');
    expect(draft.source).toContain('lower bound');
  });

  it('says WHY the key is a comment rather than a field key', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'orders', {
      primaryKey: ['order_id'],
    });
    // A bare column list would read as an oversight to the next person to touch
    // this generator — exactly the shape that put the key on the field in the
    // first place.
    expect(draft.source).toContain('#11000');
    expect(draft.source).toContain('no authorable key');
  });

  it('emits NO comment at all when no key was reported', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'events');
    expect(draft.source).not.toContain('Remote primary key');
    // …and the keyless draft is still a valid one.
    expect(ObjectSchema.safeParse(draft.definition).success).toBe(true);
  });

  it('the comment survives INTO the source only — never into the definition', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'orders', {
      primaryKey: ['order_id'],
    });
    expect(JSON.stringify(draft.definition)).not.toContain('Remote primary key');
  });
});

describe('direction 4 — the `opts.primaryKey`-UNSET path is unchanged from #11059', () => {
  it('still builds, still carries the namespace prefix and the declared OWD', async () => {
    const draft = await svc().generateObjectDraft('warehouse', 'orders');

    expect(draft.name).toBe('wh_orders');
    expect(draft.definition.sharingModel).toBe('private');
    expect(ObjectSchema.safeParse(draft.definition).success).toBe(true);
  });

  it('reports the introspected key in the comment without being asked', async () => {
    // `opts.primaryKey` unset → the key comes from `col.primaryKey`. Pinned so
    // that the fix cannot be read as "the option is ignored now".
    const draft = await svc().generateObjectDraft('warehouse', 'orders');
    expect(draft.source).toContain('// Remote primary key: order_id');
  });
});

describe('importObject persists the parseable definition', () => {
  it('never writes the unauthorable key into the metadata store', async () => {
    const persisted: Array<{ name: string; def: Record<string, unknown> }> = [];
    const service = new ExternalDatasourceService({
      introspect: async () => remoteSchema(),
      getDatasource: async (name): Promise<DatasourceLike> => ({ name, schemaMode: 'external' }),
      getObject: async () => undefined,
      listObjects: async () => [],
      getNamespace: () => 'wh',
      persistObject: async (name, def) => {
        persisted.push({ name, def });
      },
    });

    await service.importObject('warehouse', 'orders', { primaryKey: ['order_id'] });

    expect(persisted).toHaveLength(1);
    expect(JSON.stringify(persisted[0]?.def)).not.toContain('primaryKey');
    expect(ObjectSchema.safeParse(persisted[0]?.def).success).toBe(true);
  });
});

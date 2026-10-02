// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21334, ADR-0005, ADR-0126] A runtime view container with a bare `list`,
// saved for an object another package ships, must not replace that package's
// `<object>.default` on the object door — over the real showcase composition,
// through the REST doors, following the card's own steps.
//
// ## What was broken
//
// The spec names a bare `list` `<object>.default`. A container saved under any
// other name (here `os_qa_shadow_probe`, in a Studio-created package, and
// `os_qa_shadow_probe2`, in none) for `showcase_task` expanded there, and the
// list read set the expansion by name over the merged items. The object door
// then answered `showcase_task.default` with the probe's two columns, still
// stamped `_packageId: com.example.showcase`. On the standalone stack (an
// environment-scoped kernel) the by-name read kept the packaged item, so the
// two doors disagreed; on this harness's unscoped kernel the registry's bare
// key carried the shadow too, so both doors served it, and it outlived the
// container's own delete.
//
// ## The ruling these cases pin (triage's)
//
// The expansion of a bare `list` never produces a name another package owns:
// on another package's object it expands under the container's own name —
// `<object>.<container name>`, the spec's qualified ViewItem spelling. The two
// doors answer the same row for `<object>.default`: the packaged one,
// unchanged. Controls: the sanctioned override, a write to
// `showcase_task.default` by name, still reaches both doors.
//
// The same-package control (a container of the object's own package still
// expands to `<object>.default`) and the environment-scoped topology are pinned
// in-process, in `packages/metadata-protocol/src/view-container-runtime-expansion.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const OBJECT = 'showcase_task';
const DEFAULT = `${OBJECT}.default`;
const SHOWCASE = 'com.example.showcase';
const REPAIR = 'com.example.repairassets';
const PROBE_COLUMNS = ['title', 'status'];
const probe = (name: string) => ({ name, object: OBJECT, list: { type: 'grid', columns: PROBE_COLUMNS } });

interface ViewRow {
  name: string;
  label?: unknown;
  isDefault?: boolean;
  _packageId?: string;
  _provenance?: string;
  config?: { columns?: unknown[] };
  list?: unknown;
}

describe('dogfood: a bare-list container on another package\'s object leaves its <object>.default alone (#21334)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** `GET /api/v1/meta/view?object=showcase_task` — the object door. */
  const objectDoor = async (): Promise<ViewRow[]> => {
    const res = await stack.apiAs(token, 'GET', `/meta/view?object=${OBJECT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items?: ViewRow[] } | ViewRow[];
    return Array.isArray(body) ? body : (body.items ?? []);
  };
  /** `GET /api/v1/meta/view/:name` — the by-name read. */
  const byName = async (name: string): Promise<ViewRow> => {
    const res = await stack.apiAs(token, 'GET', `/meta/view/${name}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item?: ViewRow } & ViewRow;
    return body.item ?? body;
  };
  const named = (rows: ViewRow[], name: string) => rows.filter((r) => r.name === name);

  /** The packaged default, as the showcase ships it (`src/ui/views/task.view.ts`). */
  const expectPackagedDefault = (row: ViewRow | undefined) => {
    expect(row?.label).toBe('All Tasks');
    expect(row?.config?.columns).toHaveLength(7);
    expect(row?._packageId).toBe(SHOWCASE);
    expect(row?.isDefault).toBe(true);
  };
  /** Both doors answer exactly one, packaged, identical `showcase_task.default`. */
  const expectDefaultUnchangedOnBothDoors = async () => {
    const listed = named(await objectDoor(), DEFAULT);
    expect(listed, 'exactly one item answers showcase_task.default on the object door').toHaveLength(1);
    expectPackagedDefault(listed[0]);
    const read = await byName(DEFAULT);
    expectPackagedDefault(read);
    expect({ label: read.label, config: read.config, _packageId: read._packageId })
      .toEqual({ label: listed[0].label, config: listed[0].config, _packageId: listed[0]._packageId });
  };

  it('steps 1–7: a container saved into another package never replaces the packaged default, on either door', async () => {
    // 1. Baseline.
    await expectDefaultUnchangedOnBothDoors();

    // 2. A Studio-created package to author into.
    const created = await stack.apiAs(token, 'POST', '/packages', {
      manifest: { id: REPAIR, name: 'Repair assets', version: '0.1.0', type: 'app', namespace: 'repair' },
    });
    expect(created.status).toBe(201);

    // 3. The card's probe, a bare-list container for showcase_task, as a draft.
    const saved = await stack.apiAs(
      token, 'PUT', `/meta/view/os_qa_shadow_probe?mode=draft&package=${REPAIR}`, probe('os_qa_shadow_probe'),
    );
    expect(saved.status).toBe(200);

    // 4. Publish it.
    const published = await stack.apiAs(token, 'POST', `/packages/${REPAIR}/publish-drafts`, {});
    expect(published.status).toBe(200);
    const receipt = (await published.json()) as { data?: { outcome?: string; publishedCount?: number } };
    expect(receipt.data?.outcome).toBe('published');
    expect(receipt.data?.publishedCount).toBe(1);

    // 5 + 6. The packaged default is unchanged on BOTH doors, and they answer
    // the same row; the probe's own view is served under its own name.
    await expectDefaultUnchangedOnBothDoors();
    const own = named(await objectDoor(), `${OBJECT}.os_qa_shadow_probe`);
    expect(own).toHaveLength(1);
    expect(own[0].config?.columns).toEqual(PROBE_COLUMNS);
    expect(own[0]._packageId).toBe(REPAIR);
    expect(own[0]._provenance).not.toBe('package');
    // The by-name read answers the container's own name with its row.
    expect((await byName('os_qa_shadow_probe')).list).toEqual(probe('os_qa_shadow_probe').list);

    // 7. Delete the probe: the packaged default is still what both doors answer.
    const deleted = await stack.apiAs(token, 'DELETE', `/meta/view/os_qa_shadow_probe?package=${REPAIR}`);
    expect(deleted.status).toBe(200);
    await expectDefaultUnchangedOnBothDoors();
  });

  it('step 8: the same with no package — a package-less container leaves the packaged default alone', async () => {
    const saved = await stack.apiAs(token, 'PUT', '/meta/view/os_qa_shadow_probe2', probe('os_qa_shadow_probe2'));
    expect(saved.status).toBe(200);

    await expectDefaultUnchangedOnBothDoors();
    const own = named(await objectDoor(), `${OBJECT}.os_qa_shadow_probe2`);
    expect(own).toHaveLength(1);
    expect(own[0].config?.columns).toEqual(PROBE_COLUMNS);
    expect(own[0]._packageId, 'a package-less container lends its view no package').toBeUndefined();

    const deleted = await stack.apiAs(token, 'DELETE', '/meta/view/os_qa_shadow_probe2');
    expect(deleted.status).toBe(200);
    await expectDefaultUnchangedOnBothDoors();
  });

  it('step 9 (control): the sanctioned override — a write to showcase_task.default by name — reaches both doors', async () => {
    const saved = await stack.apiAs(token, 'PUT', `/meta/view/${DEFAULT}`, {
      name: DEFAULT,
      object: OBJECT,
      viewKind: 'list',
      label: 'Overridden',
      config: { type: 'grid', columns: [{ field: 'title' }] },
    });
    expect(saved.status).toBe(200);

    const listed = named(await objectDoor(), DEFAULT);
    expect(listed).toHaveLength(1);
    expect(listed[0].label).toBe('Overridden');
    const read = await byName(DEFAULT);
    expect(read.label).toBe('Overridden');
    expect(read.config).toEqual(listed[0].config);
  });
});

/**
 * [#10729] `contributes.kinds` — the registration site's debug line must name
 * fields that EXIST.
 *
 * `registerApp()` logs one `'Registered Kind'` line per contributed kind. It
 * used to read `kind.name || kind.type`, and `contributes.kinds` items declare
 * neither: the schema (`packages/spec/src/kernel/manifest.zod.ts`) says
 * `{ id, globs, description? }` and `SchemaRegistry.registerKind` types its
 * parameter `{ id: string, globs: string[] }`. So the line evaluated
 * `undefined || undefined` and logged `kind: undefined` for every conforming
 * manifest — a defect with no failing test anywhere, because a debug field
 * that silently goes `undefined` is invisible to everything except a human
 * reading the log at the moment it matters.
 *
 * That is the whole reason this file exists. The fix is two tokens wide; the
 * pin is the part that keeps it fixed.
 *
 * Why `id` and not something else: `registerKind` stores the descriptor with
 * `registerItem('kind', kind, 'id')`, so `id` is simultaneously (a) the only
 * identifying field the schema declares and (b) the exact key the item is
 * filed under — which makes the log line and the registry answer the same
 * question the same way. The second test pins the direction as well as the
 * value: an off-spec manifest that DOES carry `name`/`type` must still be
 * logged by `id`, because reading an undeclared alias in a consumer is the
 * tolerance Prime Directive #12 rejects.
 *
 * Real engine, real `SchemaRegistry` — no doubles. The assertion is about
 * what the registration seam actually does with a manifest, so a mocked
 * registry would be asserting on the mock.
 */
import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine';

interface DebugLine { msg: string; meta: Record<string, unknown> | undefined }

function engineWithRecordedDebug(): { engine: ObjectQL; lines: DebugLine[] } {
  const lines: DebugLine[] = [];
  const logger = {
    debug: (msg: string, meta?: Record<string, unknown>) => { lines.push({ msg, meta }); },
    info() {}, warn() {}, error() {},
  };
  return { engine: new ObjectQL({ logger } as any), lines };
}

const registeredKindLines = (lines: DebugLine[]): DebugLine[] =>
  lines.filter((l) => l.msg === 'Registered Kind');

describe('[#10729] contributes.kinds registration logging', () => {
  it('names a conforming kind by its declared `id`, not by undeclared fields', () => {
    const { engine, lines } = engineWithRecordedDebug();

    engine.registerApp({
      id: 'com.example.bi',
      contributes: {
        // Exactly the schema's shape — and exactly its own documented example
        // ("Registering a BI plugin to handle *.report.ts").
        kinds: [{ id: 'sys.bi.report', globs: ['**/*.report.ts'] }],
      },
    });

    const logged = registeredKindLines(lines);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.meta).toEqual({ kind: 'sys.bi.report', from: 'com.example.bi' });

    // The regression this pins is specifically `undefined`, so say so: a
    // future edit that reintroduces an undeclared read fails HERE with a
    // readable message rather than at the deep-equal above.
    expect(logged[0]!.meta!.kind).toBeDefined();
  });

  it('logs the same key the registry files the descriptor under', () => {
    const { engine, lines } = engineWithRecordedDebug();

    engine.registerApp({
      id: 'com.example.bi',
      contributes: { kinds: [{ id: 'sys.bi.report', globs: ['**/*.report.ts'] }] },
    });

    // `registerKind` → `registerItem('kind', kind, 'id')`. The value in the log
    // is only useful if it is the value you can look the item back up by, so
    // assert the round trip rather than the string twice.
    const stored = engine.registry.listItems<{ id: string }>('kind');
    expect(stored.map((k) => k.id)).toContain(registeredKindLines(lines)[0]!.meta!.kind);
  });

  it('still logs `id` when an off-spec manifest carries `name`/`type`', () => {
    const { engine, lines } = engineWithRecordedDebug();

    engine.registerApp({
      id: 'com.legacy.bi',
      contributes: {
        kinds: [{
          id: 'sys.bi.report',
          globs: ['**/*.report.ts'],
          // Neither key is declared by the schema. They are what the old line
          // reached for, so an author who copied an ancient example could put
          // them here — and the log must NOT start preferring them again.
          name: 'Report (undeclared)',
          type: 'report (undeclared)',
        }],
      },
    });

    const logged = registeredKindLines(lines);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.meta).toEqual({ kind: 'sys.bi.report', from: 'com.legacy.bi' });
  });
});

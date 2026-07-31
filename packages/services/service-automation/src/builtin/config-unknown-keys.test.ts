// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unknown flow-node `config` keys are REJECTED at registration (#4277 — the
 * error half of the #4045 unknown-key ladder; #4059 shipped the warn half).
 *
 * `FlowNodeSchema.config` is `z.record(z.unknown())`, so before #4059 a
 * misspelled or invented config key was accepted in **total silence**:
 * `visibleIf` instead of `visibleWhen` registered cleanly, was never read, and
 * the only symptom was a feature that quietly did not happen. That is the
 * diagnostic vacuum that made #3528 take three passes and two wrong diagnoses.
 *
 * #4059 turned that into a warning while the #4045 reconciliation closed the
 * read-but-undeclared population; #4277 tightens it into a rejection. These
 * tests pin both halves of the tightened behavior: registration THROWS with an
 * actionable prescription (path, declared set, did-you-mean, per-key
 * tombstones), AND the deliberate exemptions still register — `assignment`
 * (author-named keys), keyValue-map keys (author data), schemaless types
 * (nothing declared ⇒ nothing undeclared).
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function recordingLogger() {
  const warnings: string[] = [];
  const logger: any = {
    info() {}, error() {}, debug() {},
    warn(msg: string) { warnings.push(msg); },
    child() { return logger; },
  };
  return { logger, warnings };
}

function engineWith(logger: any) {
  const engine = new AutomationEngine(logger);
  installBuiltinNodes(engine, { logger, getService() { throw new Error('none'); } } as any);
  return engine;
}

/** A one-node flow carrying `config` verbatim on a node of `type`. */
function flowWith(type: string, config: Record<string, unknown>) {
  return {
    name: 'f', label: 'F', type: 'screen', status: 'active', version: 1,
    nodes: [
      { id: 'start', type: 'start', label: 'S', config: {} },
      { id: 'n1', type, label: 'N', config },
      { id: 'end', type: 'end', label: 'E' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'n1', type: 'default' },
      { id: 'e2', source: 'n1', target: 'end', type: 'default' },
    ],
  };
}

/** Register and return the rejection message (fails the test if it registers). */
function rejectionOf(engine: AutomationEngine, type: string, config: Record<string, unknown>): string {
  try {
    engine.registerFlow('f', flowWith(type, config));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`flow with ${type} config ${JSON.stringify(config)} should have been rejected`);
}

describe('unknown node config keys are rejected (#4277)', () => {
  it('rejects a misspelled key inside the field repeater, locating the exact element', async () => {
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    // The typo lives INSIDE the field repeater — where the real #3528 one did.
    const msg = rejectionOf(engine, 'screen', {
      fields: [{ name: 'opportunityName', required: true, visibleIf: 'createOpportunity == true' }],
    });

    expect(msg).toContain("node 'n1'");
    expect(msg).toContain('(screen)');
    // Located to the exact element, so the author knows WHICH field.
    expect(msg).toContain('config.fields[0].visibleIf');
    // The load-bearing half for an agent author: the correct key is named. Note
    // it comes from the DECLARED SET, not the suggestion — `visibleIf` →
    // `visibleWhen` is edit-distance 4 against `nearestName`'s threshold of 3,
    // so this exact typo gets no did-you-mean. Printing the declared set is
    // what makes the diagnostic actionable regardless.
    expect(msg).toContain(
      'Declared here: name, label, type, required, options, defaultValue, placeholder, visibleWhen.',
    );
    // …and this particular key has a documented incident, so it also carries
    // its tombstone (the UNKNOWN_KEY_GUIDANCE pattern).
    expect(msg).toContain('visibleWhen');
    expect(msg).toContain('#3528');
    // The flow is NOT registered.
    await expect(engine.getFlow('f')).resolves.toBeNull();
  });

  it('adds a did-you-mean when the typo IS within edit distance', () => {
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    const msg = rejectionOf(engine, 'screen', { titl: 'Details' });
    expect(msg).toContain('did you mean `title`?');
    // …and still lists the declared set alongside it.
    expect(msg).toContain('Declared here:');
  });

  it('carries the fieldValues → fields tombstone on the CRUD write map', () => {
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    const msg = rejectionOf(engine, 'create_record', {
      objectName: 'crm_lead',
      fieldValues: { name: 'x' },
    });
    expect(msg).toContain('unknown config key `fieldValues`');
    // The tombstone names the mechanism, not just the nearest key.
    expect(msg).toContain('The write map is `fields`');
  });

  it('reports every undeclared key in ONE rejection, not just the first', () => {
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    const msg = rejectionOf(engine, 'screen', { hideWhen: 'x', submitLabel: 'Go' });
    expect(msg).toContain('hideWhen');
    expect(msg).toContain('submitLabel');
    expect(msg).toContain('2 undeclared config key(s)');
  });

  it('the rejection carries the declare-it prescription for genuinely-read keys', () => {
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    const msg = rejectionOf(engine, 'screen', { totallyMadeUp: 42 });
    expect(msg).not.toContain('did you mean');
    // The way OUT for a custom executor whose schema lags its reads.
    expect(msg).toContain("declare it on the node type's descriptor configSchema");
  });

  it('registers a fully declared config without complaint', async () => {
    const { logger, warnings } = recordingLogger();
    const engine = engineWith(logger);

    engine.registerFlow('f', flowWith('screen', {
      title: 'Details',
      fields: [{ name: 'a', type: 'boolean', required: true, visibleWhen: 'b == true' }],
      waitForInput: true,
      defaults: { x: 1 },
    }));

    await expect(engine.getFlow('f')).resolves.toBeDefined();
    expect(warnings.filter((w) => w.includes('unknown config key'))).toEqual([]);
  });

  it('assignment is exempt WHOLESALE — its top-level keys are author variable names', async () => {
    // Pinned as un-reconcilable by the form↔Zod ledger: with no `assignments`
    // wrapper, the top-level config keys ARE the variables being assigned, so
    // no fixed key set can describe them and the tightened check must not try.
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    expect(() => engine.registerFlow('f', flowWith('assignment', {
      approvalStatus: 'pending',
      anyVariableNameAtAll: '{record.owner}',
    }))).not.toThrow();
    await expect(engine.getFlow('f')).resolves.toBeDefined();
  });

  it('stays quiet for a node type that publishes no configSchema', () => {
    // `decision` / `script` are deliberately schemaless (config-schemas.test.ts):
    // nothing is declared, so nothing can be undeclared.
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    expect(() => engine.registerFlow('f', flowWith('decision', { condition: 'a == b', whateverElse: 1 })))
      .not.toThrow();
  });

  it('does not flag the keys of a keyValue map — those are author data', () => {
    // The walk descends where the schema declares structure and STOPS at a
    // free-form map: `filter: { status: 'stale' }` keys are data, not config keys.
    const { logger } = recordingLogger();
    const engine = engineWith(logger);

    expect(() => engine.registerFlow('f', flowWith('get_record', {
      objectName: 'crm_lead',
      filter: { status: 'stale', anythingAtAll: true },
    }))).not.toThrow();
  });
});

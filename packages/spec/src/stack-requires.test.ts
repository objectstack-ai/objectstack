import { describe, expect, it } from 'vitest';
import { defineStack } from './stack.zod';

// framework#3265/#3308 — defineStack validates `requires` tokens against the
// platform capability vocabulary at the PRODUCER (authoring time): an unknown
// token is a hard error (no runtime provides it → declared ≠ enforced). The
// deprecated `aiStudio`/`aiSeat` aliases were removed in #3308, so those now
// reject like any other typo — there is no canonicalization step left.

describe('defineStack requires validation (#3265/#3308)', () => {
  it('canonical declarations pass through untouched', () => {
    const stack = defineStack({ requires: ['ai', 'ai-studio', 'ai-seat', 'hierarchy-security', 'governance'] });
    expect(stack.requires).toEqual(['ai', 'ai-studio', 'ai-seat', 'hierarchy-security', 'governance']);
  });

  it('THROWS on an unknown token (a typo no runtime provides), naming it', () => {
    expect(() => defineStack({ requires: ['automations'] })).toThrowError(
      /capability validation failed[\s\S]*'automations' is not a known platform capability/,
    );
  });

  it('the removed camelCase aliases now REJECT like any other unknown token (#3308)', () => {
    expect(() => defineStack({ requires: ['aiStudio'] })).toThrowError(
      /'aiStudio' is not a known platform capability/,
    );
    expect(() => defineStack({ requires: ['aiSeat'] })).toThrowError(
      /'aiSeat' is not a known platform capability/,
    );
  });

  it('reports every distinct unknown token but not known ones', () => {
    let msg = '';
    try {
      defineStack({ requires: ['ai', 'automations', 'analytiks', 'ai'] });
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain("'automations'");
    expect(msg).toContain("'analytiks'");
    expect(msg).toContain('(2 issues)');
    expect(msg).not.toContain("'ai' is not"); // known token isn't flagged
  });

  it('non-strict mode skips validation by contract (unknown token passes through)', () => {
    const stack = defineStack({ requires: ['aiStudio'] }, { strict: false });
    expect(stack.requires).toEqual(['aiStudio']);
  });
});

// #14153 — `defineStack` refuses an auto-launched flow (record_change /
// schedule / time_relative / api) whose stack does not declare
// `requires: ['triggers']`, the one token that installs those triggers. The
// sibling `validateHierarchyScopeCapability` already hard-errors the same
// declared-capability class for hierarchy scopes (which fail CLOSED); this one
// covers the class that fails SILENT — the flow registers, validates, builds,
// and never fires. The refusal reuses the automation engine's boot-audit
// wording (flow name, resolved trigger kind, the exact remedy).

describe('defineStack trigger capability validation (#14153)', () => {
  const node = (id: string, type: string, config?: Record<string, unknown>) => ({
    id,
    type,
    label: id,
    ...(config ? { config } : {}),
  });
  const flow = (name: string, type: string, config?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    type,
    nodes: [node('start', 'start', config), node('end', 'end')],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    ...extra,
  });
  const task = { name: 'task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } };
  const recordFlow = (name = 'task_fanout') =>
    flow(name, 'record_change', { objectName: 'task', triggerType: 'record-after-create' });
  const build = (stack: Record<string, unknown>) => defineStack(stack as never);
  const messageOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return '';
  };

  it('THROWS on a record_change flow when `requires` omits triggers — naming the flow, the kind and the remedy', () => {
    const msg = messageOf(() => build({ requires: ['automation'], objects: [task], flows: [recordFlow()] }));
    expect(msg).toMatch(/^defineStack trigger capability validation failed \(1 issue\):/);
    expect(msg).toContain("✗ flow 'task_fanout' declares a 'record_change' trigger but `requires` does not include 'triggers'");
    expect(msg).toContain("no 'record_change' trigger would be registered, so the flow would never auto-launch");
    expect(msg).toContain("Add requires: ['triggers'] (record_change/schedule/time_relative/api ship in @objectstack/trigger-*)");
  });

  it('refuses schedule, time_relative and api flows too, each named by its RESOLVED kind', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['schedule', flow('daily_digest', 'schedule', { schedule: '0 8 * * *' })],
      ['schedule', flow('bare_schedule', 'schedule')],
      ['time_relative', flow('renewal_alert', 'schedule', {
        timeRelative: { object: 'task', dateField: 'due_date', withinDays: 7 },
      })],
      ['api', flow('inbound_hook', 'api')],
      ['api', flow('inbound_token', 'autolaunched', { triggerType: 'api' })],
    ];
    for (const [kind, f] of cases) {
      const msg = messageOf(() => build({ requires: ['automation'], objects: [task], flows: [f] }));
      expect(msg, `${f.name} should be refused as '${kind}'`).toContain(`flow '${f.name}' declares a '${kind}' trigger`);
    }
  });

  it('a start node carrying BOTH a timeRelative descriptor and a schedule cadence is named a time_relative sweep', () => {
    const f = flow('sweep', 'schedule', {
      timeRelative: { object: 'task', dateField: 'due_date', withinDays: 7 },
      schedule: '0 8 * * *',
    });
    const msg = messageOf(() => build({ requires: ['automation'], objects: [task], flows: [f] }));
    expect(msg).toContain("flow 'sweep' declares a 'time_relative' trigger");
    expect(msg).not.toContain("declares a 'schedule' trigger");
  });

  it('passes untouched when `requires` includes triggers', () => {
    const stack = build({ requires: ['automation', 'triggers'], objects: [task], flows: [recordFlow()] });
    expect(stack.requires).toEqual(['automation', 'triggers']);
    expect(stack.flows?.map((f) => f.name)).toEqual(['task_fanout']);
  });

  it('screen flows and autolaunched-by-hand flows owe no capability', () => {
    const screen = flow('wizard', 'screen', undefined, {
      nodes: [node('start', 'start'), node('s1', 'screen', { fields: [] }), node('end', 'end')],
      edges: [
        { id: 'e1', source: 'start', target: 's1' },
        { id: 'e2', source: 's1', target: 'end' },
      ],
    });
    const manual = flow('by_hand', 'autolaunched', { objectName: 'task' });
    expect(() => build({ requires: ['automation'], objects: [task], flows: [screen, manual] })).not.toThrow();
  });

  it('a stack with no flows passes with `requires` omitted entirely', () => {
    expect(() => build({ objects: [task] })).not.toThrow();
    expect(() => build({ objects: [task], flows: [] })).not.toThrow();
  });

  it('an ABSENT `requires` counts as omitting the token — the CLI reads it as [] and nothing installs a trigger', () => {
    const msg = messageOf(() => build({ objects: [task], flows: [recordFlow()] }));
    expect(msg).toMatch(/^defineStack trigger capability validation failed \(1 issue\):/);
    expect(msg).toContain("flow 'task_fanout' declares a 'record_change' trigger");
  });

  it('obsolete / invalid flows are skipped, exactly as the boot audit skips them (the engine never binds them)', () => {
    expect(() => build({
      requires: ['automation'],
      objects: [task],
      flows: [
        flow('retired', 'record_change', { objectName: 'task', triggerType: 'record-after-create' }, { status: 'obsolete' }),
        flow('broken', 'schedule', { schedule: '0 8 * * *' }, { status: 'invalid' }),
      ],
    })).not.toThrow();
    // …while `draft` (the default) and `active` are both armed by the engine.
    for (const status of ['draft', 'active']) {
      const msg = messageOf(() => build({
        requires: ['automation'],
        objects: [task],
        flows: [flow('armed', 'record_change', { objectName: 'task', triggerType: 'record-after-create' }, { status })],
      }));
      expect(msg, `status '${status}' must still be refused`).toContain("flow 'armed' declares a 'record_change' trigger");
    }
  });

  it('reports every offending flow together under an (N issues) header', () => {
    const msg = messageOf(() => build({
      requires: ['automation'],
      objects: [task],
      flows: [
        recordFlow('fanout'),
        flow('digest', 'schedule', { schedule: '0 8 * * *' }),
        flow('by_hand', 'autolaunched'),
        flow('hook', 'api'),
      ],
    }));
    expect(msg).toMatch(/^defineStack trigger capability validation failed \(3 issues\):/);
    expect(msg).toContain("✗ flow 'fanout' declares a 'record_change' trigger");
    expect(msg).toContain("✗ flow 'digest' declares a 'schedule' trigger");
    expect(msg).toContain("✗ flow 'hook' declares a 'api' trigger");
    expect(msg).not.toContain("'by_hand'");
  });

  it('the hierarchy-scope sibling still reports first — one throw-site family, checked in order', () => {
    const msg = messageOf(() => build({
      requires: ['automation'],
      objects: [task],
      flows: [recordFlow()],
      permissions: [{ name: 'managers', objects: { task: { allowRead: true, readScope: 'unit_and_below' } } }],
    }));
    expect(msg).toMatch(/^defineStack hierarchy-scope capability validation failed/);
  });

  it('non-strict mode skips validation by contract (the flow passes through unrefused)', () => {
    const stack = defineStack({ objects: [task], flows: [recordFlow()] } as never, { strict: false });
    expect(stack.flows?.length).toBe(1);
  });
});

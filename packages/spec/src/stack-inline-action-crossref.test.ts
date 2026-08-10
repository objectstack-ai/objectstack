/**
 * `defineStack` cross-reference validation reaches INLINE (page-element)
 * actions — #6889.
 *
 * An action authored inline on a page element (`element:button` →
 * `properties.action`, an `InlineActionSchema`) never enters `config.actions`,
 * which is the only list the cross-reference walk used to iterate. The measured
 * consequence, from the card's own five-stack probe on `main`:
 *
 * ```
 * A registered modal -> object  :  REJECTED
 * B registered modal -> page    :  ACCEPTED
 * C registered modal -> nothing :  REJECTED
 * D inline     modal -> object  :  ACCEPTED   ← same target, opposite verdict
 * E inline     modal -> nothing :  ACCEPTED   ← dangling, builds clean
 * ```
 *
 * Row E is the defect on its own terms: a target naming nothing at all shipped
 * as a dead button that failed only when a user clicked it. Row D is the
 * A/D split, and its verdict is fixed by the maintainer's ruling on #6739
 * (2026-08-09): "A — a `type: 'modal'` target names a PAGE, only." So inline
 * mirrors registered exactly — same rule, same message tail, one more
 * traversal.
 *
 * Message shape is contract here (one condition ⇒ one wording), so these pin
 * full message text rather than `toThrow()` alone: a bare throw assertion
 * cannot tell "refused for the right reason" from "refused because the fixture
 * is broken", and every rejection fixture below differs from an ACCEPTED twin
 * by exactly one string.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';

const baseManifest = {
  id: 'com.example.inline',
  name: 'inline-crossref-test',
  version: '1.0.0',
  type: 'app' as const,
};

const objects = [
  { name: 'probe_task', label: 'Probe Task', fields: { title: { type: 'text' as const } } },
];

const flows = [
  { name: 'probe_flow', label: 'Probe Flow', type: 'autolaunched' as const, nodes: [], edges: [] },
];

/** A page whose single region holds the given components. */
const pageWith = (components: unknown[], extra: Record<string, unknown> = {}) => ({
  name: 'probe_home',
  label: 'Probe Home',
  type: 'home' as const,
  regions: [{ name: 'main', components }],
  ...extra,
});

const button = (action: unknown) => ({
  type: 'element:button',
  properties: { label: 'Go', action },
});

/** A stack whose ONLY action is the inline one — no `config.actions` at all. */
const inlineStack = (action: unknown, extra: Record<string, unknown> = {}) => ({
  manifest: baseManifest,
  objects,
  pages: [pageWith([button(action)])],
  ...extra,
});

const build = (config: unknown) => defineStack(config as Parameters<typeof defineStack>[0]);

/** The `✗` lines of a cross-reference rejection, or `[]` when it was accepted. */
function refusals(config: unknown): string[] {
  try {
    build(config);
    return [];
  } catch (error) {
    return String((error as Error).message)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('✗'))
      .map((line) => line.slice(1).trim());
  }
}

describe('defineStack — inline action cross-references: modal targets (#6889)', () => {
  it('rejects a dangling inline modal target (probe row E) with the registered rule\'s wording', () => {
    expect(refusals(inlineStack({ name: 'probe_new_task', type: 'modal', target: 'probe_nowhere' }))).toEqual([
      "Inline action 'probe_new_task' on page 'probe_home' (regions.0.components.0) "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
    ]);
  });

  it('rejects an inline modal target naming an OBJECT — #6739 ruling A, a modal target names a page (probe row D)', () => {
    expect(refusals(inlineStack({ name: 'probe_new_task', type: 'modal', target: 'probe_task' }))).toEqual([
      "Inline action 'probe_new_task' on page 'probe_home' (regions.0.components.0) "
      + "references page 'probe_task' (via modal target) which is not defined in pages.",
    ]);
  });

  it('accepts an inline modal target naming a declared page — the legitimate shape survives', () => {
    expect(refusals(inlineStack({ name: 'probe_new_task', type: 'modal', target: 'probe_home' }))).toEqual([]);
  });

  it('closes the A/D split: the same target gets the same verdict registered or inline', () => {
    const registered = (target: string) => ({
      manifest: baseManifest,
      objects,
      pages: [pageWith([])],
      actions: [{ name: 'probe_new_task', label: 'New', type: 'modal' as const, target }],
    });

    for (const target of ['probe_task', 'probe_nowhere']) {
      expect(refusals(registered(target)).length, `registered → ${target}`).toBe(1);
      expect(refusals(inlineStack({ name: 'probe_new_task', type: 'modal', target })).length, `inline → ${target}`).toBe(1);
    }
    // …and both accept the page.
    expect(refusals(registered('probe_home'))).toEqual([]);
    expect(refusals(inlineStack({ name: 'probe_new_task', type: 'modal', target: 'probe_home' }))).toEqual([]);
  });
});

describe('defineStack — inline action cross-references: flow targets (#6889)', () => {
  it('rejects an inline flow target that names no declared flow', () => {
    expect(refusals(inlineStack({ name: 'probe_run', type: 'flow', target: 'probe_nowhere' }, { flows }))).toEqual([
      "Inline action 'probe_run' on page 'probe_home' (regions.0.components.0) "
      + "references flow 'probe_nowhere' which is not defined in flows.",
    ]);
  });

  it('accepts an inline flow target that names a declared flow', () => {
    expect(refusals(inlineStack({ name: 'probe_run', type: 'flow', target: 'probe_flow' }, { flows }))).toEqual([]);
  });

  it('skips inline flow targets when the stack declares NO flows — same size gate as the registered rule', () => {
    // The referenced flow may be provided by a plugin; the registered walk has
    // made this concession since it was written, and inline must not be
    // stricter than registered.
    expect(refusals(inlineStack({ name: 'probe_run', type: 'flow', target: 'probe_nowhere' }))).toEqual([]);
  });
});

describe('defineStack — inline action cross-references: the traversal itself (#6889)', () => {
  it('reaches a button nested inside a container\'s children and reports its path', () => {
    const config = {
      manifest: baseManifest,
      objects,
      pages: [pageWith([
        {
          type: 'layout:container',
          properties: { children: [button({ name: 'probe_deep', type: 'modal', target: 'probe_nowhere' })] },
        },
      ])],
    };

    expect(refusals(config)).toEqual([
      "Inline action 'probe_deep' on page 'probe_home' (regions.0.components.0.properties.children.0) "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
    ]);
  });

  it('reaches a button authored under `slots` rather than `regions`', () => {
    const config = {
      manifest: baseManifest,
      objects,
      pages: [pageWith([], {
        kind: 'slotted',
        slots: { actions: [button({ name: 'probe_slot', type: 'modal', target: 'probe_nowhere' })] },
      })],
    };

    expect(refusals(config)).toEqual([
      "Inline action 'probe_slot' on page 'probe_home' (slots.actions.0) "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
    ]);
  });

  it('identifies an ANONYMOUS inline action by its path — `name` is optional on this surface', () => {
    expect(refusals(inlineStack({ type: 'modal', target: 'probe_nowhere' }))).toEqual([
      "Inline action on page 'probe_home' (regions.0.components.0) "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
    ]);
  });

  it('reads the legacy `to` spelling through InlineActionSchema, not by hand', () => {
    // `to` → `target` is the schema's preprocess. Page-component `properties`
    // are a loose record, so the raw node has NOT been through it; the walk
    // parses rather than reading `target ?? to` itself (PD #12).
    expect(refusals(inlineStack({ name: 'probe_legacy', type: 'modal', to: 'probe_nowhere' }))).toEqual([
      "Inline action 'probe_legacy' on page 'probe_home' (regions.0.components.0) "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
    ]);
  });

  it('still catches a dangling target on a node InlineActionSchema cannot parse', () => {
    // `objectName` is not a key `InlineActionSchema` picks, so this node fails
    // to parse (`unrecognized_keys`). The dangling target must not get to hide
    // behind that unrelated defect.
    expect(refusals(inlineStack({ name: 'probe_unparsed', type: 'modal', target: 'probe_nowhere', objectName: 'probe_task' }))).toEqual([
      "Inline action 'probe_unparsed' on page 'probe_home' (regions.0.components.0) "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
    ]);
  });

  it('reports every offending inline action on a page, not just the first', () => {
    const config = {
      manifest: baseManifest,
      objects,
      flows,
      pages: [pageWith([
        button({ name: 'probe_one', type: 'modal', target: 'probe_nowhere' }),
        button({ name: 'probe_two', type: 'flow', target: 'probe_elsewhere' }),
      ])],
    };

    expect(refusals(config)).toEqual([
      "Inline action 'probe_one' on page 'probe_home' (regions.0.components.0) "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
      "Inline action 'probe_two' on page 'probe_home' (regions.0.components.1) "
      + "references flow 'probe_elsewhere' which is not defined in flows.",
    ]);
  });
});

describe('defineStack — inline action cross-references: what the walk must NOT refuse (#6889)', () => {
  it.each([
    ['form', { name: 'probe_form', type: 'form', target: 'probe_task.edit' }],
    ['url', { name: 'probe_url', type: 'url', target: '/environments' }],
    ['api', { name: 'probe_api', type: 'api', target: '/api/v1/x', method: 'POST' }],
    ['script', { name: 'probe_script', type: 'script', target: 'doThing' }],
    ['navigation', { type: 'navigation', to: '/environments' }],
  ])('leaves an inline `%s` action alone — only modal and flow targets are cross-referenced', (_type, action) => {
    expect(refusals(inlineStack(action, { flows }))).toEqual([]);
  });

  it('leaves a component with no inline action alone', () => {
    const config = {
      manifest: baseManifest,
      objects,
      pages: [pageWith([{ type: 'element:text', properties: { content: 'hello' } }])],
    };
    expect(refusals(config)).toEqual([]);
  });

  it('is vacuity-guarded: the shipped showcase home CTA shape still builds', () => {
    // The exact inline shape `examples/app-showcase/src/ui/pages/index.ts`
    // carries after #6739 — `type: 'form'` at the object's edit view. If this
    // ever refuses, the corpus census in PR #6889 has gone stale.
    expect(refusals(inlineStack({
      name: 'showcase_new_task', type: 'form', target: 'probe_task.edit', refreshAfter: true,
    }))).toEqual([]);
  });
});

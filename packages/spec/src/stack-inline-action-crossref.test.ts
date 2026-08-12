/**
 * `defineStack` cross-reference validation reaches every authoring position an
 * action's modal/flow `target` can be written in — INLINE page-element actions
 * (#6889) and OBJECT-EMBEDDED actions (#7397).
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
 * The SECOND half of this file is the same defect one authoring position over
 * (#7397). `config.objects[].actions[]` carries the FULL `ActionSchema` — the
 * identical symbol the registered collection uses — yet it too was never
 * target-validated, because `validateCrossReferences` runs BEFORE
 * `mergeActionsIntoObjects` and that merge only ever copies top-level →
 * object. An action authored only on the object therefore never appeared in
 * the validated `config.actions`. Measured on `main` @ `d13ce33`, with the
 * registered twin of each row built from the same helper and the same
 * arguments as the control:
 *
 * ```
 * a embedded   modal -> page    :  ACCEPTED   (h registered: ACCEPTED)
 * b embedded   modal -> nothing :  ACCEPTED   (f registered: REJECTED) ← split
 * c embedded   flow  -> nothing :  ACCEPTED   (g registered: REJECTED) ← split
 * d embedded   modal -> object  :  ACCEPTED   (i registered: REJECTED) ← split
 * e embedded   flow  -> flow    :  ACCEPTED   (j registered: ACCEPTED)
 * ```
 *
 * Rows b/f, c/g and d/i are the same action object in two authoring positions
 * with opposite verdicts; a/h and e/j confirm the legitimate shapes survive in
 * both. Row d's verdict is fixed by the same #6739 ruling, not re-decided here.
 *
 * A THIRD arm was left deliberately unmirrored by #7397's own PR: `objectName`
 * → declared object, "one key over" from the target arms above (#7456):
 *
 * ```
 * k embedded   objectName -> missing object :  ACCEPTED   (l registered: REJECTED) ← split
 * ```
 *
 * #7456's maintainer-ruled disposition is Option A (existence check, verbatim
 * mirror — the same 元判据 that fixed rows b/f, c/g, d/i: a silently-dropped
 * declaration joins the sibling branch's existing refusal set). Option A does
 * NOT check that an embedded `objectName` agrees with its owning object — an
 * embedded action naming a DIFFERENT declared object is accepted, same as
 * before; only a DANGLING `objectName` newly refuses. Options B (consistency)
 * and C (retirement) remain open and are not exercised here.
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

// ─── #7397 — the OBJECT-EMBEDDED position ────────────────────────────

const pages = [pageWith([])];

/**
 * A stack whose ONLY action is embedded on the object — no `config.actions` at
 * all, which is exactly the shape the top-level → object merge can never
 * reach.
 */
const embeddedStack = (action: unknown, extra: Record<string, unknown> = {}) => ({
  manifest: baseManifest,
  objects: [{ ...objects[0], actions: [action] }],
  pages,
  ...extra,
});

/** The same action in the REGISTERED position — the control for each row. */
const registeredStack = (action: unknown, extra: Record<string, unknown> = {}) => ({
  manifest: baseManifest,
  objects,
  pages,
  actions: [action],
  ...extra,
});

const modalAction = (target: string) => ({ name: 'probe_new_task', label: 'New', type: 'modal' as const, target });
const flowAction = (target: string) => ({ name: 'probe_run', label: 'Run', type: 'flow' as const, target });

describe('defineStack — object-embedded action cross-references: modal targets (#7397)', () => {
  it('rejects a dangling embedded modal target (probe row b) with the registered rule\'s wording', () => {
    expect(refusals(embeddedStack(modalAction('probe_nowhere')))).toEqual([
      "Action 'probe_new_task' on object 'probe_task' "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
    ]);
  });

  it('rejects an embedded modal target naming an OBJECT — #6739 ruling A, a modal target names a page (probe row d)', () => {
    expect(refusals(embeddedStack(modalAction('probe_task')))).toEqual([
      "Action 'probe_new_task' on object 'probe_task' "
      + "references page 'probe_task' (via modal target) which is not defined in pages.",
    ]);
  });

  it('accepts an embedded modal target naming a declared page — the legitimate shape survives (probe row a)', () => {
    expect(refusals(embeddedStack(modalAction('probe_home')))).toEqual([]);
  });

  it('skips embedded modal targets when the stack declares NO pages — same size gate as the registered rule', () => {
    // The referenced page may be provided by a plugin; embedded must not be
    // stricter than registered.
    expect(refusals({
      manifest: baseManifest,
      objects: [{ ...objects[0], actions: [modalAction('probe_nowhere')] }],
    })).toEqual([]);
  });
});

describe('defineStack — object-embedded action cross-references: flow targets (#7397)', () => {
  it('rejects an embedded flow target that names no declared flow (probe row c)', () => {
    expect(refusals(embeddedStack(flowAction('probe_nowhere'), { flows }))).toEqual([
      "Action 'probe_run' on object 'probe_task' "
      + "references flow 'probe_nowhere' which is not defined in flows.",
    ]);
  });

  it('accepts an embedded flow target that names a declared flow (probe row e)', () => {
    expect(refusals(embeddedStack(flowAction('probe_flow'), { flows }))).toEqual([]);
  });

  it('skips embedded flow targets when the stack declares NO flows — same size gate as the registered rule', () => {
    expect(refusals(embeddedStack(flowAction('probe_nowhere')))).toEqual([]);
  });
});

describe('defineStack — object-embedded action cross-references: objectName → object (#7456)', () => {
  const dangling = { name: 'probe_on', label: 'On', type: 'script' as const, target: 'doThing', objectName: 'probe_missing' };

  it('rejects a dangling embedded objectName (probe row k) with the registered rule\'s wording, subject adjusted to the owning object', () => {
    expect(refusals(embeddedStack(dangling))).toEqual([
      "Action 'probe_on' on object 'probe_task' "
      + "references object 'probe_missing' which is not defined in objects.",
    ]);
  });

  it('closes the b/f, c/g, d/i pattern one key over (rows k/l): the same action gets the same verdict embedded or registered', () => {
    expect(refusals(embeddedStack(dangling)).length).toBe(1);
    expect(refusals(registeredStack(dangling)).length).toBe(1);
  });

  it('accepts an embedded objectName naming its own owning object', () => {
    expect(refusals(embeddedStack({ name: 'probe_on', label: 'On', type: 'script' as const, target: 'doThing', objectName: 'probe_task' }))).toEqual([]);
  });

  it('accepts an embedded objectName naming a DIFFERENT declared object — Option A is an existence check only, not a consistency check (B stays open)', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { ...objects[0], actions: [{ name: 'probe_on', label: 'On', type: 'script' as const, target: 'doThing', objectName: 'probe_note' }] },
        { name: 'probe_note', label: 'Probe Note', fields: { body: { type: 'text' as const } } },
      ],
      pages,
    };
    expect(refusals(config)).toEqual([]);
  });

  it('leaves an embedded action with no objectName alone — unchanged from before #7456', () => {
    expect(refusals(embeddedStack({ name: 'probe_on', label: 'On', type: 'script' as const, target: 'doThing' }))).toEqual([]);
  });
});

describe('defineStack — object-embedded action cross-references: the b/f, c/g, d/i splits (#7397)', () => {
  it.each([
    ['modal → nothing (rows b/f)', modalAction('probe_nowhere')],
    ['modal → object  (rows d/i)', modalAction('probe_task')],
    ['flow  → nothing (rows c/g)', flowAction('probe_nowhere')],
  ])('gives the same verdict embedded or registered: %s', (_label, action) => {
    expect(refusals(embeddedStack(action, { flows })).length).toBe(1);
    expect(refusals(registeredStack(action, { flows })).length).toBe(1);
  });

  it.each([
    ['modal → declared page (rows a/h)', modalAction('probe_home')],
    ['flow  → declared flow (rows e/j)', flowAction('probe_flow')],
  ])('accepts in BOTH positions: %s', (_label, action) => {
    expect(refusals(embeddedStack(action, { flows }))).toEqual([]);
    expect(refusals(registeredStack(action, { flows }))).toEqual([]);
  });
});

describe('defineStack — object-embedded action cross-references: the traversal itself (#7397)', () => {
  it('labels each offender with ITS OWN object, not a fixed subject', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { ...objects[0], actions: [modalAction('probe_nowhere')] },
        {
          name: 'probe_note',
          label: 'Probe Note',
          fields: { body: { type: 'text' as const } },
          actions: [flowAction('probe_elsewhere')],
        },
      ],
      pages,
      flows,
    };

    expect(refusals(config)).toEqual([
      "Action 'probe_new_task' on object 'probe_task' "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
      "Action 'probe_run' on object 'probe_note' "
      + "references flow 'probe_elsewhere' which is not defined in flows.",
    ]);
  });

  it('reports every offending action on one object, not just the first', () => {
    const config = {
      manifest: baseManifest,
      objects: [{
        ...objects[0],
        actions: [
          { name: 'probe_one', label: 'One', type: 'modal' as const, target: 'probe_nowhere' },
          { name: 'probe_two', label: 'Two', type: 'flow' as const, target: 'probe_elsewhere' },
        ],
      }],
      pages,
      flows,
    };

    expect(refusals(config)).toEqual([
      "Action 'probe_one' on object 'probe_task' "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
      "Action 'probe_two' on object 'probe_task' "
      + "references flow 'probe_elsewhere' which is not defined in flows.",
    ]);
  });

  it('reports a registered action ONCE, not twice — the merge runs AFTER validation', () => {
    // `mergeActionsIntoObjects` copies a top-level action carrying `objectName`
    // into that object's `actions`. It runs at the END of `defineStack`, so the
    // embedded walk must not see the copy. If validation is ever reordered
    // ahead of the merge, this case starts reporting the same action twice —
    // once as registered, once as embedded — and goes red.
    const config = {
      manifest: baseManifest,
      objects,
      pages,
      actions: [{ ...modalAction('probe_nowhere'), objectName: 'probe_task' }],
    };

    expect(refusals(config)).toEqual([
      "Action 'probe_new_task' references page 'probe_nowhere' (via modal target) which is not defined in pages.",
    ]);
  });

  it('still checks the target of an embedded action that also names its object', () => {
    expect(refusals(embeddedStack({ ...modalAction('probe_nowhere'), objectName: 'probe_task' }))).toEqual([
      "Action 'probe_new_task' on object 'probe_task' "
      + "references page 'probe_nowhere' (via modal target) which is not defined in pages.",
    ]);
  });

  it('leaves an object with no actions array alone', () => {
    expect(refusals({ manifest: baseManifest, objects, pages, flows })).toEqual([]);
  });
});

describe('defineStack — object-embedded action cross-references: what the walk must NOT refuse (#7397)', () => {
  it.each([
    ['form', { name: 'probe_form', label: 'Form', type: 'form', target: 'probe_task.edit' }],
    ['url', { name: 'probe_url', label: 'Url', type: 'url', target: '/environments' }],
    ['api', { name: 'probe_api', label: 'Api', type: 'api', target: '/api/v1/x', method: 'POST' }],
    ['script', { name: 'probe_script', label: 'Script', type: 'script', target: 'doThing' }],
  ])('leaves an embedded `%s` action alone — only modal and flow targets are cross-referenced', (_type, action) => {
    expect(refusals(embeddedStack(action, { flows }))).toEqual([]);
  });

  it('is vacuity-guarded: the ordinary merged shape a shipped stack produces still builds', () => {
    // `objects[].actions[]` is overwhelmingly WRITTEN by the merge rather than
    // by hand — a top-level action with `objectName` lands there on the way
    // out of `defineStack`. Feeding that output back in must stay clean, or the
    // corpus census in PR #7397 has gone stale.
    const built = build({
      manifest: baseManifest,
      objects,
      pages,
      flows,
      actions: [
        { ...modalAction('probe_home'), objectName: 'probe_task' },
        { ...flowAction('probe_flow'), objectName: 'probe_task' },
      ],
    });

    expect(built.objects?.[0]?.actions?.map((a) => a.name)).toEqual(['probe_new_task', 'probe_run']);
    expect(refusals(built)).toEqual([]);
  });
});

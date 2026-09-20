/**
 * `quickAdd` on the `ObjectKanbanRenderer` tag is DIAGNOSED, and diagnosed
 * truthfully — the objectui#8285 mechanism (ruling of 2026-09-08, batch #91),
 * ported into this copy in lockstep (objectstack#17645).
 *
 * WHY THESE PINS EXIST HERE. Two copies of this parser exist — objectui's
 * `packages/sdui-parser` (which the browser RENDERER runs) and this hoisted one
 * (which the SAVE GATE runs). These pins are the objectstack half of the
 * lockstep for this diagnostic; the ported module is byte-equal to objectui's.
 * Before this port, this copy answered an authored `quickAdd` with the generic
 * `unknown-prop` while objectui answered `inert-quick-add` — the same authored
 * page getting two different readings from the two tiers, which is the dialect
 * split the lockstep invariant forbids.
 *
 * ## What is red here before the change, and what is not
 *
 * ⚠️ Only the rows that assert `inert-quick-add` are red before this change.
 * `quickAdd` is undeclared on the kanban registrations (objectui#8201 escalated
 * it rather than declaring it), so this tier ALREADY reported it — as
 * `unknown-prop`, a message that is false against the contract
 * `@objectstack/spec` still publishes. The port replaces a wrong reading; it
 * does not add a first one.
 *
 * The remaining rows are green in BOTH worlds by construction, and each is kept
 * because it names a WRONG FIX that would otherwise pass:
 *
 *   - the unknown-prop control — a fix that suppressed the generic walk for
 *     this block rather than for this one key;
 *   - the two RETIRED kanban-ish tags (`kanban`, `kanban-ui`) — a fix scoped
 *     to "a kanban-ish tag" rather than to the one registration that serves
 *     `ObjectKanbanRenderer`. Both left objectui's registry (objectui#8802 /
 *     objectui#8257), so neither is a host any more; they stay declared in the
 *     hand-built manifest below precisely so this row can still discriminate;
 *   - `quickAdd: false` — a fix keyed on the KEY's presence rather than on the
 *     author asking for the control, which would warn about a value that got
 *     exactly what it asked for;
 *   - the braced marker — a fix that reads the parser's opaque `$expr` object
 *     as "truthy, therefore the author asked for it";
 *   - `ok` staying true — an escalation to `error`, which the objectui#5709
 *     ruling ("no new red gates") and objectui#6614 Q2 both put elsewhere.
 */
import { describe, expect, it } from 'vitest';
import {
  INERT_QUICK_ADD,
  QUICK_ADD_HOST_TYPES,
  QUICK_ADD_KEY,
  compile,
  manifestFromConfigs,
  validateTree,
} from '../index.js';
import type { Diagnostic, Manifest } from '../types.js';

/**
 * The three kanban blocks, carrying the inputs their registrations declared —
 * `quickAdd` on NONE of them, which is the state this port leaves untouched.
 * `card` is a non-kanban control block.
 *
 * ⚠️ `kanban` and `kanban-ui` are RETIRED registrations (objectui#8802,
 * objectui#8257) and are kept here ON PURPOSE, as the discrimination controls
 * below: a manifest is an argument to `validateTree`, so this file can still
 * ask what the rule says about a tag the live registry no longer produces —
 * and the answer must be "not a host". ⛔ Do not read their presence as a
 * claim that either tag resolves; against a manifest built from the live
 * registry both answer `unknown-component`.
 */
const manifest: Manifest = manifestFromConfigs([
  {
    type: 'object-kanban',
    namespace: 'plugin-kanban',
    inputs: [
      { name: 'objectName', type: 'string', required: true },
      { name: 'groupBy', type: 'string' },
    ],
  },
  {
    type: 'kanban',
    namespace: 'view',
    inputs: [
      { name: 'objectName', type: 'string', required: true },
      { name: 'groupBy', type: 'string' },
    ],
  },
  { type: 'kanban-ui', namespace: 'plugin-kanban', inputs: [{ name: 'columns', type: 'array' }] },
  { type: 'card', namespace: 'ui', inputs: [] },
]);

const diagnose = (node: Record<string, unknown>): Diagnostic[] =>
  validateTree(node as never, manifest).diagnostics;

const codesFor = (node: Record<string, unknown>, key: string): string[] =>
  diagnose(node).filter((d) => d.message.includes(`"${key}"`)).map((d) => d.code);

const HOST_TAGS = [...QUICK_ADD_HOST_TYPES].sort();

describe('an authored `quickAdd` is diagnosed on the ObjectKanban tags', () => {
  it('the host set is the one surviving ObjectKanbanRenderer tag, and is not empty', () => {
    // Anti-vacuity for every row below: an empty set would make the negative
    // rows trivially true and the positive rows unreachable.
    //
    // ⚠️ This row is the ONLY thing in this package that a change to
    // `QUICK_ADD_HOST_TYPES` reddens — every other row is `it.each(HOST_TAGS)`
    // and re-derives itself from the constant, so a narrowing would otherwise
    // just delete cases silently. `kanban` left the set with its registration
    // (objectui#8802): `checkKanbanQuickAdd` is reached only from
    // `validate.ts`'s prop walk, which runs only for a tag the manifest
    // RESOLVED, so a tag no registration produces is answered by
    // `unknown-component` one level up and never reaches this module.
    expect(HOST_TAGS).toEqual(['object-kanban']);
  });

  it('the stamped literal equals the exported constant', () => {
    // objectui stamps `code: INERT_QUICK_ADD`; this copy stamps the inline
    // literal, because `check:dispatcher-error-vocabulary` cannot reduce a
    // kebab-case constant at a `code:` position (the divergence is documented
    // at the stamp, and is the same one `unconsumed-widget-option` carries).
    // This row is what keeps the two spellings from drifting apart — and the
    // lockstep gate resolves the identifier through this constant, so both
    // copies still agree on the same code.
    expect(INERT_QUICK_ADD).toBe('inert-quick-add');
    const [diagnostic] = diagnose({ type: 'object-kanban', objectName: 'task', quickAdd: true });
    expect(diagnostic.code).toBe(INERT_QUICK_ADD);
  });

  it.each(HOST_TAGS)('<%s> — an authored `quickAdd: true` draws exactly one warning', (tag) => {
    const diagnostics = diagnose({ type: tag, objectName: 'task', quickAdd: true });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(INERT_QUICK_ADD);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].tag).toBe(tag);
  });

  it.each(HOST_TAGS)('<%s> — it REPLACES the false `unknown-prop`, it does not join it', (tag) => {
    // The reading this port exists to correct: before it, the only thing this
    // tier said about this key was that the block "has no prop quickAdd" —
    // false against `ComponentPropsMap['object-kanban']`, which publishes it.
    expect(codesFor({ type: tag, objectName: 'task', quickAdd: true }, QUICK_ADD_KEY)).toEqual([
      INERT_QUICK_ADD,
    ]);
  });

  it.each(HOST_TAGS)('<%s> — the message names the missing half and where the pair works', (tag) => {
    // Not a prose pin: these two tokens are what makes the diagnostic
    // ACTIONABLE, and a message that dropped either would send its reader back
    // to the contract with no explanation, which is the state being fixed.
    const [{ message }] = diagnose({ type: tag, objectName: 'task', quickAdd: true });
    expect(message).toContain('onQuickAdd');
    // ⚠️ The remedy names the COMPONENT, not the `kanban-ui` TAG it used to
    // name: objectui#8257 retired that registration, so a page written to the
    // old advice would now draw `unknown-component` — an ERROR. `KanbanRenderer`
    // is still exported from `@object-ui/plugin-kanban` and still forwards both
    // halves by identity, so it is the surviving way to get the pair.
    expect(message).toContain('KanbanRenderer');
  });

  it.each(HOST_TAGS)('<%s> — control: a genuinely unknown prop is still reported', (tag) => {
    // Guards a fix that turned the generic walk off for this block instead of
    // answering for this one key. Green in both worlds by construction.
    expect(codesFor({ type: tag, objectName: 'task', bogusProp: 'x' }, 'bogusProp')).toEqual([
      'unknown-prop',
    ]);
  });

  it.each(HOST_TAGS)(
    '<%s> — control: a falsy `quickAdd` asks for no control, so it draws none',
    (tag) => {
      // `KanbanImpl` gates on `quickAdd && onQuickAdd`: `false` got exactly what
      // it wrote and nothing was dropped. Guards a fix keyed on the key's mere
      // presence. Green in both worlds — the `unknown-prop` half is the status
      // quo this port deliberately leaves alone.
      expect(codesFor({ type: tag, objectName: 'task', quickAdd: false }, QUICK_ADD_KEY)).toEqual([
        'unknown-prop',
      ]);
    },
  );

  it.each(HOST_TAGS)(
    '<%s> — control: a braced value this tier never evaluates is not read as a request',
    (tag) => {
      // The parser's deferred marker is an opaque object — truthy in JS, and no
      // reading at all about what the author asked for. Guards a fix that tested
      // truthiness alone. Green in both worlds.
      expect(
        codesFor(
          { type: tag, objectName: 'task', quickAdd: { $expr: 'rows.length > 0' } },
          QUICK_ADD_KEY,
        ),
      ).toEqual(['unknown-prop']);
    },
  );

  it.each(['kanban-ui', 'kanban'])(
    'control: `%s` is NOT a host — a kanban-ish tag alone does not arm this diagnostic',
    (tag) => {
      // Guards a fix scoped to "a kanban-ish tag". Both spellings are RETIRED
      // registrations (objectui#8257, objectui#8802), so neither can reach this
      // module through a manifest built from the live registry at all — they are
      // declared in this file's hand-built manifest so the discrimination is
      // still measurable here, which is the one thing a synthetic manifest can
      // do that the live one cannot. `kanban-ui`'s pair itself survives on the
      // exported `KanbanRenderer` component, which no tag resolves to.
      const node = { type: tag, columns: [], quickAdd: true };
      expect(diagnose(node).map((d) => d.code)).not.toContain(INERT_QUICK_ADD);
      expect(codesFor(node, QUICK_ADD_KEY)).toEqual(['unknown-prop']);
    },
  );

  it('control: a non-kanban block is untouched', () => {
    expect(diagnose({ type: 'card', quickAdd: true }).map((d) => d.code)).toEqual(['unknown-prop']);
  });

  it('through the whole pipeline: the diagnostic survives parse + validate on real source', () => {
    // A SUBJECT row, not a control — it is red without the port, like the rows
    // above. It is here because every row above hands `validateTree` a
    // hand-built node: this one starts from source text, so it also proves the
    // parser really materializes the braced `true` as a boolean rather than as
    // the `$expr` marker the falsy/braced controls are about.
    const { diagnostics } = compile('<object-kanban objectName="task" quickAdd={true} />', manifest);
    expect(diagnostics.map((d) => d.code)).toEqual([INERT_QUICK_ADD]);
  });

  it('control: the page still COMPILES — a warning, not a new red gate', () => {
    // `ok` is `!diagnostics.some(d => d.severity === 'error')`, i.e. the save
    // gate's pass/fail, and it is true in BOTH worlds: `unknown-prop` was a
    // warning too, so nothing hardens here. Kept because it names the wrong
    // fix — escalating an inert authored key to `error`, which objectui#5709
    // ("no new red gates") and objectui#6614 Q2 both put elsewhere, and which
    // would stop a page that saves today from saving.
    expect(compile('<object-kanban objectName="task" quickAdd={true} />', manifest).ok).toBe(true);
    // Non-vacuity for that `true`: the same pipeline DOES turn `ok` false when
    // an error-severity diagnostic is present, so this is a reading about this
    // diagnostic's severity and not about `ok` being unreachable.
    expect(compile('<not-a-block />', manifest).ok).toBe(false);
  });
});

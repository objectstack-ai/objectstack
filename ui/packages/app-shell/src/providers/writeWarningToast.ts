/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Turning a write-warning (objectstack-ai/objectstack#3431 / objectstack-ai/objectstack#3455) into the message the user
 * reads. Lives apart from `AdapterProvider` — and, deliberately, imports NOTHING
 * that renders — so the wording, the label resolution and the reason-branching
 * can be exercised directly.
 *
 * @module providers/writeWarningToast
 */

import type {
  DroppedFieldsEvent,
  DroppedFieldsNotice,
  ObjectStackAdapter,
  WriteWarningEvent,
} from '@object-ui/data-objectstack';
import type { TranslateFn } from '@object-ui/i18n';

/**
 * i18next's `t`, narrowed to what this module uses — RE-EXPORTED from its one
 * authority in `@object-ui/i18n`, never re-declared (objectui#8261).
 *
 * Its callers keep importing it from here, so no import path moves. This
 * module declared it itself until the maintainer's ruling on objectui#8165
 * (option A) moved the one declaration down into `@object-ui/i18n`, the
 * package both `@object-ui/app-shell` and `@object-ui/fields` already depend
 * on — the copy in `@object-ui/fields` could never re-export from here,
 * because app-shell depends on fields and not the other way round.
 */
export type { TranslateFn } from '@object-ui/i18n';

/** Convention-based field-label resolver (`useObjectLabel().fieldLabel`). */
export type FieldLabelFn = (objectName: string, fieldName: string, fallback: string) => string;

/**
 * Where the message goes. Structurally satisfied by sonner's `toast`, which is
 * what `AdapterProvider` passes.
 *
 * It is a REQUIRED parameter rather than a default-to-`sonner` one, on purpose:
 * a default would mean importing the toaster here, which is exactly the
 * dependency that has to stay out of this module. The caller owns the sink; the
 * test hands over its own and needs no module mock — so this module's behaviour
 * does not depend on vitest project isolation (`vitest.config.mts` runs the
 * `unit` project with `isolate: false`, where a `vi.mock` of a shared module is
 * only as reliable as the file's worker placement).
 */
export interface WriteWarningSink {
  warning(title: string, options?: { description?: string }): void;
}

/**
 * Resolve `field api name → human label` for one object, best-effort.
 *
 * The write-warning event carries machine names only — the server never sends
 * labels with `droppedFields`. Rather than print `type, source_method` at a
 * user who only ever saw "安灯类型 / 来源方式" (objectui#3484 point C), read the
 * object's schema (the adapter caches it, so this is normally free) and put its
 * labels through the same convention-based i18n every other surface uses. A
 * field the schema does not name falls back to its api name — an exact key
 * beats a guess.
 */
async function resolveFieldLabels(
  adapter: Pick<ObjectStackAdapter, 'getObjectSchema'>,
  objectName: string,
  fieldLabel: FieldLabelFn,
): Promise<(fieldName: string) => string> {
  let fields: Record<string, { label?: string }> | undefined;
  try {
    const schema = (await adapter.getObjectSchema(objectName)) as
      | { fields?: Record<string, { label?: string }> }
      | undefined;
    fields = schema?.fields;
  } catch {
    // Metadata unreachable — the api names below are still a truthful answer.
  }
  return (fieldName: string) =>
    fieldLabel(objectName, fieldName, fields?.[fieldName]?.label || fieldName);
}

/**
 * One description line, given the translator and the already-labelled field list.
 *
 * Every implementation below re-annotates `t: TranslateFn` even though this type
 * already infers it. That is not noise: `scripts/check-i18n-call-site-keys.mjs`
 * decides whether a `t(...)` call is a real translator from the ANNOTATION on the
 * binding (`TRANSLATOR_TYPE`), and an inferred parameter reads as "not a
 * translator" — which silently drops these keys out of the en-pack resolution,
 * the inline-`defaultValue` comparison and the interpolation-parity check. The
 * wording table is exactly the code that gate needs to be watching.
 */
type StrippedLine = (t: TranslateFn, fields: string) => string;

/**
 * The sentence each strip reason gets — EXHAUSTIVE over
 * `DroppedFieldsEvent['reason']` by construction (objectui#3935).
 *
 * This was a two-way conditional on `readonly_when` whose other arm said
 * "Read-only". That arm never meant "readonly"; it meant "everything that is not
 * `readonly_when`", so every reason the write path gained afterwards was
 * announced to the user as a read-only lock — sending them after a permission
 * problem that does not exist. `primary_key` (objectstack#6437) is not a
 * hypothetical: the spec pin this package builds against already carries it.
 *
 * A `Record` keyed by the union is what finally delivers the guarantee that
 * re-exporting THE spec type was for (see `DroppedFieldsEvent`'s own comment in
 * `data-objectstack`): the next reason added upstream fails `type-check` HERE,
 * unworded, whereas the conditional would have compiled forever. It is the same
 * shape the framework side of this seam uses (`service-automation`'s
 * `DROPPED_REASON_LABEL`), and the shape the spec's own schema comment asks every
 * consumer that branches on `reason` to use.
 *
 * The `computed` row (a `formula` field's caller-supplied value, stripped on
 * every write path) was added by objectui#11206 ahead of the published pin:
 * objectstack `b2805465` declared the arm while the pin of the day predated it,
 * so the key type was widened by `| 'computed'` to compile against both. Since
 * `@objectstack/spec` 17.6.0 the pin's own union carries `computed`, so the
 * widening was a no-op and was deleted at that bump (objectui#11438), as its
 * tripwire asked.
 *
 * The `stored_expression` row was added the same way and in the same spelling
 * (objectui#13178): objectstack-ai/objectstack#24778 declared a fifth arm, a
 * stored field whose declared expression the engine computes on every write, so
 * the value the caller sent was replaced by the computed one (the field IS
 * written, unlike `computed`). The row had to exist here before that change could
 * land in objectstack's Console Pin Gate, while the pin of the day predated it,
 * so the key type was widened by `| 'stored_expression'`. The pin move to
 * objectstack 830a63a6 (objectstack-ai/objectstack#25330) carries the arm, so the
 * widening was a no-op and was deleted at that bump, as its tripwire asked: the
 * key type is the spec union again, exact in both directions.
 */
const STRIPPED_LINE: Record<DroppedFieldsEvent['reason'], StrippedLine> = {
  readonly: (t: TranslateFn, fields: string) =>
    t('detail.writeStrippedReadonly', {
      fields,
      defaultValue: 'Read-only, so it did not take effect: {{fields}}',
    }),
  readonly_when: (t: TranslateFn, fields: string) =>
    t('detail.writeStrippedByState', {
      fields,
      defaultValue:
        "Not editable in this record's current state, so it did not take effect: {{fields}}",
    }),
  primary_key: (t: TranslateFn, fields: string) =>
    t('detail.writeStrippedPrimaryKey', {
      fields,
      defaultValue:
        "The record's identifier cannot be changed by a save, so it did not take effect: {{fields}}",
    }),
  // Not a read-only lock either: the server computes a formula field on read and
  // has nowhere to store a value for it, whoever sends one.
  computed: (t: TranslateFn, fields: string) =>
    t('detail.writeStrippedComputed', {
      fields,
      defaultValue:
        'Calculated by the server from a formula, so the value sent did not take effect: {{fields}}',
    }),
  // Not a strip in the `computed` sense: the field is stored, but with the value
  // its expression computes from the record, never the one the caller sent.
  stored_expression: (t: TranslateFn, fields: string) =>
    t('detail.writeStrippedStoredExpression', {
      fields,
      defaultValue:
        'Computed from the record, so the computed value was saved instead of the one sent: {{fields}}',
    }),
};

/**
 * What to say for a reason THIS bundle's spec pin has never heard of.
 *
 * A real runtime state rather than a limb the types already ruled out: the
 * adapter's `notifyDroppedFields` PARSES `reason` against the spec enum and
 * routes a value the enum does not name onto its explicit skew arm, whose
 * `UNRECOGNIZED_DROP_REASON` is by construction not a key of the table above —
 * so a server running ahead of the bundle's pin still arrives here. Both of the other
 * dispositions are worse: indexing blindly would throw inside an `async`
 * function the adapter invokes as `void emitWriteWarning(...)`, so the rejection
 * goes unhandled and the user loses the whole toast INCLUDING the reasons that
 * did resolve; borrowing a known arm would make exactly the false claim this
 * card exists to delete. So name the fields and claim nothing about the cause —
 * version skew is the one case where "we cannot say why" is the true answer.
 */
const strippedLineUnknownReason: StrippedLine = (t: TranslateFn, fields: string) =>
  t('detail.writeStrippedUnknownReason', {
    fields,
    defaultValue: 'Not applied by the server: {{fields}}',
  });

/**
 * Resolve one reason to its sentence.
 *
 * The PARAMETER carries the two-arm notice union, not the spec union.
 * {@link STRIPPED_LINE}'s exhaustiveness has never come from this signature —
 * it comes from that table's own declaration above being keyed by
 * `DroppedFieldsEvent['reason']`. The LOOKUP is done through a
 * widened view of the same table, because the runtime value may sit outside that
 * union (see {@link strippedLineUnknownReason}); the `undefined` this branch
 * handles is therefore reachable, not dead.
 */
function lineFor(reason: DroppedFieldsNotice['reason']): StrippedLine {
  const known: Partial<Record<string, StrippedLine>> = STRIPPED_LINE;
  return known[reason] ?? strippedLineUnknownReason;
}

/**
 * Announce a write-warning. The write SUCCEEDED — some caller-supplied fields
 * were legally stripped, so we tell the user rather than let it pass silently.
 *
 * The REASON decides the wording (objectstack-ai/objectstack#3794), via the exhaustive {@link STRIPPED_LINE}
 * table. `readonly_when` is not "this field is read-only" — the field is editable
 * in other states and the form rendered it as an ordinary input; what happened is
 * that THIS record's current state locks it. Saying "read-only" there sends the
 * user looking for a permission problem that doesn't exist, and the same is true
 * of every later reason the old two-way conditional swept into that wording
 * (objectui#3935).
 *
 * The wording ACKNOWLEDGES the save (objectui#3484 point B). This message lands
 * next to the save surface's own "Updated" toast, and the pair used to read as
 * a contradiction — "some fields were not saved" beside "updated successfully",
 * with nothing telling the user which one to believe. It is one outcome, not
 * two: the record was saved, and N of the fields sent did not take effect.
 *
 * Says nothing when there is nothing to say (no events, or every event carried
 * an empty field list).
 *
 * A write answer's `warnings` (objectui#12107) — advisory validation-rule hits
 * on a write that also SUCCEEDED — get their OWN toast on the same sink, after
 * the stripped-fields one: the stripped toast's title says fields did not take
 * effect, which is not what an advisory rule hit means, so folding the two
 * under it would misdescribe one of them. Each message is shown as the server
 * wrote it (it is the rule author's text); the only copy this module adds is
 * the title. An event without `warnings` produces exactly the toast it always
 * did.
 */
export async function emitWriteWarning(
  ev: WriteWarningEvent,
  t: TranslateFn,
  adapter: Pick<ObjectStackAdapter, 'getObjectSchema'> | null,
  fieldLabel: FieldLabelFn,
  sink: WriteWarningSink,
): Promise<void> {
  await emitStrippedFields(ev, t, adapter, fieldLabel, sink);
  emitAnswerWarnings(ev, t, sink);
}

/**
 * The write answer's advisory `warnings`, one line per distinct message, under
 * one title. Nothing when the event carries none.
 */
function emitAnswerWarnings(ev: WriteWarningEvent, t: TranslateFn, sink: WriteWarningSink): void {
  const messages: string[] = [];
  for (const w of ev.warnings ?? []) {
    if (w.message && !messages.includes(w.message)) messages.push(w.message);
  }
  if (messages.length === 0) return;
  sink.warning(
    t('detail.writeWarningsTitle', {
      defaultValue: 'Saved — with warnings',
    }),
    { description: messages.join('\n') },
  );
}

/** The stripped-fields toast — the channel's original and unchanged message. */
async function emitStrippedFields(
  ev: WriteWarningEvent,
  t: TranslateFn,
  adapter: Pick<ObjectStackAdapter, 'getObjectSchema'> | null,
  fieldLabel: FieldLabelFn,
  sink: WriteWarningSink,
): Promise<void> {
  const byReason = new Map<DroppedFieldsNotice['reason'], string[]>();
  for (const d of ev.droppedFields) {
    const seen = byReason.get(d.reason) ?? [];
    for (const f of d.fields) if (!seen.includes(f)) seen.push(f);
    byReason.set(d.reason, seen);
  }
  if (byReason.size === 0) return;

  const labelOf = adapter && ev.resource
    ? await resolveFieldLabels(adapter, ev.resource, fieldLabel)
    : (fieldName: string) => fieldName;

  const lines: string[] = [];
  for (const [reason, fields] of byReason) {
    if (fields.length === 0) continue;
    const list = fields.map(labelOf).join(', ');
    lines.push(lineFor(reason)(t, list));
  }
  if (lines.length === 0) return;
  sink.warning(
    t('detail.writeStrippedTitle', {
      defaultValue: 'Saved — but some fields did not take effect',
    }),
    { description: lines.join('\n') },
  );
}

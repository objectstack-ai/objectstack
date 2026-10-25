import { describe, expect, it } from 'vitest';
import { FieldSchema, ObjectSchema } from '@objectstack/spec/data';
import { RETIRED_FIELD_KEYS, newField, readFields, writeFields } from './object-fields-io.js';

/**
 * objectui#5761 — the draft-I/O half of the designer key-parity guard.
 *
 * `scripts/check-designer-field-key-parity.mjs` reads the statically DECLARED
 * payload shapes (`FieldMetadataPayload`, `ServerFieldSchema`,
 * `DesignerFieldDefinition`). This module has no declared shape to read: it
 * carries field defs as `Record<string, unknown>` and deliberately preserves
 * arbitrary unknown properties, so the only way to check it is to run its real
 * round-trip and parse the real output with the real schema. That is what this
 * file does, and it is coverage note 3 of the gate's docblock made executable.
 *
 * The class being guarded (#5761): a field designer emits a key `FieldSchema`
 * refuses BY NAME. The author sees the control work and the preview render it,
 * then `PUT /api/v1/meta/object/:name` returns a hard 422 `INVALID_METADATA`
 * that blocks EVERY subsequent save of that object. Three instances, three
 * different correct resolutions — #4644 `indexed` (control retired +
 * strip-on-load), #4687 `distance_metric` (declaration removed), #4676
 * `placeholder` (producer moved upstream, shipped in `@objectstack/spec`
 * 17.1.0).
 *
 * ## Why the negative controls are the deliverable
 *
 * A green parity assertion proves nothing on its own. `FieldSchema` could be
 * resolved to a look-alike, or loosened to a passthrough object, and this file
 * would stay green while asserting nothing at all. So every positive assertion
 * below is paired with a control that must FAIL, and those controls are
 * assertions, not observations — if a control ever passes, the instrument is
 * broken and the whole result is void.
 *
 * ## What this file does NOT cover
 *
 * The keys `ObjectFieldInspector` writes through conditional `patchDef({...})`
 * calls. Those never appear in any declaration and are not enumerable from a
 * round-trip fixture either — the honest limit #5761 states rather than hides.
 * A def key reaching the payload only that way is outside BOTH halves of this
 * guard.
 */

/** The round-trip every draft read/write in the object designer goes through. */
const roundTrip = (fieldsInput: unknown) => writeFields(readFields(fieldsInput));

const parseOne = (def: unknown) => FieldSchema.safeParse(def);

const unrecognizedKeys = (result: ReturnType<typeof parseOne>): string[] =>
  result.success
    ? []
    : result.error.issues.filter((i) => i.code === 'unrecognized_keys').flatMap((i) => (i as { keys: string[] }).keys);

describe('the instrument', () => {
  it('is the installed spec schema and it is STRICT — unknown keys are refused, not stripped', () => {
    // objectstack#4001 closed the silent-drop shape. Everything below depends
    // on that: if `FieldSchema` stripped unknown keys instead of refusing them,
    // every parity assertion in this file would be trivially green while the
    // 422 it guards against still happened server-side.
    const result = parseOne({ type: 'text', label: 'L', zzzDefinitelyNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('zzzDefinitelyNotAKey');
  });
});

describe('a legitimate designer draft round-trips into something FieldSchema accepts', () => {
  it('parses the record shape, the probe #5761 measured working', () => {
    const out = roundTrip({ nickname: { type: 'text', label: 'Nickname', placeholder: 'e.g. Jo' } });
    expect(out).toEqual({ nickname: { type: 'text', label: 'Nickname', placeholder: 'e.g. Jo' } });
    // `placeholder` is #4676's key: refused until the producer moved upstream,
    // accepted since `@objectstack/spec` 17.1.0. Asserting it parses pins the
    // resolution as well as the parity.
    expect(parseOne((out as Record<string, unknown>).nickname).success).toBe(true);
  });

  it('parses the array shape too — both draft shapes go through one read door', () => {
    const out = roundTrip([{ name: 'nickname', type: 'text', label: 'Nickname', placeholder: 'e.g. Jo' }]);
    const [entry] = out as Array<Record<string, unknown>>;
    const { name, ...def } = entry;
    expect(name).toBe('nickname');
    expect(parseOne(def).success).toBe(true);
  });

  it('parses every field `newField` creates, for every type it special-cases', () => {
    // `newField` is the designer's own statically declared emit site: the one
    // place in this module that names keys rather than carrying them through.
    for (const type of ['text', 'select', 'multiselect', 'radio', 'checkboxes'] as const) {
      const created = newField('nickname', type, 'Nickname');
      const out = roundTrip({ [created.name]: created.def }) as Record<string, unknown>;
      const result = parseOne(out.nickname);
      expect(unrecognizedKeys(result), `newField('${type}') emitted a refused key`).toEqual([]);
    }
  });
});

describe('negative controls — if either of these passes, the result above is void', () => {
  it('control 1: an UN-STRIPPED `indexed` is refused, with `unrecognized_keys`', () => {
    // Deliberately NOT routed through `readFields` — that would strip the key
    // and the control would prove nothing. This is the raw def as a draft
    // authored before #4644 carries it.
    const result = parseOne({ type: 'text', label: 'Nickname', indexed: true });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toEqual(['indexed']);
  });

  it('control 2: a bogus key is refused', () => {
    const result = parseOne({ type: 'text', label: 'Nickname', zzzDefinitelyNotAKey: 'x' });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toEqual(['zzzDefinitelyNotAKey']);
  });
});

describe('strip-on-load is what makes a pre-#4644 draft saveable again', () => {
  it('a draft carrying `indexed` comes out of the round-trip parseable', () => {
    // The two halves together are the real assertion: control 1 proves the key
    // is genuinely fatal, this proves `readFields` removes it. Either alone is
    // compatible with a broken strip.
    const out = roundTrip({ nickname: { type: 'text', label: 'Nickname', indexed: true } }) as Record<
      string,
      unknown
    >;
    expect(out.nickname).not.toHaveProperty('indexed');
    expect(parseOne(out.nickname).success).toBe(true);
  });

  it('strips in the array shape as well', () => {
    const out = roundTrip([{ name: 'nickname', type: 'text', label: 'Nickname', indexed: true }]) as Array<
      Record<string, unknown>
    >;
    expect(out[0]).not.toHaveProperty('indexed');
    const { name: _name, ...def } = out[0];
    expect(parseOne(def).success).toBe(true);
  });

  it('every key in RETIRED_FIELD_KEYS really is one the spec refuses', () => {
    // Keeps the tombstone honest in the direction that would otherwise rot
    // silently: if the spec ever starts accepting one of these (the #4676
    // resolution shape), stripping it becomes silent data loss rather than a
    // rescue, and this is what says so.
    for (const key of RETIRED_FIELD_KEYS) {
      const result = parseOne({ type: 'text', label: 'L', [key]: true });
      expect(unrecognizedKeys(result), `\`${key}\` is no longer refused — stripping it now drops data`).toContain(
        key,
      );
    }
  });

  it('strips ONLY the retired keys — every other unknown key still survives the round-trip', () => {
    // The module's contract is a keyed tombstone, never a blanket unknown-key
    // purge. A purge would make this whole file green by construction and
    // silently drop keys the designer does not render.
    const out = roundTrip({
      nickname: { type: 'text', label: 'Nickname', indexed: true, zzzDefinitelyNotAKey: 'kept' },
    }) as Record<string, Record<string, unknown>>;
    expect(out.nickname).not.toHaveProperty('indexed');
    expect(out.nickname.zzzDefinitelyNotAKey).toBe('kept');
  });
});
/**
 * The 422 shape, asserted on the BODY the designer PUTs rather than on a
 * helper's return value (objectui#6519).
 *
 * `writeFields` returns the `fields` map; what fails in production is
 * `PUT /api/v1/meta/object/:name` validating the WHOLE object document. Parsing
 * only the field def would leave the path unmeasured, and the path is the part
 * that says a save of THIS object is blocked: `ObjectSchema` reports the refusal
 * at `["fields", <name>]`, which is what comes back as
 * `422 {"code":"INVALID_METADATA"}` and stays broken for every later save until
 * the key is cleared — with the retired controls gone, from no UI at all.
 */
const emittedBody = (fields: unknown) => ({
  name: 'account',
  label: 'Account',
  fields: roundTrip(fields),
});

/** `[path, keys]` for every `unrecognized_keys` issue, path included. */
const refusedAt = (result: ReturnType<typeof ObjectSchema.safeParse>): Array<[string, string[]]> =>
  result.success
    ? []
    : result.error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .map((i) => [i.path.join('.'), (i as unknown as { keys: string[] }).keys] as [string, string[]]);

describe('the emitted PUT body — the document that actually 422s', () => {
  it('control: the whole document is otherwise accepted', () => {
    // Without this, every refusal below is compatible with a schema that
    // refuses every document, and the paths would prove nothing.
    expect(ObjectSchema.safeParse(emittedBody({ amount: { type: 'number', label: 'Amount' } })).success).toBe(
      true,
    );
  });

  for (const key of RETIRED_FIELD_KEYS) {
    it(`control: an UN-STRIPPED \`${key}\` is refused at ["fields","amount"]`, () => {
      // Deliberately NOT routed through `readFields` — this is the raw draft a
      // pre-retirement build stored, and the assertion is the 422's own shape:
      // the refusal is reported on the FIELD ENTRY, not the object.
      const raw = { name: 'account', label: 'Account', fields: { amount: { type: 'number', label: 'A', [key]: 1 } } };
      const result = ObjectSchema.safeParse(raw);
      expect(result.success).toBe(false);
      expect(refusedAt(result)).toEqual([['fields.amount', [key]]]);
    });

    it(`a draft carrying \`${key}\` comes out of the round-trip as a parseable body`, () => {
      // The two halves together are the real assertion: the control above
      // proves the key is genuinely fatal, this proves the read door removes it
      // before the body is built. Either alone is compatible with a broken strip.
      const body = emittedBody({ amount: { type: 'number', label: 'A', [key]: 1 } });
      expect(ObjectSchema.safeParse(body).success).toBe(true);
      expect((body.fields as Record<string, Record<string, unknown>>).amount).not.toHaveProperty(key);
    });
  }

  it('a draft carrying ALL of them at once comes out parseable', () => {
    // How a draft from the era actually looks: the controls shipped together,
    // and `unrecognized_keys` reports them together, so clearing a subset
    // leaves the object exactly as blocked.
    const poisoned = Object.fromEntries(RETIRED_FIELD_KEYS.map((k) => [k, 1]));
    const raw = {
      name: 'account',
      label: 'Account',
      fields: { amount: { type: 'number', label: 'A', ...poisoned } },
    };
    expect(refusedAt(ObjectSchema.safeParse(raw))).toEqual([['fields.amount', [...RETIRED_FIELD_KEYS]]]);
    expect(ObjectSchema.safeParse(emittedBody(raw.fields)).success).toBe(true);
  });

  it('the array draft shape reaches the same parseable body', () => {
    // `readFields` normalises the two draft shapes through separate branches,
    // and only the record shape is what `ObjectSchema` accepts on the wire.
    const body = {
      name: 'account',
      label: 'Account',
      fields: Object.fromEntries(
        (roundTrip([{ name: 'amount', type: 'number', label: 'A', referenceTo: 'account', indexed: true }]) as Array<
          Record<string, unknown>
        >).map(({ name, ...def }) => [name as string, def]),
      ),
    };
    expect(ObjectSchema.safeParse(body).success).toBe(true);
  });
});

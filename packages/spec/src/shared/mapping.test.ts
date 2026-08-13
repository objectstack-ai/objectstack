import { describe, it, expect } from 'vitest';
import { FieldMappingSchema } from './mapping.zod';
import { ConnectorFieldMappingSchema } from '../integration/connector.zod';

describe('FieldMappingSchema', () => {
  it('should accept minimal valid mapping', () => {
    const result = FieldMappingSchema.parse({
      source: 'external_user_id',
      target: 'user_id',
    });
    expect(result).toEqual({
      source: 'external_user_id',
      target: 'user_id',
    });
  });

  it('should accept mapping with defaultValue', () => {
    const result = FieldMappingSchema.parse({
      source: 'user_name',
      target: 'name',
      defaultValue: 'Unknown',
    });
    expect(result.defaultValue).toBe('Unknown');
  });

  it('should accept mapping with all live fields', () => {
    const result = FieldMappingSchema.parse({
      source: 'FirstName',
      target: 'first_name',
      defaultValue: '',
    });
    expect(result.source).toBe('FirstName');
    expect(result.target).toBe('first_name');
    expect(result.defaultValue).toBe('');
  });

  it('should reject missing source', () => {
    expect(() => FieldMappingSchema.parse({ target: 'name' })).toThrow();
  });

  it('should reject missing target', () => {
    expect(() => FieldMappingSchema.parse({ source: 'name' })).toThrow();
  });

  it('should have optional defaultValue', () => {
    const result = FieldMappingSchema.parse({
      source: 'a',
      target: 'b',
    });
    expect(result.defaultValue).toBeUndefined();
  });
});

// ============================================================================
// [#5552] `transform` and the whole FieldMappingTransform union are RETIRED
// ============================================================================
//
// The pins below replace an entire `describe('FieldMappingTransformSchema')`
// block that asserted all five members parsed. Every one of those cases was
// green for the wrong reason: they proved the union *parsed*, which was never in
// doubt — nothing anywhere ever *executed* one. Re-spelling them was not an
// option and neither was keeping them; the fixture they pinned is exactly what
// was removed, so they are replaced with pins on the surviving behaviour: the
// prescription, and the strip.
//
// The reverse-verification direction, decided before running it: put the union
// and the `transform` key back and these three go RED — the first two because
// no error is raised at all (the parse succeeds and returns the transform), the
// third because `toHaveProperty` finds the key it asserts is gone. That is the
// ordinary direction, not one of the inverted ones, because the tombstone is
// the *only* thing producing these verdicts: there is no schema-level rejection
// underneath it to fall through to (`FieldMappingSchema` is a plain `z.object`,
// so without the tombstone an authored `transform` is either accepted or
// silently stripped — never named).

describe('[#5552] FieldMapping.transform is retired, and says so', () => {
  const RETIRED = {
    source: 'order_value',
    target: 'order_total',
    transform: { type: 'javascript', expression: 'value / 100' },
  };

  it('the base schema rejects it with the prescription, not a generic error', () => {
    const result = FieldMappingSchema.safeParse(RETIRED);
    expect(result.success).toBe(false);
    // The `s` flag: the guidance spans lines once a reporter wraps it.
    expect(result.error!.issues[0]!.message).toMatch(
      /`FieldMapping\.transform`.*removed.*17\.0\.0.*#5552/s,
    );
    // It must name the live mechanism, not merely refuse: an author who wrote a
    // transform wants to know where transforms actually run.
    expect(result.error!.issues[0]!.message).toMatch(/mapping\.fieldMapping\[\]\.transform/s);
    // And the migration command, since the conversion rewrites sources.
    expect(result.error!.issues[0]!.message).toMatch(/os migrate meta --from 16/s);
  });

  it('the surviving extender inherits the tombstone — one retirement, two authorable spellings', () => {
    // `ConnectorFieldMappingSchema` is an `.extend()` of the base, so the
    // retired property is copied into its shape. This is why
    // `RETIRED_KEYS_BY_MAJOR` registers a key per walked shape — nothing
    // radiates from the base; if `.extend()` ever stopped copying it, this
    // goes red. (`ExternalFieldMappingSchema` was the third spelling until the
    // whole external-lookup family left in #8075; its retired-keys entry was
    // subsumed by the def retirement, the WidgetManifest.performance way.)
    for (const [name, schema] of [
      ['ConnectorFieldMapping', ConnectorFieldMappingSchema],
    ] as const) {
      const result = schema.safeParse(RETIRED);
      expect(result.success, `${name} must reject the retired key`).toBe(false);
      expect(result.error!.issues.some((i) => i.path.join('.') === 'transform')).toBe(true);
    }
  });

  it('a mapping without the key parses and carries no `transform` at all', () => {
    // The positive half: the strip path. `not.toHaveProperty` rather than
    // `toBeUndefined` — a key present with an undefined value would still let a
    // consumer's `'transform' in mapping` check succeed.
    const parsed = FieldMappingSchema.parse({ source: 'order_value', target: 'order_total' });
    expect(parsed).not.toHaveProperty('transform');
  });
});

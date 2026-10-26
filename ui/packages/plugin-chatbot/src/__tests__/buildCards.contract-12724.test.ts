/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12724 — the build cards render only what the producer declared, so
 * the payloads their tests feed must be payloads the producer can send.
 *
 * The producer's contract is objectstack-ai/cloud's `build-cards.schema.json`,
 * vendored as `fixtures/build-cards.schema.ts`. No JSON Schema validator is a
 * dependency of this package, so the check below walks the subset of JSON
 * Schema that file uses — `type`, `properties`, `required`,
 * `additionalProperties`, `items`, `oneOf`, `const`, `enum`, `minLength`,
 * `minItems`, `maxItems`, `minimum` — and refuses any other keyword it meets,
 * so a newer schema that leans on one fails here instead of passing unread.
 */
import { describe, expect, it } from 'vitest';
import { BUILD_CARDS_SCHEMA } from './fixtures/build-cards.schema';
import { applyEnvelope, planEnvelope, verifyEnvelope } from './fixtures/buildCards.fixtures';

type Schema = Record<string, unknown>;

const KNOWN = new Set([
  '$schema',
  '$comment',
  'title',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'items',
  'oneOf',
  'const',
  'enum',
  'minLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
]);

/** Every violation of `schema` by `value`, as `path: reason`. */
function violations(schema: Schema, value: unknown, path = '$'): string[] {
  const unknownKeyword = Object.keys(schema).find((k) => !KNOWN.has(k));
  if (unknownKeyword) return [`${path}: schema keyword ${unknownKeyword} is not checked here`];
  const out: string[] = [];
  if ('const' in schema && value !== schema.const) out.push(`${path}: expected const ${String(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) out.push(`${path}: not in enum`);
  if (Array.isArray(schema.oneOf)) {
    const passing = (schema.oneOf as Schema[]).filter((s) => violations(s, value, path).length === 0);
    if (passing.length !== 1) out.push(`${path}: matches ${passing.length} oneOf branches`);
    return out;
  }
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return [`${path}: not a string`];
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) out.push(`${path}: too short`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) return [`${path}: not an integer`];
      if (typeof schema.minimum === 'number' && (value as number) < schema.minimum) out.push(`${path}: below minimum`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return [`${path}: not a boolean`];
      break;
    case 'array': {
      if (!Array.isArray(value)) return [`${path}: not an array`];
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) out.push(`${path}: too few items`);
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) out.push(`${path}: too many items`);
      const items = schema.items as Schema | undefined;
      if (items) value.forEach((v, i) => out.push(...violations(items, v, `${path}[${i}]`)));
      break;
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: not an object`];
      const obj = value as Record<string, unknown>;
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      for (const key of (schema.required ?? []) as string[]) {
        if (!(key in obj)) out.push(`${path}.${key}: required`);
      }
      for (const [key, v] of Object.entries(obj)) {
        if (props[key]) out.push(...violations(props[key], v, `${path}.${key}`));
        else if (schema.additionalProperties === false) out.push(`${path}.${key}: not declared`);
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          out.push(...violations(schema.additionalProperties as Schema, v, `${path}.${key}`));
        }
      }
      break;
    }
    case undefined:
      break;
    default:
      out.push(`${path}: schema type ${String(schema.type)} is not checked here`);
  }
  return out;
}

const defs = BUILD_CARDS_SCHEMA.$defs as Record<string, Schema>;
const PLAN = defs.ProposeBlueprintCardPayload;
const RESULT = defs.BuildResultCardPayload;

describe('the build-card fixtures are payloads the producer declares (objectui#12724)', () => {
  it('reads both definitions off the vendored schema', () => {
    expect(PLAN?.type).toBe('object');
    expect(RESULT?.type).toBe('object');
    expect(PLAN.required).toEqual(['status', 'blueprint', 'planCard']);
    expect(RESULT.required).toEqual(['checklist', 'nextSteps']);
  });

  it.each(['zh', 'en'] as const)('%s: the propose_blueprint envelope satisfies ProposeBlueprintCardPayload', (lang) => {
    expect(violations(PLAN, planEnvelope(lang))).toEqual([]);
  });

  it.each(['zh', 'en'] as const)('%s: the envelope with a generated loan title satisfies ProposeBlueprintCardPayload (objectui#13004)', (lang) => {
    expect(violations(PLAN, planEnvelope(lang, { generatedTitle: true }))).toEqual([]);
  });

  it.each(['zh', 'en'] as const)('%s: the envelopes with a publish posture satisfy ProposeBlueprintCardPayload (cloud#2924)', (lang) => {
    expect(violations(PLAN, planEnvelope(lang, { posture: 'firstBuild' }))).toEqual([]);
    expect(violations(PLAN, planEnvelope(lang, { posture: 'draft' }))).toEqual([]);
  });

  it.each(['zh', 'en'] as const)('%s: the apply_blueprint envelopes satisfy BuildResultCardPayload', (lang) => {
    expect(violations(RESULT, applyEnvelope(lang))).toEqual([]);
    expect(violations(RESULT, applyEnvelope(lang, { materialized: true }))).toEqual([]);
  });

  it.each(['zh', 'en'] as const)('%s: the verify_build envelopes satisfy BuildResultCardPayload', (lang) => {
    expect(violations(RESULT, verifyEnvelope(lang))).toEqual([]);
    expect(violations(RESULT, verifyEnvelope(lang, { failedView: true }))).toEqual([]);
  });

  it('CONTROL — the walk refuses a key the card schema does not declare, and a missing required key', () => {
    const plan = planEnvelope('zh');
    const extraKey = { ...plan, planCard: { ...plan.planCard, nameTemplate: '{图书} · {读者}' } };
    expect(violations(PLAN, extraKey)).toEqual(['$.planCard.nameTemplate: not declared']);
    const { checklist: _dropped, ...noChecklist } = applyEnvelope('zh');
    expect(violations(RESULT, noChecklist)).toEqual(['$.checklist: required']);
    const twoSteps = { ...applyEnvelope('zh'), nextSteps: ['a', 'b'] };
    expect(violations(RESULT, twoSteps)).toEqual(['$.nextSteps: too few items']);
  });
});

import { describe, it, expect } from 'vitest';
import { validateExpressionClient } from './expression-validate';

describe('validateExpressionClient (ADR-0032 author-time)', () => {
  it('accepts a clean bare-CEL predicate', () => {
    expect(validateExpressionClient('predicate', 'record.rating >= 4')).toBeNull();
  });

  it('accepts an empty / absent value', () => {
    expect(validateExpressionClient('predicate', '')).toBeNull();
    expect(validateExpressionClient('predicate', null)).toBeNull();
    expect(validateExpressionClient('predicate', undefined)).toBeNull();
  });

  it('flags the #1491 brace-in-CEL mistake with a corrective message', () => {
    const issue = validateExpressionClient('predicate', '{record.rating} >= 4');
    expect(issue).not.toBeNull();
    expect(issue!.message).toMatch(/map literal/);
    expect(issue!.message).toContain('record.rating');
  });

  it('reads an Expression envelope, not just a string', () => {
    expect(validateExpressionClient('predicate', { dialect: 'cel', source: '{x} > 1' })).not.toBeNull();
    expect(validateExpressionClient('predicate', { dialect: 'cel', source: 'x > 1' })).toBeNull();
  });

  it('flags unbalanced parentheses', () => {
    expect(validateExpressionClient('predicate', '(record.a > 1')!.message).toMatch(/parenthes/i);
  });

  it('templates: flags single-brace and suggests {{ }}', () => {
    const issue = validateExpressionClient('template', 'Hi {record.name}');
    expect(issue).not.toBeNull();
    expect(issue!.message).toMatch(/\{\{ record\.name \}\}|double braces/);
  });

  it('templates: accepts {{ path }}', () => {
    expect(validateExpressionClient('template', 'Hi {{ record.name }}')).toBeNull();
  });
});

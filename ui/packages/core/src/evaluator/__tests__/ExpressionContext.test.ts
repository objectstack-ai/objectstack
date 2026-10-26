import { describe, it, expect } from 'vitest';
import { ExpressionContext } from '../../evaluator/ExpressionContext';

describe('ExpressionContext', () => {
  it('creates a context with initial data', () => {
    const ctx = new ExpressionContext({ name: 'Alice', age: 30 });
    expect(ctx.get('name')).toBe('Alice');
    expect(ctx.get('age')).toBe(30);
  });

  it('creates an empty context', () => {
    const ctx = new ExpressionContext();
    expect(ctx.get('anything')).toBeUndefined();
  });

  it('sets and gets values', () => {
    const ctx = new ExpressionContext();
    ctx.set('key', 'value');
    expect(ctx.get('key')).toBe('value');
  });

  it('checks existence with has()', () => {
    const ctx = new ExpressionContext({ x: 1 });
    expect(ctx.has('x')).toBe(true);
    expect(ctx.has('y')).toBe(false);
  });

  it('supports dot notation for nested access', () => {
    const ctx = new ExpressionContext({ user: { name: 'Bob', address: { city: 'NYC' } } });
    expect(ctx.get('user.name')).toBe('Bob');
    expect(ctx.get('user.address.city')).toBe('NYC');
  });

  it('returns undefined for non-existent nested paths', () => {
    const ctx = new ExpressionContext({ user: { name: 'Bob' } });
    expect(ctx.get('user.email')).toBeUndefined();
    expect(ctx.get('user.address.city')).toBeUndefined();
  });

  describe('scope management', () => {
    it('pushScope adds a new scope', () => {
      const ctx = new ExpressionContext({ base: 'value' });
      ctx.pushScope({ scoped: 'data' });
      expect(ctx.get('scoped')).toBe('data');
      expect(ctx.get('base')).toBe('value');
    });

    it('popScope removes the latest scope', () => {
      const ctx = new ExpressionContext({ base: 'value' });
      ctx.pushScope({ temp: 'data' });
      expect(ctx.get('temp')).toBe('data');
      ctx.popScope();
      expect(ctx.get('temp')).toBeUndefined();
      expect(ctx.get('base')).toBe('value');
    });

    it('inner scope shadows outer scope', () => {
      const ctx = new ExpressionContext({ name: 'outer' });
      ctx.pushScope({ name: 'inner' });
      expect(ctx.get('name')).toBe('inner');
      ctx.popScope();
      expect(ctx.get('name')).toBe('outer');
    });

    it('supports multiple nested scopes', () => {
      const ctx = new ExpressionContext({ level: 0 });
      ctx.pushScope({ level: 1 });
      ctx.pushScope({ level: 2 });
      expect(ctx.get('level')).toBe(2);
      ctx.popScope();
      expect(ctx.get('level')).toBe(1);
      ctx.popScope();
      expect(ctx.get('level')).toBe(0);
    });
  });

  describe('toObject', () => {
    it('flattens all scopes into one object', () => {
      const ctx = new ExpressionContext({ a: 1 });
      ctx.pushScope({ b: 2 });
      const obj = ctx.toObject();
      expect(obj.a).toBe(1);
      expect(obj.b).toBe(2);
    });

    it('inner scope values take precedence in flattened object', () => {
      const ctx = new ExpressionContext({ x: 'outer' });
      ctx.pushScope({ x: 'inner' });
      const obj = ctx.toObject();
      expect(obj.x).toBe('inner');
    });
  });

  describe('createChild', () => {
    it('creates a child context with additional data', () => {
      const parent = new ExpressionContext({ parent: 'value' });
      const child = parent.createChild({ child: 'data' });
      expect(child.get('parent')).toBe('value');
      expect(child.get('child')).toBe('data');
    });

    it('child modifications do not affect parent', () => {
      const parent = new ExpressionContext({ shared: 'original' });
      const child = parent.createChild({});
      child.set('shared', 'modified');
      expect(child.get('shared')).toBe('modified');
      expect(parent.get('shared')).toBe('original');
    });
  });
});

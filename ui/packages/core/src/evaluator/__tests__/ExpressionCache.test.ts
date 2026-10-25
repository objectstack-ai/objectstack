/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExpressionCache } from '../ExpressionCache';

describe('ExpressionCache', () => {
  let cache: ExpressionCache;

  beforeEach(() => {
    cache = new ExpressionCache();
  });

  it('should compile and cache an expression', () => {
    const expr = 'data.amount > 1000';
    const varNames = ['data'];
    
    const compiled = cache.compile(expr, varNames);
    
    expect(compiled).toBeDefined();
    expect(compiled.expression).toBe(expr);
    expect(compiled.varNames).toEqual(varNames);
    expect(compiled.hitCount).toBe(1);
  });

  it('should return cached expression on second call', () => {
    const expr = 'data.amount > 1000';
    const varNames = ['data'];
    
    const first = cache.compile(expr, varNames);
    const second = cache.compile(expr, varNames);
    
    expect(first).toBe(second);
    expect(second.hitCount).toBe(2);
  });

  it('should execute compiled expression correctly', () => {
    const expr = 'data.amount > 1000';
    const varNames = ['data'];
    
    const compiled = cache.compile(expr, varNames);
    const result = compiled.fn({ amount: 1500 });
    
    expect(result).toBe(true);
  });

  it('should handle multiple expressions', () => {
    const expr1 = 'data.amount > 1000';
    const expr2 = 'data.name === "John"';
    const varNames = ['data'];
    
    const compiled1 = cache.compile(expr1, varNames);
    const compiled2 = cache.compile(expr2, varNames);
    
    expect(compiled1).not.toBe(compiled2);
    expect(compiled1.fn({ amount: 1500 })).toBe(true);
    expect(compiled2.fn({ name: 'John' })).toBe(true);
  });

  it('should differentiate between different variable contexts', () => {
    const expr = 'x + y';
    
    const compiled1 = cache.compile(expr, ['x', 'y']);
    const compiled2 = cache.compile(expr, ['x', 'y', 'z']);
    
    // Different variable contexts should create different cache entries
    expect(compiled1).not.toBe(compiled2);
  });

  it('should provide cache statistics', () => {
    cache.compile('data.amount > 1000', ['data']);
    cache.compile('data.amount > 1000', ['data']); // Second call, increment hit
    cache.compile('data.name === "John"', ['data']);
    
    const stats = cache.getStats();
    
    expect(stats.size).toBe(2);
    expect(stats.totalHits).toBe(3);
    expect(stats.entries).toHaveLength(2);
    expect(stats.entries[0].hitCount).toBe(2); // Most frequently used
  });

  it('should evict LRU when cache is full', () => {
    const smallCache = new ExpressionCache(3);
    
    smallCache.compile('expr1', ['x']);
    smallCache.compile('expr2', ['x']);
    smallCache.compile('expr3', ['x']);
    
    // Access expr1 multiple times to increase hit count
    smallCache.compile('expr1', ['x']);
    smallCache.compile('expr1', ['x']);
    
    // Add a 4th expression, should evict least used (expr2 or expr3)
    smallCache.compile('expr4', ['x']);
    
    const stats = smallCache.getStats();
    expect(stats.size).toBe(3);
    
    // expr1 should still be cached (highest hit count)
    expect(smallCache.has('expr1', ['x'])).toBe(true);
  });

  it('should clear cache', () => {
    cache.compile('data.amount > 1000', ['data']);
    cache.compile('data.name === "John"', ['data']);
    
    expect(cache.getStats().size).toBe(2);
    
    cache.clear();
    
    expect(cache.getStats().size).toBe(0);
  });

  it('should handle complex expressions', () => {
    const expr = 'data.items.filter(item => item.price > 100).length';
    const varNames = ['data'];
    
    const compiled = cache.compile(expr, varNames);
    const result = compiled.fn({
      items: [
        { price: 50 },
        { price: 150 },
        { price: 200 },
      ],
    });
    
    expect(result).toBe(2);
  });
});

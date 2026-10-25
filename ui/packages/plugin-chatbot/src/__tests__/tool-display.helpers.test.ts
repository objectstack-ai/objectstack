/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit tests for the chat-display helpers that pretty-print tool outputs
 * and error messages.
 */
import { describe, it, expect } from 'vitest';
import {
  humanizeToolName,
  unwrapToolResult,
  summarizeChatError,
} from '../tool-display';

describe('humanizeToolName', () => {
  it('converts snake_case to sentence case', () => {
    expect(humanizeToolName('list_objects')).toBe('List objects');
    expect(humanizeToolName('query_records')).toBe('Query records');
  });
  it('handles kebab-case and camelCase', () => {
    expect(humanizeToolName('describe-object')).toBe('Describe object');
    expect(humanizeToolName('queryData')).toBe('Query data');
  });
  it('keeps known acronyms uppercase', () => {
    expect(humanizeToolName('list_api_endpoints')).toBe('List API endpoints');
    expect(humanizeToolName('get_user_id')).toBe('Get user ID');
  });
  it('handles empty / nullish input', () => {
    expect(humanizeToolName('')).toBe('');
    expect(humanizeToolName(undefined)).toBe('');
    expect(humanizeToolName(null)).toBe('');
  });
});

describe('unwrapToolResult', () => {
  it('parses MCP {type:text, value:<json>} envelopes', () => {
    const out = unwrapToolResult({
      type: 'text',
      value: '{"count":1,"records":[{"id":"a"}]}',
    });
    expect(out).toEqual({ count: 1, records: [{ id: 'a' }] });
  });
  it('keeps plain-text values as strings', () => {
    expect(unwrapToolResult({ type: 'text', value: 'hello world' })).toBe(
      'hello world',
    );
  });
  it('passes plain objects through unchanged', () => {
    expect(unwrapToolResult({ ok: true })).toEqual({ ok: true });
  });
  it('handles null / undefined', () => {
    expect(unwrapToolResult(null)).toBeNull();
    expect(unwrapToolResult(undefined)).toBeUndefined();
  });
  it('returns the raw string when the inner JSON is invalid', () => {
    expect(unwrapToolResult({ type: 'text', value: '{broken json' })).toBe(
      '{broken json',
    );
  });
});

describe('summarizeChatError', () => {
  it('strips the "Failed after N attempts" prefix', () => {
    const { summary, details } = summarizeChatError(
      new Error(
        'Failed after 3 attempts. Last error: Gateway request timed out: Cannot connect to API. See https://example.com',
      ),
    );
    expect(summary).toBe('Gateway request timed out');
    expect(details).toContain('Cannot connect to API');
    expect(details).not.toMatch(/^Failed after/);
  });
  it('uses the actionable part of invalid response format errors', () => {
    const { summary, details } = summarizeChatError(
      new Error('Invalid error response format: Gateway request failed'),
    );
    expect(summary).toBe('Gateway request failed');
    expect(details).toBe('Invalid error response format: Gateway request failed');
  });
  it('returns a fallback when message is empty', () => {
    expect(summarizeChatError(new Error('')).summary).toMatch(
      /something went wrong/i,
    );
  });
  it('truncates very long single-line messages', () => {
    const long = 'x'.repeat(300);
    const { summary, details } = summarizeChatError(new Error(long));
    expect(summary.length).toBeLessThanOrEqual(140);
    expect(details).toBe(long);
  });
});

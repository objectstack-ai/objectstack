// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29820 — a stack `push` key with no `push` in `requires` is read by nothing:
 * push is requested, never on the always-on slate, so `PushServicePlugin` is
 * not mounted. `objectstack serve` says so once at boot instead of starting as
 * if the key took effect.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatUnrequestedPushKeyWarning } from './serve.js';

const DIRECT = { transport: 'direct', fcm: { projectId: 'example-app', credentialRef: 'FCM_ACCOUNT' } };

describe('formatUnrequestedPushKeyWarning', () => {
  it('a push key without push in requires is named, with the fix', () => {
    const line = formatUnrequestedPushKeyWarning({ push: DIRECT }, ['data', 'auth']);
    expect(line).toMatch(/sets a push key, but requires does not name 'push'/);
    expect(line).toMatch(/the push service is not started and the key is not read/);
    expect(line).toMatch(/Add 'push' to requires/);
  });

  it('an empty push block counts as written', () => {
    expect(formatUnrequestedPushKeyWarning({ push: {} }, [])).not.toBeNull();
  });

  it('says nothing when push is requested, or when no key is written', () => {
    expect(formatUnrequestedPushKeyWarning({ push: DIRECT }, ['push'])).toBeNull();
    expect(formatUnrequestedPushKeyWarning({}, [])).toBeNull();
    expect(formatUnrequestedPushKeyWarning({ push: undefined }, [])).toBeNull();
    expect(formatUnrequestedPushKeyWarning(undefined, [])).toBeNull();
  });

  it('never repeats the configuration', () => {
    const line = formatUnrequestedPushKeyWarning({ push: { ...DIRECT, fcm: { projectId: 'p', credentialRef: 'SECRET_NAME_X' } } }, []);
    expect(line).not.toMatch(/SECRET_NAME_X/);
  });
});

describe('serve prints it at boot, from the served capability list', () => {
  it('the boot reads the resolved requires, not only the declared ones', () => {
    const src = readFileSync(fileURLToPath(new URL('./serve.ts', import.meta.url)), 'utf8');
    const resolvedAt = src.indexOf('const requires: string[] = [...served.tokens];');
    const calledAt = src.indexOf('formatUnrequestedPushKeyWarning(config, requires)');
    expect(resolvedAt).toBeGreaterThan(-1);
    expect(calledAt).toBeGreaterThan(resolvedAt);
    expect(src.slice(calledAt, calledAt + 200)).toMatch(/console\.warn/);
  });
});

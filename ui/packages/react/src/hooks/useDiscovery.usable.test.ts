// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// isServiceUsable — the ADR-0076 D12 console slice. The contract is
// BACKWARD-TOLERANT: 15.1+ honesty signals (handlerReady, status
// degraded/stub) are trusted when present, never required — a pre-15.1
// server that says nothing keeps its historical default (usable).

import { describe, it, expect } from 'vitest';
import { isServiceUsable } from './useDiscovery';

describe('isServiceUsable (ADR-0076 D12)', () => {
  it('absent entry → usable (pre-15.1 default preserved)', () => {
    expect(isServiceUsable(undefined)).toBe(true);
    expect(isServiceUsable(null)).toBe(true);
  });

  it('fields absent beyond enabled → usable', () => {
    expect(isServiceUsable({ enabled: true })).toBe(true);
  });

  it('enabled:false → not usable', () => {
    expect(isServiceUsable({ enabled: false })).toBe(false);
  });

  it('handlerReady:false → not usable (route exists, no real handler)', () => {
    expect(isServiceUsable({ enabled: true, handlerReady: false })).toBe(false);
  });

  it('status stub → not usable (a dev fake is not the real service)', () => {
    expect(isServiceUsable({ enabled: true, status: 'stub', handlerReady: true })).toBe(false);
  });

  it('status unavailable → not usable', () => {
    expect(isServiceUsable({ enabled: true, status: 'unavailable' })).toBe(false);
  });

  it('status degraded → USABLE (a serving fallback must not turn the feature off)', () => {
    expect(isServiceUsable({ enabled: true, status: 'degraded', handlerReady: true })).toBe(true);
  });

  it('fully honest available service → usable', () => {
    expect(isServiceUsable({ enabled: true, status: 'available', handlerReady: true })).toBe(true);
  });
});

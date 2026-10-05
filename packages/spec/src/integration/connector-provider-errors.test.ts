// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3017 — the upstream-unavailable classification a provider factory uses to
// tell the materializer "degrade + retry this instance" instead of "fail boot".

import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_UPSTREAM_UNAVAILABLE,
  ConnectorUpstreamUnavailableError,
  isConnectorUpstreamUnavailable,
} from './connector-provider-errors';

describe('connector provider upstream-unavailable classification — an unreachable upstream degrades instead of aborting boot', () => {
  it('the error carries the marker code, a stable name, and the cause', () => {
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:9999');
    const err = new ConnectorUpstreamUnavailableError('mcp server unreachable', { cause });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(CONNECTOR_UPSTREAM_UNAVAILABLE);
    expect(err.name).toBe('ConnectorUpstreamUnavailableError');
    expect(err.message).toBe('mcp server unreachable');
    expect(err.cause).toBe(cause);
  });

  it('the guard is structural: any error-like object carrying the code matches', () => {
    expect(isConnectorUpstreamUnavailable(new ConnectorUpstreamUnavailableError('x'))).toBe(true);
    // A duplicated module instance (package-manager double-install) produces a
    // different class identity but the same code — must still classify.
    expect(isConnectorUpstreamUnavailable({ code: CONNECTOR_UPSTREAM_UNAVAILABLE, message: 'x' })).toBe(true);
  });

  it('everything else stays on the fail-loud path', () => {
    expect(isConnectorUpstreamUnavailable(new Error('providerConfig.spec is required'))).toBe(false);
    expect(isConnectorUpstreamUnavailable({ code: 'SOMETHING_ELSE' })).toBe(false);
    expect(isConnectorUpstreamUnavailable(undefined)).toBe(false);
    expect(isConnectorUpstreamUnavailable(null)).toBe(false);
    expect(isConnectorUpstreamUnavailable('CONNECTOR_UPSTREAM_UNAVAILABLE')).toBe(false);
  });
});

// Stub for @objectstack/runtime - resolved via vitest alias
import { vi } from 'vitest';

export class HttpDispatcher {
  getDiscoveryInfo = vi.fn().mockReturnValue({ version: '1.0', endpoints: [] });
  handleGraphQL = vi.fn().mockResolvedValue({ data: {} });
  handleAuth = vi.fn().mockResolvedValue({ handled: true, response: { status: 200, body: { ok: true } } });
  handleMetadata = vi.fn().mockResolvedValue({ handled: true, response: { status: 200, body: { objects: [] } } });
  handleData = vi.fn().mockResolvedValue({ handled: true, response: { status: 200, body: { records: [] } } });

  constructor(_kernel: any) {}
}

export type ObjectKernel = any;
export type HttpDispatcherResult = any;

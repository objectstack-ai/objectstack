// Stub for @objectstack/runtime - resolved via vitest alias
//
// [#10835] Every method here must exist on the REAL `HttpDispatcher`
// (`packages/runtime/src/http-dispatcher.ts`). A stub method the subject does
// not have can never diverge from it — it is green by construction — and it
// reads to the next author grepping the name as evidence the runtime still has
// the method. `handleGraphQL` sat here for exactly that reason after `/graphql`
// was removed (#2462 follow-on) and was the last non-CHANGELOG hit for the name
// in `packages/**`. Declaring MORE than this adapter calls is fine (it calls
// only `getDiscoveryInfo`, `handleAuth` and `dispatch`); declaring something the
// dispatcher does not implement is not.
import { vi } from 'vitest';

export class HttpDispatcher {
  getDiscoveryInfo = vi.fn().mockReturnValue({ version: '1.0', routes: {} });
  handleAuth = vi.fn().mockResolvedValue({ handled: true, response: { status: 200, body: { ok: true } } });
  handleMetadata = vi.fn().mockResolvedValue({ handled: true, response: { status: 200, body: { objects: [] } } });
  handleData = vi.fn().mockResolvedValue({ handled: true, response: { status: 200, body: { records: [] } } });

  constructor(_kernel: any) {}
}

export type ObjectKernel = any;
export type HttpDispatcherResult = any;

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /api/v1/ai/agents` — the declaration tied to the wire (#4053).
 *
 * The route has TWO producers in two repos: the framework dispatcher's degraded
 * fallback when no AI service is registered (`runtime/src/domains/ai.ts`, the
 * open-source default — `service-ai` is Cloud/EE) and cloud's `service-ai`
 * `buildAgentRoutes`. Both now answer in the declared envelope, with
 * `AiAgentsResponseSchema` RELOCATED under `data` rather than flattened to the
 * bare array (framework#4124, cloud#929).
 *
 * Each producer pins its own body in its own repo. Neither repo can pin the
 * OTHER one, and `scripts/check-route-envelope.mjs` reaches neither — it scans
 * route modules that write via `res.json(...)`, while the dispatcher domains
 * return `{ status, body }` for a central sender (#4049) and cloud is outside
 * the framework guard entirely. What both producers DO share is this package,
 * which is where the payload is declared. So the agreement is pinned here, once,
 * against the declaration itself.
 *
 * Why bother, when nothing is broken today: the failure this route has is
 * invisible. `useAiSurfaceEnabled` gates the ENTIRE AI surface on
 * `agents.length > 0`, deliberately — the route is access-filtered per caller,
 * making it the only signal that is both edition- and user-aware (ADR-0068). So
 * an empty catalog is a CORRECT answer:
 *
 *   seat-less user                    → AI surface hidden  (correct)
 *   Community Edition, no service-ai  → AI surface hidden  (correct)
 *   a producer flattening `data`      → AI surface hidden  (the bug)
 *
 * No error, no 403, no failed request, no log. There is no downstream signal that
 * would catch a producer drifting, which is why the shape is asserted rather than
 * described.
 */

import { describe, expect, it } from 'vitest';
import { envelopeViolations } from './contract.zod';
import { AiAgentsResponseSchema } from './protocol.zod';

const ASK = {
  name: 'ask', label: 'Ask', role: 'assistant',
  capabilities: { authoring: false, canvas: false, debug: false, resume: false },
};
const BUILD = {
  name: 'build', label: 'Build', role: 'authoring',
  capabilities: { authoring: true, canvas: true, debug: true, resume: true },
};

/** Both halves of the contract: a conformant envelope AND a conformant `data`. */
function servesTheDeclaredShape(body: unknown): boolean {
  if (envelopeViolations(body).length > 0) return false;
  return AiAgentsResponseSchema.safeParse((body as { data?: unknown }).data).success;
}

describe('GET /ai/agents — the body both producers now answer with', () => {
  it('the populated catalog: envelope-conformant, and `data` IS the declared payload', () => {
    const body = { success: true, data: { agents: [ASK, BUILD] } };
    expect(envelopeViolations(body)).toEqual([]);
    expect(AiAgentsResponseSchema.safeParse(body.data).success).toBe(true);
  });

  it('the empty catalog — the framework fallback, and a seat-less caller', () => {
    // Two different reasons for the same body, both correct. The fallback emits
    // exactly this when no AI service is registered; `service-ai` emits it for a
    // caller whose permission set reaches no agent (ADR-0049).
    const body = { success: true, data: { agents: [] } };
    expect(envelopeViolations(body)).toEqual([]);
    expect(AiAgentsResponseSchema.safeParse(body.data).success).toBe(true);
  });

  it('`meta` beside the payload is fine — `deps.success` builds it', () => {
    expect(servesTheDeclaredShape({ success: true, data: { agents: [] }, meta: undefined })).toBe(true);
    expect(servesTheDeclaredShape({ success: true, data: { agents: [] }, meta: { timestamp: 't' } })).toBe(true);
  });
});

describe('GET /ai/agents — the shapes a producer must NOT drift back into', () => {
  it('the FLATTENED conversion — the one that empties the agent list', () => {
    // #3983 set the precedent that `data` carries the payload directly, and
    // following it here would look consistent. It is the wrong reading:
    // `AiAgentsResponseSchema` is a DECLARED payload schema, where share-links'
    // `{ links }` was an ad-hoc wrapper with none — so this is the #3843
    // relocation, not a reshape.
    //
    // Note WHICH check catches it. The envelope is fine; it is the payload that
    // no longer matches its declaration. A suite leading with `envelopeViolations`
    // alone would pass this body, which is exactly how it would ship.
    const body = { success: true, data: [ASK, BUILD] };
    expect(envelopeViolations(body)).toEqual([]);
    expect(AiAgentsResponseSchema.safeParse(body.data).success).toBe(false);
    expect(servesTheDeclaredShape(body)).toBe(false);
  });

  it('the pre-#4053 bare body — no flag for `unwrapResponse` to key on', () => {
    const body = { agents: [ASK] };
    expect(servesTheDeclaredShape(body)).toBe(false);
    expect(envelopeViolations(body)).toContain('success is missing, must be a boolean');
  });

  it('the duplicate-payload shim — `agents` kept alive beside `data`', () => {
    // The drift #4038 / #4049 removed from `/share-links`: the payload under
    // both spellings, so no consumer ever has to choose and neither dialect
    // dies. Here the mirrored key catches it; the payload itself is valid.
    const body = { success: true, data: { agents: [ASK] }, agents: [ASK] };
    expect(envelopeViolations(body)).toEqual([
      'stray top-level key `agents` — the payload belongs under `data`',
    ]);
    expect(servesTheDeclaredShape(body)).toBe(false);
  });

  it('an agent row without `capabilities` — the field UI affordances branch on', () => {
    // cloud#816 / ADR-0057 "B+": hosts render debug drawer, Live Canvas and
    // resume-vs-fresh BY CAPABILITY. A row missing it is not a row this route
    // returns, so it fails the payload half even inside a clean envelope.
    const body = { success: true, data: { agents: [{ name: 'build', label: 'Build', role: 'authoring' }] } };
    expect(envelopeViolations(body)).toEqual([]);
    expect(servesTheDeclaredShape(body)).toBe(false);
  });
});

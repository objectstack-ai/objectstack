// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The packaged-flow doors the console offers in two places (ADR-0146 D4):
 * Setup › Packaged automation, the deployment-wide overview, and Studio's
 * Automations pillar, on a read-only package's open flow.
 *
 *   - `POST /api/v1/automation/<name>/toggle` — the ADR-0126 §7.2 activation
 *     ledger's switch, the bit `GET /automation/_status` reports as `enabled`;
 *   - `POST /api/v1/automation/<name>/clone` — the ADR-0126 §7.1 copy under a
 *     mandatory new machine name and label.
 *
 * One copy of each request, so the two surfaces cannot drift on the body they
 * send or on how a refusal reaches the operator: VERBATIM, through
 * `actionErrorDetail`, the one reader of an ADR-0112 envelope's message. A
 * fallback string is used only when the response carried no message at all,
 * and the caller supplies it in its own surface's words.
 *
 * And one pre-judgement of the gate, from the two facts the server publishes
 * for it ({@link flowLedgerWalledReadOnly}), never a client copy of its sentence.
 */

import { useAuth } from '@object-ui/auth';
import type { TenancyPosture } from '@object-ui/auth';
import { actionErrorDetail } from '@object-ui/core';
import { postureHasOrgWall, useTenancyPosture } from '../../hooks/useTenancyPosture.js';
import { apiBase } from '../../utils/apiBase.js';
import { envelopeData, envelopeRefused } from './packagedFlows.js';

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' } as const;

/** The caller's own words for a refusal that carried no message. */
export interface FlowDoorFallbacks {
  /** The response failed with this status and no message. */
  http: (status: number) => string;
  /** The request itself failed (network, abort) with no message. */
  network: string;
}

/** The toggle's answer: the flag the server reports, or its refusal verbatim. */
export type FlowToggleOutcome = { ok: true; enabled: boolean } | { ok: false; message: string };

/** The clone's answer: the name it created and the server's notice, or its refusal verbatim. */
export type FlowCloneOutcome = { ok: true; name: string; notice: string } | { ok: false; message: string };

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

function thrownMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * `POST …/toggle`. Never throws: a refusal comes back as the server's
 * sentence. The posture gate (403) and the subflow guard (409, which names the
 * callers that would break) both carry the whole of what the operator needs in
 * that string, and nothing on the client could reconstruct it.
 */
export async function requestFlowToggle(
  name: string,
  enabled: boolean,
  fallbacks: FlowDoorFallbacks,
): Promise<FlowToggleOutcome> {
  try {
    const res = await fetch(`${apiBase()}/automation/${encodeURIComponent(name)}/toggle`, {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled }),
    });
    const json = await readJson(res);
    if (!res.ok || envelopeRefused(json)) {
      return { ok: false, message: actionErrorDetail(json, fallbacks.http(res.status)) };
    }
    const reported = envelopeData(json).enabled;
    return { ok: true, enabled: typeof reported === 'boolean' ? reported : enabled };
  } catch (e) {
    return { ok: false, message: thrownMessage(e, fallbacks.network) };
  }
}

/**
 * `POST …/clone`. Never throws: a refusal (a taken name answers 409 with a
 * free name suggested) comes back as the server's sentence.
 *
 * ⛔ EXACTLY the two keys the clone body declares. The carried-over definition
 * is not offered as editable fields: a clone copies the whole definition and
 * the copy is edited in Studio afterwards. The copy lands where the door puts
 * it; no target package is sent while the door declares none.
 */
export async function requestFlowClone(
  source: string,
  target: { name: string; label: string },
  fallbacks: FlowDoorFallbacks,
): Promise<FlowCloneOutcome> {
  const name = target.name.trim();
  try {
    const res = await fetch(`${apiBase()}/automation/${encodeURIComponent(source)}/clone`, {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name, label: target.label.trim() }),
    });
    const json = await readJson(res);
    if (!res.ok || envelopeRefused(json)) {
      return { ok: false, message: actionErrorDetail(json, fallbacks.http(res.status)) };
    }
    const data = envelopeData(json);
    const created = (data.flow as { name?: unknown } | undefined)?.name;
    return {
      ok: true,
      name: typeof created === 'string' && created ? created : name,
      notice: typeof data.notice === 'string' ? data.notice : '',
    };
  } catch (e) {
    return { ok: false, message: thrownMessage(e, fallbacks.network) };
  }
}

/**
 * Do the toggle and clone doors refuse this caller on this deployment?
 *
 * ADR-0126 §5 and ADR-0131 D12 items 7–8: under the walled `group` /
 * `isolated` postures the activation row is install-wide and a clone is
 * environment authoring, so both doors admit only the `PLATFORM_ADMIN` posture
 * rung; under `single`, or with no posture served, they admit the
 * `manage_metadata` holder Studio already requires. These are the two facts
 * `walledCatalogReadOnly` (`metadata-admin/catalog-scope.ts`) reads for the
 * catalog doors — the posture, `features.tenancyPosture`, and the session's
 * `user.isPlatformAdmin` — and the server stays the judge: a refusal after an
 * attempt is still shown as sent. An unknown posture fails toward a live
 * control; a session that never published the flag reads as no operator.
 */
export function flowLedgerWalledReadOnly(input: {
  posture: TenancyPosture | undefined;
  isPlatformOperator: boolean;
}): boolean {
  return postureHasOrgWall(input.posture) && !input.isPlatformOperator;
}

/** {@link flowLedgerWalledReadOnly} for this session and this deployment. */
export function useFlowLedgerWalledReadOnly(): boolean {
  const posture = useTenancyPosture();
  const { user } = useAuth();
  return flowLedgerWalledReadOnly({ posture, isPlatformOperator: user?.isPlatformAdmin === true });
}

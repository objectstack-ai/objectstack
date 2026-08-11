// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7542] The two REST-dispatching showcase flows capture the connector
 * response on the run — the claim their source comments make.
 *
 * `run.output` is not a free side effect of dispatching: the engine collects it
 * from the flow's declared `isOutput` variables ONLY
 * (`AutomationEngine.execute` → "Collect output variables"). Both
 * `TaskCompletedRestPingFlow` and `ShowcaseDeclarativeConnectorPingFlow`
 * dispatched correctly but declared no variables at all, so `run.output` came
 * back empty while the comments said the response was captured — a comment that
 * sends the next reader hunting for an engine bug that does not exist. The
 * sibling `ShowcaseMcpConnectorEchoFlow` proved it was authoring, not engine:
 * same dispatch path, one declared variable, captured output.
 *
 * This file pins the fixed behaviour at the level the defect lives at — the
 * flow's own declaration against the real connector's real output keys:
 *
 *   - the flows come from `src/automation/flows/index.ts` (not a copy);
 *   - the `rest` connector is the REAL `createRestConnector` bundle, and the
 *     declarative instance is materialized by the REAL `createRestProviderFactory`
 *     from the REAL `StatusApiConnector` metadata — only `fetch` is stubbed, so
 *     the handler's `{ status, ok, body }` output shape is the shipped one;
 *   - the assertion is a CONTENT pin on `run.output`, not schema validity:
 *     `ping.body` must deep-equal the health payload `{ status: 'ok' }`.
 *
 * The variable name is not free either — the engine writes a node's output back
 * under `${nodeId}.${key}`, so a flow declaring the wrong name captures
 * `undefined` while still parsing and still dispatching. Asserting the value
 * rather than the key's presence is what makes that failure visible.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine, registerConnectorNodes } from '@objectstack/service-automation';
import { createRestConnector, createRestProviderFactory } from '@objectstack/connector-rest';

import {
  TaskCompletedRestPingFlow,
  ShowcaseDeclarativeConnectorPingFlow,
} from '../src/automation/flows/index.js';
import { StatusApiConnector } from '../src/system/connectors/index.js';

/** The payload `GET /api/v1/health` answers with on a live showcase boot. */
const HEALTH_PAYLOAD = { status: 'ok' } as const;

function silentLogger(): any {
  const logger: any = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  logger.child = () => logger;
  return logger;
}

/**
 * A `fetch` stand-in that answers every call with the health payload and records
 * the URLs it was asked for, so the test can also confirm the flow-owned path
 * (`/api/v1/health`) actually went out.
 */
function stubFetch(requested: string[]): typeof fetch {
  return (async (input: any) => {
    requested.push(typeof input === 'string' ? input : String(input?.url ?? input));
    return new Response(JSON.stringify(HEALTH_PAYLOAD), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function newEngine(): AutomationEngine {
  const engine = new AutomationEngine(silentLogger());
  registerConnectorNodes(engine, { logger: silentLogger() } as any);
  return engine;
}

describe('showcase REST connector flows — run output capture (#7542)', () => {
  it('showcase_task_completed_rest_ping captures the health response as ping.body', async () => {
    const requested: string[] = [];
    const engine = newEngine();

    // The plugin-registered `rest` connector, exactly as ConnectorRestPlugin
    // builds it in objectstack.config.ts — only `fetch` is injected.
    const { def, handlers } = createRestConnector({
      name: 'rest',
      baseUrl: 'http://127.0.0.1:3000',
      fetchImpl: stubFetch(requested),
    });
    engine.registerConnector(def, handlers);

    engine.registerFlow(TaskCompletedRestPingFlow.name, TaskCompletedRestPingFlow);

    // The flow is gated on the done-transition, so drive it with the same
    // trigger context a record-after-update hook would supply.
    const result = await engine.execute(TaskCompletedRestPingFlow.name, {
      object: 'showcase_task',
      event: 'on_update',
      record: { id: 't1', status: 'done' },
      previous: { id: 't1', status: 'in_progress' },
    });

    expect(result.success).toBe(true);
    // The call the flow declared actually went out...
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('/api/v1/health');
    // ...and its response is on the run, which is what the comment claims.
    expect(result.output).toEqual({ 'ping.body': HEALTH_PAYLOAD });
  });

  it('showcase_declarative_connector_ping captures it too, through the materialized ADR-0097 instance', async () => {
    const requested: string[] = [];
    const engine = newEngine();

    // Materialize `showcase_status_api` the way the automation service does at
    // boot: the REAL provider factory, fed the REAL declared metadata.
    // The factory contract allows an async materialization, so await it — the
    // `rest` one happens to be synchronous.
    const factory = createRestProviderFactory({ fetchImpl: stubFetch(requested) });
    const { def, handlers } = await factory({
      name: StatusApiConnector.name,
      label: StatusApiConnector.label,
      providerConfig: StatusApiConnector.providerConfig,
      auth: StatusApiConnector.auth,
    } as any);
    engine.registerConnector(def, handlers);

    engine.registerFlow(ShowcaseDeclarativeConnectorPingFlow.name, ShowcaseDeclarativeConnectorPingFlow);

    const result = await engine.execute(ShowcaseDeclarativeConnectorPingFlow.name, {
      object: 'showcase_task',
      event: 'on_create',
      record: { id: 't2', status: 'todo' },
    });

    expect(result.success).toBe(true);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('/api/v1/health');
    expect(result.output).toEqual({ 'ping.body': HEALTH_PAYLOAD });
  });

  it('declares the output variable on both flows — the defect was its absence, not a wrong value', () => {
    for (const flow of [TaskCompletedRestPingFlow, ShowcaseDeclarativeConnectorPingFlow]) {
      const outputs = (flow.variables ?? []).filter((v) => v.isOutput);
      expect(outputs.map((v) => v.name)).toEqual(['ping.body']);
      // The name must match the connector node it reads from: the engine writes
      // back under `${nodeId}.${key}`.
      expect(flow.nodes.some((n) => n.id === 'ping' && n.type === 'connector_action')).toBe(true);
    }
  });
});

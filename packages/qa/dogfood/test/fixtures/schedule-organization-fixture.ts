// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Fixture for the #16659 acting-organization pins: two `schedule` flows that
// differ in EXACTLY ONE key — the `organization` declaration on the start node
// — so the pins' red/green is attributable to that key and to nothing else.
//
// Both flows are built at TEST time rather than declared in the stack config,
// because both of their load-bearing values are minted by the running stack:
// `sys_organization` ids and the recipient's `sys_user` id. A fixture that
// baked either one in would assert against a row that does not exist.

/** Object the tick touches, so a run has a data write of its own to land. */
const SweepTargetObject = {
  name: 'sched_org_target',
  label: 'Sweep Target',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    touched: { type: 'checkbox', label: 'Touched' },
  },
};

/** The stack both pins boot. Flows are registered after boot (see the header). */
export const scheduleOrganizationStack = {
  name: 'sched_org_fixture',
  label: 'Schedule acting-organization fixture',
  version: '1.0.0',
  requires: ['automation', 'triggers', 'messaging'],
  objects: [SweepTargetObject],
};

/**
 * The organization-DECLARING flow: a `schedule` start node carrying a cadence
 * and the `organization` key the ruling requires, then a `notify` node whose
 * inbox rows are tenant-scoped.
 *
 * `runAs: 'system'` because a scheduled run has no trigger user (ADR-0049 /
 * #1888) — the declaration every scheduled flow in this repo carries, and the
 * one that makes the tenancy question live: an elevated write carries no
 * session organization, so without the key below there is nothing to stamp and
 * the #8844 guard refuses every tenant-scoped row beneath the run.
 */
export function declaringScheduleFlow(organizationId: string, recipientId: string): unknown {
  return {
    name: 'sched_org_declared',
    label: 'Scheduled digest (organization declared)',
    type: 'schedule',
    status: 'active',
    runAs: 'system',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'Every minute',
        config: {
          schedule: { type: 'cron', expression: '* * * * *' },
          organization: organizationId,
        },
      },
      {
        id: 'notify',
        type: 'notify',
        label: 'Digest',
        config: {
          topic: 'sched.digest',
          recipients: [recipientId],
          title: 'Nightly digest',
          message: 'Your digest is ready.',
          channels: ['inbox'],
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'notify' },
      { id: 'e2', source: 'notify', target: 'end' },
    ],
  };
}

/**
 * The organization-LESS twin: the flow above with the `organization` key
 * deleted and its own name, derived from the same builder so the two can never
 * drift into being two different flows that merely look alike.
 */
export function organizationLessScheduleFlow(recipientId: string): unknown {
  const declared = declaringScheduleFlow('org_unused_placeholder', recipientId) as {
    nodes: Array<{ id: string; config?: Record<string, unknown> }>;
  } & Record<string, unknown>;
  const nodes = declared.nodes.map((n) => {
    if (n.id !== 'start') return n;
    const config = { ...(n.config ?? {}) };
    delete config.organization;
    return { ...n, config };
  });
  return { ...declared, name: 'sched_org_undeclared', nodes };
}

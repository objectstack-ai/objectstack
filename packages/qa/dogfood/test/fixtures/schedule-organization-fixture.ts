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

/**
 * Object the tick touches, so a run has a data write of its own to land.
 *
 * `due_date` is what the `time_relative` sweep selects on (#16659 F2). It is a
 * `datetime` rather than a `date` deliberately: the window the trigger computes
 * is a pair of ISO-8601 instants, and comparing them against a column the
 * driver truncates to `YYYY-MM-DD` puts a per-driver truncation rule between
 * the fixture and the property under test, which is WHICH ORGANIZATION's rows
 * came back.
 */
const SweepTargetObject = {
  name: 'sched_org_target',
  label: 'Sweep Target',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    touched: { type: 'checkbox', label: 'Touched' },
    due_date: { type: 'datetime', label: 'Due' },
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

/**
 * [#16659 F2] The `time_relative` twin: a sweep that declares its acting
 * organization, selects `sched_org_target` rows whose `due_date` falls in the
 * next week, and — once per matched record — notifies and writes.
 *
 * Both trailing nodes are load-bearing and they measure DIFFERENT halves:
 *
 *  - `notify` produces one tenant-scoped inbox row per LAUNCHED run, so the
 *    count of those rows is the count of records the sweep SELECTED. That is
 *    the F2 property: an unscoped sweep selects the other organization's rows
 *    too and posts about them into the declared organization's inbox.
 *  - `update_record` is the data-plane half the branch previously left unpinned
 *    (the fixture flow was `start → notify → end`). The run is scoped to the
 *    declared organization, so a write aimed at another organization's row
 *    matches nothing — silently. Asserting WHICH rows got `touched` is what
 *    makes that narrowing observable instead of assumed.
 */
export function declaringTimeRelativeFlow(organizationId: string, recipientId: string): unknown {
  return {
    name: 'sched_org_sweep',
    label: 'Time-relative sweep (organization declared)',
    type: 'schedule',
    status: 'active',
    runAs: 'system',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'Daily sweep',
        config: {
          timeRelative: {
            object: 'sched_org_target',
            dateField: 'due_date',
            withinDays: 7,
          },
          organization: organizationId,
        },
      },
      {
        id: 'notify',
        type: 'notify',
        label: 'Due soon',
        config: {
          topic: 'sched.due',
          recipients: [recipientId],
          title: 'Due soon: {record.name}',
          message: '{record.name} is due.',
          channels: ['inbox'],
          sourceObject: 'sched_org_target',
          sourceId: '{record.id}',
        },
      },
      {
        id: 'touch',
        type: 'update_record',
        label: 'Mark touched',
        config: {
          objectName: 'sched_org_target',
          filter: { id: '{record.id}' },
          fields: { touched: true },
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'notify' },
      { id: 'e2', source: 'notify', target: 'touch' },
      { id: 'e3', source: 'touch', target: 'end' },
    ],
  };
}

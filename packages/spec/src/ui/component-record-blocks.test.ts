// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8744 — `record:alert`, `record:quick_actions`, `record:history` and
// `record:discussion` get their `ComponentPropsMap` rows: the four `record:*`
// types #8691's rail fix left in the rail's own pre-fix position (registered
// renderer + enum/palette presence + no row = the #5068 gate's dispatch skips
// the props bag and every authored key rides through in silence).
//
// The key sets are measured from the renderers' read points at the
// `.objectui-sha` pin (`record-alert.tsx`, `record-quick-actions.tsx`,
// `record-history.tsx` + `HistoryTimeline.tsx`, `record-chatter.tsx`), NOT
// from the registrations' declared-input lists — and the divergences between
// the two are the interesting pins below: quick_actions' `aria` (read under a
// spelling the shared ARIA shape refuses), its `actions` (host channel),
// history's `entries`/`loading` (host channel), and alert's `icon` (READ here,
// the opposite verdict from the rail's refused `icon`).

import { describe, expect, it } from 'vitest';
import {
  ComponentPropsMap,
  RecordAlertActionSchema,
  RecordAlertProps,
  RecordChatterProps,
  RecordHistoryProps,
  RecordQuickActionsProps,
} from './component.zod';
import { PageComponentType } from './page.zod';
import { RECORD_CONTEXT_BLOCK_TAGS, reactBlockTagFor } from './react-blocks';

/** All issue messages of a failed safeParse, joined for content assertions. */
const messagesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) => {
  expect(result.success).toBe(false);
  return result.error!.issues.map((i) => i.message).join('\n');
};

describe('ComponentPropsMap rows exist and are the exported schemas (#8744)', () => {
  it('dispatches all four previously-skipped types', () => {
    expect(ComponentPropsMap['record:alert']).toBe(RecordAlertProps);
    expect(ComponentPropsMap['record:quick_actions']).toBe(RecordQuickActionsProps);
    expect(ComponentPropsMap['record:history']).toBe(RecordHistoryProps);
    // The pair is ONE schema object, not a copy: `record:discussion` is the
    // same renderer under the registration-preferred name, and two rows would
    // give it two accept faces to drift apart.
    expect(ComponentPropsMap['record:discussion']).toBe(RecordChatterProps);
    expect(ComponentPropsMap['record:discussion']).toBe(ComponentPropsMap['record:chatter']);
  });

  it('covers the four under the react record-context gate\'s derived tags', () => {
    for (const type of ['record:alert', 'record:quick_actions', 'record:history', 'record:discussion'] as const) {
      expect(RECORD_CONTEXT_BLOCK_TAGS.get(reactBlockTagFor(type))).toBe(type);
    }
  });

  it('`record:discussion` is a PageComponentType enum member, not only a string-arm stowaway', () => {
    expect(PageComponentType.options).toContain('record:discussion');
  });
});

describe('ComponentPropsMap["record:alert"] (#8744)', () => {
  // The card's own headline defect: a typo'd `severty` shipped as a silent
  // no-op. With the row it is a prescriptive refusal that names the rename.
  it('refuses the card\'s planted `severty` with the rename suggestion', () => {
    const message = messagesOf(RecordAlertProps.safeParse({ severty: 'warning' }));
    expect(message).toContain('`severty`');
    expect(message).toContain('record:alert');
    expect(message).toContain('severity');
  });

  it('accepts the platform sys_user banner — inline locale maps, CEL `visible`, CTA — with only the documented `visible` normalization', () => {
    // The live specimen from `packages/platform-objects/src/pages/sys-user.page.ts`
    // (abbreviated locale maps): every key is a measured read point.
    const authored = {
      severity: 'warning',
      icon: 'mail',
      title: { en: 'Email not verified', 'zh-CN': '邮箱未验证' },
      body: { en: 'Verify your email.', 'zh-CN': '验证你的邮箱。' },
      visible: 'record.id == ctx.user.id && record.email_verified == false',
      dismissible: false,
      action: {
        actionName: 'resend_verification_email',
        label: { en: 'Resend verification email', 'zh-CN': '重新发送验证邮件' },
      },
    } as const;
    const result = RecordAlertProps.parse(authored);
    // `title` / `body` / `action.label` are I18nLabelSchema — the inline map
    // is a DELIVERED capability on this renderer (pickLocalized), the opposite
    // verdict from the rail's literal-string `title`. Maps survive untouched.
    expect(result.title).toEqual(authored.title);
    expect(result.body).toEqual(authored.body);
    expect(result.action).toEqual(authored.action);
    expect(result.severity).toBe('warning');
    expect(result.icon).toBe('mail');
    expect(result.dismissible).toBe(false);
    // The ONE parse-time rewrite, and it is ExpressionInputSchema's own
    // documented contract, not this row's: a bare CEL string normalizes to the
    // canonical `{ dialect, source }` envelope.
    expect(result.visible).toEqual({ dialect: 'cel', source: authored.visible });
  });

  it('accepts the showcase task banner byte-identically apart from `visible`', () => {
    // `examples/app-showcase/src/ui/pages/task-detail.page.ts` — string
    // title/body, so everything except the predicate round-trips unchanged.
    const authored = {
      severity: 'warning',
      icon: 'eye',
      title: 'Awaiting review',
      body: 'This task is in review — confirm the work before marking it done.',
      visible: "record.status == 'in_review'",
      dismissible: true,
    } as const;
    const result = RecordAlertProps.parse(authored);
    expect(result).toEqual({ ...authored, visible: { dialect: 'cel', source: authored.visible } });
  });

  it('declares `icon` because THIS renderer reads it — the rail\'s opposite verdict, same method', () => {
    // `record-alert.tsx`: `props.icon || SEVERITY_STYLES[severity].icon`,
    // painted by LazyIcon. The rail refuses `icon` (read by nothing there).
    expect(RecordAlertProps.parse({ icon: 'mail' }).icon).toBe('mail');
  });

  it('accepts boolean and envelope `visible`, refuses the empty string', () => {
    expect(RecordAlertProps.parse({ visible: false }).visible).toBe(false);
    expect(RecordAlertProps.parse({ visible: { dialect: 'cel', source: 'record.done' } }).visible)
      .toEqual({ dialect: 'cel', source: 'record.done' });
    // `toPredicateInput('')` is "nothing declared" at the renderer; at
    // authoring time an empty predicate is a mistake to refuse, not to ship.
    expect(RecordAlertProps.safeParse({ visible: '' }).success).toBe(false);
  });

  it('routes the node-spelling predicates onto `visible` as aliases, not the wrong-layer set', () => {
    // This is the one record component whose PROPS predicate is real, so the
    // COMPONENT_NODE_VISIBILITY_KEYS "move it up to the node" prescription
    // would be wrong here; the same-meaning spellings rename instead.
    for (const key of ['visibleWhen', 'visibility'] as const) {
      const message = messagesOf(RecordAlertProps.safeParse({ [key]: 'record.done' }));
      expect(message).toContain(`\`${key}\``);
      expect(message).toContain('`visible`');
    }
  });

  it('still routes component-NODE keys up a level (the list set stays)', () => {
    const message = messagesOf(RecordAlertProps.safeParse({ className: 'mt-2' }));
    expect(message).toContain('component NODE');
  });

  it('refuses an out-of-vocabulary severity instead of absorbing it into the renderer\'s `info` fallback', () => {
    expect(RecordAlertProps.safeParse({ severity: 'severe' }).success).toBe(false);
  });

  it('closes the CTA sub-shape: `name` renames to `actionName`, unknown keys are refused', () => {
    const renamed = messagesOf(RecordAlertActionSchema.safeParse({ name: 'resend_verification_email' }));
    expect(renamed).toContain('`actionName`');
    const unknown = messagesOf(RecordAlertActionSchema.safeParse({
      actionName: 'x', confirmText: 'Sure?',
    }));
    expect(unknown).toContain('`confirmText`');
    expect(unknown).toContain('record:alert');
  });

  it('materializes nothing for the silent author — no schema defaults', () => {
    // `severity: 'info'`, the severity icon, `dismissible: false` are the
    // RENDERER'S fallbacks; "the author said nothing" survives the parse.
    expect(RecordAlertProps.parse({})).toEqual({});
  });
});

describe('ComponentPropsMap["record:quick_actions"] (#8744)', () => {
  it('accepts the showcase and sys_user bars byte-identically', () => {
    for (const authored of [
      // examples/app-showcase/src/ui/pages/task-detail.page.ts
      {
        location: 'record_section',
        align: 'start',
        actionNames: ['showcase_mark_done', 'showcase_log_time', 'showcase_archive_task'],
      },
      // packages/platform-objects/src/pages/sys-user.page.ts (×4 nodes)
      {
        location: 'record_section',
        align: 'start',
        actionNames: ['enable_two_factor', 'disable_two_factor', 'generate_backup_codes'],
      },
    ] as const) {
      expect(RecordQuickActionsProps.parse(authored)).toEqual(authored);
    }
  });

  it('refuses `actions` — both spellings of it — with the object-owns-actions prescription', () => {
    // As a name list it is `actionNames` under related_list's spelling; as
    // inline defs it is the host synthesizer's runtime channel
    // (`buildDefaultActions` passes RESOLVED ActionDefs). Neither is
    // authorable, and one guidance entry answers both.
    for (const value of [
      ['showcase_mark_done'],
      [{ name: 'approve', label: 'Approve', type: 'api' }],
    ]) {
      const message = messagesOf(RecordQuickActionsProps.safeParse({ actions: value }));
      expect(message).toContain('`actions`');
      expect(message).toContain('actionNames');
    }
  });

  it('refuses `aria` with the measured-divergence prescription instead of declaring a key nothing reads', () => {
    // The renderer reads `aria.label` — the spelling `AriaPropsSchema`
    // refuses (`label` is its alias for `ariaLabel`) — and reads nothing else
    // of the bag. Declaring `AriaPropsSchema` here would mint `ariaLabel` as
    // declared-but-unenforced: the #8691 `icon` class, on the very card that
    // abolishes it. objectui#4663 tracks the renderer-side fix.
    const message = messagesOf(RecordQuickActionsProps.safeParse({
      aria: { ariaLabel: 'Quick actions' },
    }));
    expect(message).toContain('`aria`');
    expect(message).toContain('declared-but-unenforced');
  });

  it('suggests the rename for a near-miss key', () => {
    const message = messagesOf(RecordQuickActionsProps.safeParse({ actioNames: ['x'] }));
    expect(message).toContain('`actioNames`');
    expect(message).toContain('actionNames');
  });

  it('vets `location` against the spec\'s own ActionLocationSchema — one vocabulary, not a restatement', () => {
    expect(RecordQuickActionsProps.parse({ location: 'record_more' }).location).toBe('record_more');
    expect(RecordQuickActionsProps.safeParse({ location: 'toolbar' }).success).toBe(false);
    // The retired location keeps its retirement prescription — proof the row
    // rides the shared enum rather than a copy of its values.
    const message = messagesOf(RecordQuickActionsProps.safeParse({ location: 'global_nav' }));
    expect(message).toContain('global_nav');
  });

  it('vets `variant` / `size` against the Button primitive\'s delivered vocabulary', () => {
    expect(RecordQuickActionsProps.parse({ variant: 'outline', size: 'lg' }))
      .toEqual({ variant: 'outline', size: 'lg' });
    // Out-of-vocabulary values reach cva as no-ops (an unstyled button) —
    // refused at authoring time instead.
    expect(RecordQuickActionsProps.safeParse({ variant: 'primary' }).success).toBe(false);
    expect(RecordQuickActionsProps.safeParse({ size: 'xl' }).success).toBe(false);
  });

  it('materializes nothing for the silent author — no schema defaults', () => {
    // `record_header` / `end` / `default` / `sm` are the renderer's fallbacks.
    // NOTE the measured empty-bar truth: with no `actionNames` (and no host
    // actions) the renderer resolves NOTHING and renders its placeholder — it
    // does NOT fall back to "every action at this location", whatever the
    // registration's input list claims. The parse must not invent that claim
    // either.
    expect(RecordQuickActionsProps.parse({})).toEqual({});
  });
});

describe('ComponentPropsMap["record:history"] (#8744)', () => {
  it('accepts the registration\'s three presentation keys byte-identically', () => {
    const authored = { limit: 20, emptyText: 'No changes yet', unknownUserText: 'System' };
    expect(RecordHistoryProps.parse(authored)).toEqual(authored);
    expect(RecordHistoryProps.parse({})).toEqual({});
  });

  it('refuses the host data channel — `entries` / `loading` — with the self-fetch prescription', () => {
    const entriesMsg = messagesOf(RecordHistoryProps.safeParse({
      entries: [{ id: '1', action: 'updated', created_at: '2026-08-14T00:00:00Z' }],
    }));
    expect(entriesMsg).toContain('`entries`');
    expect(entriesMsg).toContain('sys_activity');
    const loadingMsg = messagesOf(RecordHistoryProps.safeParse({ loading: true }));
    expect(loadingMsg).toContain('`loading`');
    expect(loadingMsg).toContain('skeleton');
  });

  it('keeps `emptyText` / `unknownUserText` literal strings — the rail `title` verdict, re-measured', () => {
    // `HistoryTimeline` renders both as raw React children / bare-string
    // fallbacks; an inline locale map would paint `[object Object]`.
    expect(RecordHistoryProps.safeParse({
      emptyText: { en: 'No history yet', 'zh-CN': '暂无历史' },
    }).success).toBe(false);
  });

  it('rejects a non-positive or fractional `limit` rather than shipping it to `$top`', () => {
    for (const limit of [0, -1, 2.5]) {
      expect(RecordHistoryProps.safeParse({ limit }).success).toBe(false);
    }
  });
});

describe('the `record:discussion` / `record:chatter` pair (#8744)', () => {
  it('judges both names with one accept face', () => {
    const authored = { position: 'bottom', collapsible: false } as const;
    const viaChatter = ComponentPropsMap['record:chatter'].safeParse(authored);
    const viaDiscussion = ComponentPropsMap['record:discussion'].safeParse(authored);
    // Whatever the shared row's verdict, it is the SAME verdict — the palette
    // and the renderer treat the names as duplicates, and so does the map.
    expect(viaDiscussion.success).toBe(viaChatter.success);
  });

  it('now refuses an undeclared key on `record:discussion` — the fifth silent surface, closed', () => {
    const message = messagesOf(ComponentPropsMap['record:discussion'].safeParse({ dock: 'right' }));
    expect(message).toContain('`dock`');
  });

  it("both names accept the renderer's position vocabulary and refuse a retired spelling with ONE prescription (#8762)", () => {
    for (const type of ['record:chatter', 'record:discussion'] as const) {
      for (const position of ['bottom', 'right', 'left'] as const) {
        expect(ComponentPropsMap[type].safeParse({ position }).success).toBe(true);
      }
    }
    // The retired spelling gets the same per-value prescription through
    // either name — one schema object, one refusal (#8744 pair identity).
    const viaChatter = ComponentPropsMap['record:chatter'].safeParse({ position: 'sidebar' });
    const viaDiscussion = ComponentPropsMap['record:discussion'].safeParse({ position: 'sidebar' });
    expect(viaChatter.success).toBe(false);
    expect(viaDiscussion.success).toBe(false);
    if (!viaChatter.success && !viaDiscussion.success) {
      expect(viaChatter.error.issues[0]!.message).toBe(viaDiscussion.error.issues[0]!.message);
      expect(viaChatter.error.issues[0]!.message).toContain("'sidebar' was removed");
    }
  });
});

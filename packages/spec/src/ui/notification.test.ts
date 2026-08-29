import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { describe, it, expect } from 'vitest';
import {
  NotificationTypeSchema,
  NotificationSeveritySchema,
  NotificationPositionSchema,
  type NotificationType,
  type NotificationSeverity,
  type NotificationPosition,
} from './notification.zod';

describe('NotificationTypeSchema', () => {
  it('should accept all valid notification types', () => {
    const types = ['toast', 'snackbar', 'banner', 'alert', 'inline'] as const;
    types.forEach(type => {
      expect(() => NotificationTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid notification types', () => {
    expect(() => NotificationTypeSchema.parse('popup')).toThrow();
    expect(() => NotificationTypeSchema.parse('')).toThrow();
  });
});

describe('NotificationSeveritySchema', () => {
  it('should accept all valid severities', () => {
    const severities = ['info', 'success', 'warning', 'error'] as const;
    severities.forEach(severity => {
      expect(() => NotificationSeveritySchema.parse(severity)).not.toThrow();
    });
  });

  it('should reject invalid severities', () => {
    expect(() => NotificationSeveritySchema.parse('critical')).toThrow();
    expect(() => NotificationSeveritySchema.parse('')).toThrow();
  });
});

describe('NotificationPositionSchema', () => {
  it('should accept all valid positions', () => {
    const positions = ['top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right'] as const;
    positions.forEach(position => {
      expect(() => NotificationPositionSchema.parse(position)).not.toThrow();
    });
  });

  it('should reject invalid positions', () => {
    expect(() => NotificationPositionSchema.parse('center')).toThrow();
    expect(() => NotificationPositionSchema.parse('')).toThrow();
  });
});

// `NotificationActionSchema` had a describe block here until #5015 removed the
// schema (ADR-0049 enforce-or-remove — no carrier key, unreachable from every
// metadata root, zero parse outside this file). Its absence is pinned by symbol
// identity in `notification-embed-retirement.test.ts`, not by the silence here.

describe('Type exports', () => {
  it('should have valid type exports', () => {
    const type: NotificationType = 'toast';
    const severity: NotificationSeverity = 'info';
    const position: NotificationPosition = 'top_right';
    expect(type).toBeDefined();
    expect(severity).toBeDefined();
    expect(position).toBeDefined();
  });

  // Pin: this module no longer declares the bare Notification(Config) names.
  // The pin is compile-time (typeof import is type-level only — no runtime
  // barrel load): if either bare name is re-added here, the conditional type
  // flips to `true` and the `false` assignment fails `tsc --noEmit`. The bare
  // `Notification(Schema)` belongs to `@objectstack/spec/api` alone (#4610);
  // `NotificationConfig(Schema)` left the spec surface entirely.
  it('does not re-expose the bare Notification/NotificationConfig names from ./ui (#4610)', () => {
    type UiNotificationModule = typeof import('./notification.zod');
    const hasNotificationSchema: 'NotificationSchema' extends keyof UiNotificationModule
      ? true
      : false = false;
    const hasNotificationConfigSchema: 'NotificationConfigSchema' extends keyof UiNotificationModule
      ? true
      : false = false;
    expect(hasNotificationSchema).toBe(false);
    expect(hasNotificationConfigSchema).toBe(false);
  });
});

// ─── [#5781] The #4610 tombstone states the CORRECTED evidence ──────────────
//
// The names are gone, so #4610 left no runtime message to pin — the tombstone
// is the only place a reader learns WHY they went, and the reason it gave was
// false. objectui#3310 measured it at 17.0.0-rc.1: `packages/types/src/index.ts`
// re-exported both `./ui` names with `export … from '@objectstack/spec/ui'`, and
// `packages/core/src/protocols/NotificationProtocol.ts` consumed them through
// the `@object-ui/types` barrel in two public signatures. An
// import-statement-level scan sees neither hop — the third miss of that class,
// after #4667 / #4709 (`app.homePageId`).
//
// The pin is on the VERDICTS, never on the wording, for the reason #5337's
// rationale pin records: a tombstone that simply goes quiet about a claim leaves
// the reader holding it, so naming the old sentence in order to refute it is
// required, and only the tense-and-assertion may be pinned. Four verdicts:
// the evidence is corrected, the retirement is NOT reopened, `./api` is NOT a
// migration target, and the methodology lesson is written down where the next
// cross-repo liveness verdict gets made.
describe('[#5781] ./ui notification tombstone — corrected evidence, no false FROM → TO', () => {
  const SOURCE = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    'notification.zod.ts',
  );

  /**
   * The `#4610` note as PROSE: comment markers stripped and whitespace
   * collapsed, so an assertion cannot pass or fail on where a line happens to
   * wrap. Read out of the source rather than a generated artifact — the source
   * is what a reader of the module sees.
   */
  const tombstone = (() => {
    const source = fs.readFileSync(SOURCE, 'utf8');
    const start = source.indexOf('// [#4610]');
    return source
      .slice(start)
      .split('\n')
      .map((line) => line.replace(/^\s*\/\/ ?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  })();

  it('finds the #4610 note at all (anti-vacuity)', () => {
    expect(tombstone).toMatch(/^\[#4610\]/);
    expect(tombstone).toMatch(/NotificationConfigSchema/);
    expect(tombstone.length).toBeGreaterThan(800);
  });

  it('does not assert the ./ui wrappers had zero consumers', () => {
    // The exact sentence #4610 shipped, in the present-tense assertive form
    // objectui#3310 disproved. The note may still QUOTE the claim (and does) —
    // what it may not do is state it as fact.
    expect(tombstone).not.toMatch(/wrappers had ZERO consumers/i);
    expect(tombstone).not.toMatch(/equally consumer-free/i);
  });

  it('records the measured objectui consumers and both hops that hid them', () => {
    expect(tombstone).toMatch(/That was false for objectui/);
    expect(tombstone).toMatch(/objectui#3310/);
    expect(tombstone).toMatch(/export … from/);
    expect(tombstone).toMatch(/@object-ui\/types/);
    expect(tombstone).toMatch(/NotificationProtocol\.ts/);
  });

  it('⛔ does not read as reopening the retirement', () => {
    // Correcting the evidence is not an un-retirement. objectui followed the
    // removal (it deleted the bridge); a note that only said "the reason was
    // wrong" would invite the next reader to put the names back.
    expect(tombstone).toMatch(/retirement STANDS/);
    expect(tombstone).toMatch(/does not ask for the retirement back/);
    expect(tombstone).toMatch(/deleted the bridge to FOLLOW this retirement/);
  });

  it('refuses `./api` as the migration target, with the reason a reader can check', () => {
    // #4610 published FROM `./ui` → TO `./api`. It does not compile: same name,
    // disjoint contract. Pinning the VERDICT, not the absence of the arrow —
    // the note quotes the arrow in order to withdraw it.
    expect(tombstone).toMatch(/NO migration target/);
    expect(tombstone).toMatch(/does not compile/);
    expect(tombstone).toMatch(/shares ZERO fields/);
    // The survivors, counted — `NotificationAction` left at #5015, so a reader
    // told "the four ui enums" would go looking for one that is not there.
    expect(tombstone).toMatch(/three enums, not four/);
  });

  it('writes down the methodology so the fourth miss is not owed to it', () => {
    expect(tombstone).toMatch(/RESOLVED SYMBOL GRAPH/);
    expect(tombstone).toMatch(/barrel package/);
    expect(tombstone).toMatch(/ \//);
  });
});

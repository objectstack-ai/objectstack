// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Package-identifier input, used by the landing "duplicate package" form, the
 * package sheet's "duplicate" form and the create mode of the spec-driven
 * PackageFormDialog (objectui#11792). All three judge by the input's default
 * rule, the spec's id rule (objectui#11855).
 * Fixes the dogfood wizard findings (framework#2615 P2): illegal characters
 * are still normalized
 * away, but no longer silently — a notice says so — and while the value
 * doesn't parse as a package id yet, an inline hint spells out the
 * reverse-domain format instead of leaving the user staring at a disabled
 * create button.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { isSpecPackageId, sanitizePackageId } from './packages-io.js';
import { t, tFormat } from '../metadata-admin/i18n.js';

/**
 * The id rule an input judges by, with the two sentences that describe it to
 * the author. The verdict and its wording travel together on purpose: a host
 * that swaps the predicate but keeps the default sentences would show a hint
 * describing a rule the input no longer applies.
 */
export interface PackageIdRule {
  /** True when the trimmed value is an id this host will submit. */
  test: (id: string) => boolean;
  /** Shown while the value is non-empty and fails {@link PackageIdRule.test}. */
  formatHint: string;
  /** Shown after a keystroke whose illegal characters were removed. */
  strippedNotice: string;
}

/**
 * The spec's package-id rule ({@link isSpecPackageId}, the declaration the
 * server refuses by) with the two sentences that describe it: the input's
 * default, so every package-id form in this app judges by one rule in one
 * wording (objectui#11855).
 */
function specPackageIdRule(locale?: string): PackageIdRule {
  return {
    test: isSpecPackageId,
    formatHint: tFormat('engine.packages.idRule.formatHint', locale, { example: 'com.acme.crm' }),
    strippedNotice: t('engine.packages.idRule.strippedNotice', locale),
  };
}

export interface PackageIdInputProps {
  value: string;
  /** Receives the sanitized value on every keystroke. */
  onChange: (value: string) => void;
  onEnter?: () => void;
  onEscape?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  locale?: string;
  testId?: string;
  /** DOM id of the input, so a host's `<label htmlFor>` can name it. */
  id?: string;
  /**
   * The rule to judge by, and its wording (objectui#11792). Omitted → the
   * spec's id rule in its shared wording, {@link specPackageIdRule}, which is
   * what every form in this app judges by (objectui#11855).
   */
  rule?: PackageIdRule;
  /** Extra classes merged onto the input (a host sizing it to its own form). */
  inputClassName?: string;
}

export function PackageIdInput({
  value,
  onChange,
  onEnter,
  onEscape,
  placeholder,
  autoFocus,
  locale,
  testId,
  id,
  rule,
  inputClassName,
}: PackageIdInputProps): React.ReactElement {
  // "I typed something and it vanished" — show what was dropped until the
  // next clean keystroke.
  const [strippedNotice, setStrippedNotice] = React.useState(false);
  const active = rule ?? specPackageIdRule(locale);
  const invalid = value.trim().length > 0 && !active.test(value.trim());

  return (
    <div className="flex flex-col gap-1">
      <input
        id={id}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          const { value: next, stripped } = sanitizePackageId(e.target.value);
          setStrippedNotice(stripped);
          onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.();
          if (e.key === 'Escape') onEscape?.();
        }}
        placeholder={placeholder}
        data-testid={testId}
        className={cn(
          'h-7 w-full rounded-md border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-primary',
          inputClassName,
        )}
      />
      {strippedNotice && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400" data-testid="pkg-id-stripped">
          {active.strippedNotice}
        </p>
      )}
      {invalid && (
        <p className="text-[10px] text-muted-foreground" data-testid="pkg-id-format-hint">
          {active.formatHint}
        </p>
      )}
    </div>
  );
}

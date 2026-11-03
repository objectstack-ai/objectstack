// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The name prompt of the reader's own views (My views, `./personalViews.ts`):
 * Save as my view asks for a name, and Rename asks for a new one.
 *
 * The dialog writes nothing. It hands the trimmed name to `onSubmit` and waits:
 * it closes only when the save resolves `true`, and keeps the reader's input
 * when it resolves `false` (the caller has said why), as `CreateViewDialog`
 * does. An empty name cannot be submitted.
 */

import { useEffect, useId, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@object-ui/components';
import type { useObjectTranslation } from '@object-ui/i18n';

export interface PersonalViewNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dialog's title: Save as my view, or Rename. */
  title: string;
  /** The name the input opens with (the view's current name on a rename). */
  initialName: string;
  /** Save the name. Resolves whether it was saved; `false` keeps the dialog open. */
  onSubmit: (name: string) => Promise<boolean>;
  t: ReturnType<typeof useObjectTranslation>['t'];
}

export function PersonalViewNameDialog({ open, onOpenChange, title, initialName, onSubmit, t }: PersonalViewNameDialogProps) {
  const inputId = useId();
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Each opening starts from the name it was opened with.
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const trimmed = name.trim();
  const submit = async () => {
    if (!trimmed || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (await onSubmit(trimmed)) onOpenChange(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-testid="personal-view-name-dialog" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-2 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor={inputId}>{t('view.switcher.myViewName', { defaultValue: 'View name' })}</Label>
          <Input
            id={inputId}
            autoFocus
            value={name}
            maxLength={255}
            onChange={(e) => setName(e.target.value)}
            data-testid="personal-view-name-input"
          />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="personal-view-name-cancel">
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            disabled={!trimmed || submitting}
            onClick={() => void submit()}
            data-testid="personal-view-name-submit"
          >
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

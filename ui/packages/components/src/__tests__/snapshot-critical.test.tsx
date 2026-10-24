/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Snapshot Tests — Additional Critical UI Components
 *
 * Captures render snapshots of Alert, Dialog, Tabs, Accordion, Avatar,
 * Progress, Tooltip, Breadcrumb, Separator, and Skeleton to detect
 * unintended visual regressions.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
// This package's own entry is imported RELATIVELY, not as
// `@object-ui/components`. A package self-import resolves through the published
// `exports` map to `dist/index.d.ts`, and `components:type-check` has no
// dependency edge on this package's own build (turbo gives `type-check`
// `dependsOn: ["^build"]` — the DEPENDENCIES' builds), so on a cold CI cache
// that artifact does not exist yet and the specifier fails with TS2307
// (objectui#4801; PR #4789 paid for it once in `@object-ui/fields`).
// `tsconfig.test.json` used to carry a `paths` entry redirecting the name back
// to `src/index.ts` for exactly this reason; the relative specifier states the
// same thing in the file that means it, so that workaround is gone. Both
// spellings resolve to this source either way — the repo-root vitest config
// aliases the package name to `src` as well — so the snapshots are over the same
// modules. Mechanised by scripts/check-package-self-import.mjs.
import {
  Alert,
  AlertTitle,
  AlertDescription,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Progress,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Separator,
  Skeleton,
} from '../index';

// ─── Alert Snapshots ────────────────────────────────────────────────────

describe('Alert snapshots', () => {
  it('renders default alert with title and description', () => {
    const { container } = render(
      <Alert>
        <AlertTitle>Heads up!</AlertTitle>
        <AlertDescription>
          You can add components to your app using the CLI.
        </AlertDescription>
      </Alert>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders destructive alert with title and description', () => {
    const { container } = render(
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Your session has expired. Please log in again.
        </AlertDescription>
      </Alert>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Dialog Snapshots ───────────────────────────────────────────────────

describe('Dialog snapshots', () => {
  it('renders open dialog structure', () => {
    const { baseElement } = render(
      <Dialog open>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Make changes to your profile here.
            </DialogDescription>
          </DialogHeader>
          <p>Dialog body content</p>
          <DialogFooter>
            <button type="submit">Save changes</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(baseElement).toMatchSnapshot();
  });
});

// ─── Tabs Snapshots ─────────────────────────────────────────────────────

describe('Tabs snapshots', () => {
  it('renders tabs with multiple panels', () => {
    const { container } = render(
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Account settings here.</TabsContent>
        <TabsContent value="password">Change your password.</TabsContent>
        <TabsContent value="settings">App settings here.</TabsContent>
      </Tabs>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders tabs with second tab active', () => {
    const { container } = render(
      <Tabs defaultValue="password">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Account settings.</TabsContent>
        <TabsContent value="password">Password settings.</TabsContent>
      </Tabs>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Accordion Snapshots ────────────────────────────────────────────────

describe('Accordion snapshots', () => {
  it('renders accordion with multiple items', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Is it accessible?</AccordionTrigger>
          <AccordionContent>
            Yes. It adheres to the WAI-ARIA design pattern.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Is it styled?</AccordionTrigger>
          <AccordionContent>
            Yes. It comes with default styles that match the design system.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-3">
          <AccordionTrigger>Is it animated?</AccordionTrigger>
          <AccordionContent>
            Yes. It uses CSS animations for smooth transitions.
          </AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders accordion with first item expanded', () => {
    const { container } = render(
      <Accordion type="single" defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Section One</AccordionTrigger>
          <AccordionContent>Content for section one.</AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Section Two</AccordionTrigger>
          <AccordionContent>Content for section two.</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Avatar Snapshots ───────────────────────────────────────────────────

describe('Avatar snapshots', () => {
  it('renders avatar with image and fallback', () => {
    const { container } = render(
      <Avatar>
        <AvatarImage src="https://example.com/avatar.png" alt="User avatar" />
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders avatar with fallback only', () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Progress Snapshots ─────────────────────────────────────────────────

describe('Progress snapshots', () => {
  it('renders progress at 0%', () => {
    const { container } = render(<Progress value={0} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders progress at 50%', () => {
    const { container } = render(<Progress value={50} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders progress at 100%', () => {
    const { container } = render(<Progress value={100} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Tooltip Snapshots ──────────────────────────────────────────────────

describe('Tooltip snapshots', () => {
  it('renders tooltip trigger', () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button>Hover me</button>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Breadcrumb Snapshots ───────────────────────────────────────────────

describe('Breadcrumb snapshots', () => {
  it('renders multi-level breadcrumb', () => {
    const { container } = render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/products">Products</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current Page</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Separator Snapshots ────────────────────────────────────────────────

describe('Separator snapshots', () => {
  it('renders horizontal separator', () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders vertical separator', () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Skeleton Snapshots ─────────────────────────────────────────────────

describe('Skeleton snapshots', () => {
  it('renders default skeleton', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders skeleton with text line dimensions', () => {
    const { container } = render(<Skeleton className="h-4 w-[250px]" />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders skeleton with circular avatar dimensions', () => {
    const { container } = render(<Skeleton className="h-12 w-12 rounded-full" />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders skeleton loading card layout', () => {
    const { container } = render(
      <div className="flex flex-col space-y-3">
        <Skeleton className="h-[125px] w-[250px] rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

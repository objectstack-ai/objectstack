// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * /projects/$projectId — project overview (index).
 *
 * Default landing surface when the user selects a project. Shows a
 * snapshot of the project record: identity, database addressing,
 * membership, and the current active credential (metadata only, never
 * the ciphertext).
 */

import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  Database,
  Users,
  KeyRound,
  RefreshCw,
  RotateCw,
  Trash,
  AlertTriangle,
  Loader2,
  Package,
  Globe,
  Pencil,
  Check,
  X,
  History,
  Eye,
  Lock,
  Copy,
  GitCommit,
  Server,
  ExternalLink,
  Building2,
  Terminal,
  ChevronRight,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { ProjectStatusBadge } from '@/components/project-status-badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useProjectDetail,
  useRetryProvisioning,
  useUpdateHostname,
  useDeleteProject,
  useUpdateVisibility,
  useRevisions,
} from '@/hooks/useProjects';
import { useEnvAwarePackages } from '@/hooks/useProjectAwarePackages';
import { useClient } from '@objectstack/client-react';
import { useProductionGuard } from '@/components/production-guard';
import { toast } from '@/hooks/use-toast';
import { isPlatformProject } from '@/lib/platform-project';
import { PlatformOverview } from '@/components/platform-overview';

function ProjectOverviewComponent() {
  const { projectId } = useParams({
    from: '/projects/$projectId',
  });
  // Platform pseudo-project has its own overview surface — bail early so the
  // rest of the hook chain (useProjectDetail, deletion guards, etc.) never
  // runs for an id that doesn't correspond to a real project row.
  if (isPlatformProject(projectId)) {
    return <PlatformOverview />;
  }
  return <RealProjectOverview projectId={projectId} />;
}

function RealProjectOverview({ projectId }: { projectId: string }) {
  const { detail, loading, reload } = useProjectDetail(projectId);
  const { items: revisions, loading: revisionsLoading } = useRevisions(projectId);
  const { packages } = useEnvAwarePackages(projectId);
  const client = useClient() as any;
  const navigate = useNavigate();
  const guard = useProductionGuard();
  const [rotating, setRotating] = useState(false);
  const { retry, retrying } = useRetryProvisioning();
  const { updateHostname, updating: hostnameUpdating } = useUpdateHostname();
  const { updateVisibility, updating: visibilityUpdating } = useUpdateVisibility();
  const { remove: deleteProject, deleting } = useDeleteProject();
  const [hostnameEditing, setHostnameEditing] = useState(false);
  const [hostnameInput, setHostnameInput] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const project = detail?.project;
  const provisioningError =
    (project?.metadata as Record<string, any> | undefined)?.provisioningError as
      | { message?: string; failedAt?: string }
      | undefined;
  const visibility = ((project as any)?.visibility ?? 'private') as
    | 'private'
    | 'unlisted'
    | 'public';
  const currentRevision = useMemo(
    () => revisions.find((r) => r.isCurrent) ?? revisions[0] ?? null,
    [revisions],
  );
  const recentRevisions = revisions.slice(0, 3);
  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const apiBase = `${baseOrigin}/api/v1`;
  const studioUrl = `${baseOrigin}/_studio/projects/${projectId}`;
  const publicArtifactUrl =
    visibility === 'private'
      ? null
      : `${baseOrigin}/api/v1/pub/v1/projects/${projectId}/artifact`;
  const cliPublishCmd = `OS_CLOUD_URL=${baseOrigin} OS_PROJECT_ID=${projectId} objectstack publish`;

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied`, description: value });
    } catch (err) {
      toast({
        title: 'Copy failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleRetry = async () => {
    if (!project) return;
    try {
      const result = await retry(project.id);
      const nextStatus = (result as any)?.project?.status;
      if (nextStatus === 'active') {
        toast({
          title: 'Provisioning complete',
          description: 'The project is now active and ready to use.',
        });
      } else if (nextStatus === 'failed') {
        toast({
          title: 'Retry failed',
          description:
            (result as any)?.project?.metadata?.provisioningError?.message ??
            'Provisioning failed again. Check server logs.',
          variant: 'destructive',
        });
      }
      await reload();
    } catch (err) {
      toast({
        title: 'Retry failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleHostnameSave = async () => {
    if (!project) return;
    try {
      await updateHostname(project.id, hostnameInput);
      toast({ title: 'Hostname updated', description: `Bound to ${hostnameInput}` });
      setHostnameEditing(false);
      await reload();
    } catch (err) {
      toast({ title: 'Failed to update hostname', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleRotate = async () => {
    if (!project) return;
    const ok = await guard.confirm({
      title: 'Rotate production credential?',
      description:
        'A new credential will be issued and propagated to all runtimes. In-flight requests using the old credential may briefly fail until rollout completes.',
      confirmLabel: 'Rotate credential',
      confirmVariant: 'destructive',
      requireTypedConfirmation: true,
      typedConfirmationValue: project.display_name,
    });
    if (!ok) return;
    setRotating(true);
    try {
      const newToken =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `tok_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      await client?.projects?.rotateCredential?.(project.id, newToken);
      toast({
        title: 'Credential rotation started',
        description: 'The new credential will propagate to all runtimes.',
      });
    } catch (err) {
      toast({
        title: 'Rotation failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setRotating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!project) return;
    if (deleteConfirmText !== project.display_name) {
      toast({
        title: 'Confirmation does not match',
        description: `Type "${project.display_name}" to confirm deletion.`,
        variant: 'destructive',
      });
      return;
    }
    try {
      const result = await deleteProject(project.id, { force: project.is_default });
      const warnings = (result as any)?.warnings as string[] | undefined;
      toast({
        title: 'Project deleted',
        description: warnings?.length
          ? `Completed with warnings: ${warnings[0]}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}`
          : `${project.display_name} and its database have been removed.`,
        variant: warnings?.length ? 'destructive' : undefined,
      });
      setDeleteDialogOpen(false);
      setDeleteConfirmText('');
      navigate({ to: '/projects' });
    } catch (err) {
      toast({
        title: 'Failed to delete project',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
          {loading && !project && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}

          {project && (
            <>
              {/* Breadcrumb */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {detail?.organization && (
                  <>
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{detail.organization.displayName ?? detail.organization.name}</span>
                    <ChevronRight className="h-3 w-3" />
                  </>
                )}
                <Link to="/projects" className="hover:text-foreground">Projects</Link>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground">{project.display_name}</span>
              </div>

              {/* Hero */}
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="truncate text-3xl font-semibold tracking-tight">
                      {project.display_name}
                    </h1>
                    {project.is_default && <Badge variant="outline">default</Badge>}
                    <ProjectStatusBadge status={project.status} />
                    <VisibilityControl
                      projectId={project.id}
                      value={(project as any).visibility ?? 'private'}
                      onChanged={() => reload()}
                      updating={visibilityUpdating}
                      update={updateVisibility}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{project.id}</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(project.id, 'Project ID')}
                      className="inline-flex items-center gap-1 rounded p-1 hover:bg-muted hover:text-foreground"
                      title="Copy project ID"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <span>·</span>
                    <span>Plan {project.plan ?? 'free'}</span>
                    {project.created_at && (
                      <>
                        <span>·</span>
                        <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reload()}
                    disabled={loading}
                    className="gap-2"
                    title="Refresh project status"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => navigate({
                      to: '/projects/$projectId/packages',
                      params: { projectId: project.id },
                    })}
                    disabled={project.status !== 'active'}
                  >
                    <Package className="h-3.5 w-3.5" />
                    Packages
                  </Button>
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() => navigate({
                      to: '/projects/$projectId/revisions',
                      params: { projectId: project.id },
                    })}
                    title="View published artifact revisions"
                  >
                    <History className="h-3.5 w-3.5" />
                    Revisions
                  </Button>
                </div>
              </div>

              {/* Status banners */}
              {project.status === 'provisioning' && (
                <Card className="flex items-start gap-3 border-sky-500/40 bg-sky-500/5 p-4">
                  <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-sky-600" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-sky-700 dark:text-sky-300">
                      Provisioning in progress
                    </p>
                    <p className="text-muted-foreground">
                      We&rsquo;re allocating the physical database and minting credentials. This
                      normally takes a few seconds — click Refresh to check the latest status.
                    </p>
                  </div>
                </Card>
              )}

              {project.status === 'failed' && (
                <Card className="flex items-start gap-3 border-red-500/40 bg-red-500/5 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-red-700 dark:text-red-300">
                      Provisioning failed
                    </p>
                    <p className="text-muted-foreground">
                      {provisioningError?.message ??
                        'The project could not be provisioned. Retry to run the driver handshake again.'}
                    </p>
                    {provisioningError?.failedAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Last attempt: {new Date(provisioningError.failedAt).toLocaleString()}
                      </p>
                    )}
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={handleRetry}
                        disabled={retrying}
                        className="gap-2"
                      >
                        <RotateCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
                        {retrying ? 'Retrying…' : 'Retry provisioning'}
                      </Button>
                    </div>
                  </div>
                </Card>
              )}

              {/* At-a-glance stats */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <GitCommit className="h-3.5 w-3.5" />
                    Current commit
                  </div>
                  <div className="mt-2 truncate font-mono text-sm font-medium">
                    {currentRevision ? currentRevision.commitId.slice(0, 12) : '—'}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {currentRevision?.publishedAt
                      ? `Published ${new Date(currentRevision.publishedAt).toLocaleDateString()}`
                      : 'No artifact published yet'}
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Visibility
                  </div>
                  <div className="mt-2 text-sm font-medium capitalize">{visibility}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {visibility === 'public'
                      ? 'Discoverable & artifact public'
                      : visibility === 'unlisted'
                      ? 'Hidden but artifact public'
                      : 'Org members only'}
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    Your role
                  </div>
                  <div className="mt-2 text-sm font-medium capitalize">
                    {detail?.membership?.role ?? '—'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {detail?.organization
                      ? `In ${detail.organization.displayName ?? detail.organization.name}`
                      : 'Membership unavailable'}
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Layers className="h-3.5 w-3.5" />
                    Packages
                  </div>
                  <div className="mt-2 text-sm font-medium">
                    {packages.length}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {packages.length === 0 ? 'None installed' : 'Installed in this project'}
                  </div>
                </Card>
              </div>

              {/* URLs panel */}
              <Card className="p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Endpoints
                </h2>
                <div className="space-y-2.5">
                  <UrlRow
                    label="Studio"
                    value={studioUrl}
                    onCopy={() => copyToClipboard(studioUrl, 'Studio URL')}
                  />
                  <UrlRow
                    label="API base"
                    value={apiBase}
                    onCopy={() => copyToClipboard(apiBase, 'API base URL')}
                  />
                  {publicArtifactUrl && (
                    <UrlRow
                      label="Public artifact"
                      value={publicArtifactUrl}
                      onCopy={() => copyToClipboard(publicArtifactUrl, 'Public artifact URL')}
                      external
                    />
                  )}
                  <div className="rounded-md border bg-muted/40 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <Terminal className="h-3.5 w-3.5" />
                        Publish from CLI
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(cliPublishCmd, 'Publish command')}
                        className="inline-flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Copy command"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                    <code className="block break-all font-mono text-xs">{cliPublishCmd}</code>
                  </div>
                </div>
              </Card>

              {/* Main 2-col grid */}
              <div className="grid gap-6 lg:grid-cols-3">
                {/* Left column — operational data */}
                <div className="space-y-6 lg:col-span-2">
                  {/* Recent revisions */}
                  <Card className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <GitCommit className="h-3.5 w-3.5" />
                        Recent revisions
                      </h2>
                      <Link
                        to="/projects/$projectId/revisions"
                        params={{ projectId: project.id }}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        View all
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    </div>
                    {revisionsLoading && recentRevisions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Loading revisions…</p>
                    ) : recentRevisions.length === 0 ? (
                      <div className="rounded-md border border-dashed p-6 text-center">
                        <p className="text-sm text-muted-foreground">No artifacts published yet.</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Use the CLI command above to publish your first artifact.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {recentRevisions.map((r) => (
                          <div
                            key={r.commitId}
                            className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-muted/40"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <code className="font-mono text-sm">{r.commitId.slice(0, 12)}</code>
                                {r.isCurrent && <Badge variant="secondary" className="text-[10px]">current</Badge>}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {r.publishedBy ? `${r.publishedBy} · ` : ''}
                                {r.publishedAt ? new Date(r.publishedAt).toLocaleString() : '—'}
                                {r.note ? ` · ${r.note}` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(r.commitId, 'Commit ID')}
                              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Copy commit ID"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  {/* Database */}
                  <Card className="p-5">
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      <Database className="h-3.5 w-3.5" />
                      Database
                    </h2>
                    {detail?.database ? (
                      <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                        <dt className="text-muted-foreground">Driver</dt>
                        <dd>
                          <code className="font-mono">{detail.database.driver}</code>
                        </dd>
                        <dt className="text-muted-foreground">Physical name</dt>
                        <dd>
                          <code className="font-mono text-xs">{detail.database.database_name}</code>
                        </dd>
                        <dt className="text-muted-foreground">Storage quota</dt>
                        <dd>
                          {detail.database.storage_limit_mb && detail.database.storage_limit_mb > 0
                            ? `${detail.database.storage_limit_mb} MB`
                            : 'Unlimited'}
                        </dd>
                        {detail.database.provisioned_at && (
                          <>
                            <dt className="text-muted-foreground">Provisioned</dt>
                            <dd>
                              {new Date(detail.database.provisioned_at).toLocaleString()}
                            </dd>
                          </>
                        )}
                      </dl>
                    ) : (
                      <p className="text-sm text-muted-foreground">Database is still provisioning…</p>
                    )}
                  </Card>

                  {/* Domains */}
                  <Card className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <Globe className="h-3.5 w-3.5" />
                        Domains
                      </h2>
                      {!hostnameEditing && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2"
                          onClick={() => {
                            setHostnameInput(project.hostname ?? '');
                            setHostnameEditing(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      )}
                    </div>
                    {hostnameEditing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          className="h-8 font-mono text-sm"
                          value={hostnameInput}
                          onChange={(e) => setHostnameInput(e.target.value)}
                          placeholder="my-project.example.com"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleHostnameSave();
                            if (e.key === 'Escape') setHostnameEditing(false);
                          }}
                        />
                        <Button size="sm" variant="default" onClick={handleHostnameSave} disabled={hostnameUpdating} className="gap-1">
                          <Check className="h-3.5 w-3.5" />
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setHostnameEditing(false)} className="gap-1">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : project.hostname ? (
                      <code className="font-mono text-sm">{project.hostname}</code>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No custom hostname bound. Click <span className="font-medium">Edit</span> to set one.
                      </p>
                    )}
                  </Card>
                </div>

                {/* Right column — meta */}
                <div className="space-y-6">
                  {/* Project info */}
                  <Card className="p-5">
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      <Server className="h-3.5 w-3.5" />
                      Project info
                    </h2>
                    <dl className="space-y-2.5 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Plan</dt>
                        <dd className="font-medium capitalize">{project.plan ?? 'free'}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Created</dt>
                        <dd>{project.created_at ? new Date(project.created_at).toLocaleDateString() : '—'}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Updated</dt>
                        <dd>{project.updated_at ? new Date(project.updated_at).toLocaleDateString() : '—'}</dd>
                      </div>
                      {detail?.organization && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Organization</dt>
                          <dd className="truncate font-medium">
                            {detail.organization.displayName ?? detail.organization.name}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </Card>

                  {/* Credential */}
                  <Card className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <KeyRound className="h-3.5 w-3.5" />
                        Credential
                      </h2>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRotate}
                        disabled={rotating || project.status !== 'active'}
                        className="gap-2"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${rotating ? 'animate-spin' : ''}`} />
                        Rotate
                      </Button>
                    </div>
                    {detail?.credential ? (
                      <dl className="space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-muted-foreground">Status</dt>
                          <dd>
                            <Badge variant="secondary">{detail.credential.status}</Badge>
                          </dd>
                        </div>
                        <div>
                          <dt className="mb-1 text-xs text-muted-foreground">Credential ID</dt>
                          <dd>
                            <code className="block break-all font-mono text-xs">
                              {detail.credential.id}
                            </code>
                          </dd>
                        </div>
                        {detail.credential.activatedAt && (
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">Activated</dt>
                            <dd className="text-xs">
                              {new Date(detail.credential.activatedAt).toLocaleDateString()}
                            </dd>
                          </div>
                        )}
                      </dl>
                    ) : (
                      <p className="text-sm text-muted-foreground">No credential metadata available.</p>
                    )}
                  </Card>
                </div>
              </div>

              <Separator />

              {/* Danger zone */}
              <Card className="border-destructive/40 p-5">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Danger zone
                </h2>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-medium">Delete this project</p>
                    <p className="text-muted-foreground">
                      Once deleted, the project, its credentials, members, package
                      installations, and the underlying database are gone forever.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2 self-start sm:self-auto"
                    disabled={deleting}
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash className="h-3.5 w-3.5" />
                    Delete project
                  </Button>
                </div>
              </Card>
            </>
          )}
          </div>
        </div>

        {/* Delete Project Dialog (GitHub/Vercel-style typed confirmation) */}
        <Dialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            if (deleting) return;
            setDeleteDialogOpen(open);
            if (!open) setDeleteConfirmText('');
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Delete project
              </DialogTitle>
              <DialogDescription>
                This action <strong>cannot be undone</strong>. This will permanently
                delete the <strong>{project?.display_name}</strong> project, its
                credentials, members, package installations, and the underlying
                physical database.
              </DialogDescription>
            </DialogHeader>

            {project && (
              <div className="my-2 space-y-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Project</span>
                  <span className="font-medium">{project.display_name}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">ID</span>
                  <code className="break-all font-mono">{project.id}</code>
                </div>
                {project.database_url && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground">Database</span>
                    <code className="break-all font-mono">{project.database_url}</code>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="delete-project-confirm">
                Please type{' '}
                <code className="font-mono text-xs">{project?.display_name}</code>{' '}
                to confirm.
              </Label>
              <Input
                id="delete-project-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={project?.display_name ?? ''}
                autoComplete="off"
                autoFocus
                disabled={deleting}
              />
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setDeleteConfirmText('');
                }}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={
                  deleting ||
                  !project ||
                  deleteConfirmText !== project.display_name
                }
              >
                {deleting ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  'I understand, delete this project'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </main>
  );
}

export const Route = createFileRoute('/projects/$projectId/')({
  component: ProjectOverviewComponent,
});

function UrlRow({
  label,
  value,
  onCopy,
  external,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  external?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
      <div className="w-28 shrink-0 text-xs font-medium text-muted-foreground">{label}</div>
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      {external && (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Open in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Copy"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function VisibilityControl({
  projectId,
  value,
  onChanged,
  updating,
  update,
}: {
  projectId: string;
  value: 'private' | 'unlisted' | 'public';
  onChanged: () => void;
  updating: boolean;
  update: (id: string, v: 'private' | 'unlisted' | 'public') => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const handleChange = async (next: string) => {
    const v = next as 'private' | 'unlisted' | 'public';
    if (v === value) {
      setEditing(false);
      return;
    }
    try {
      await update(projectId, v);
      toast({
        title: 'Visibility updated',
        description: `Project is now ${v}.`,
      });
      onChanged();
    } catch (err) {
      toast({
        title: 'Update failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setEditing(false);
    }
  };
  const variant =
    value === 'public' ? 'default' : value === 'unlisted' ? 'secondary' : 'outline';
  if (editing) {
    return (
      <Select value={value} onValueChange={handleChange} disabled={updating}>
        <SelectTrigger className="h-7 w-[120px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="private">Private</SelectItem>
          <SelectItem value="unlisted">Unlisted</SelectItem>
          <SelectItem value="public">Public</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex items-center"
      title="Click to change visibility"
    >
      <Badge variant={variant} className="cursor-pointer gap-1 text-xs">
        {value === 'public' ? (
          <Eye className="h-3 w-3" />
        ) : value === 'unlisted' ? (
          <Globe className="h-3 w-3" />
        ) : (
          <Lock className="h-3 w-3" />
        )}
        {value}
      </Badge>
    </button>
  );
}

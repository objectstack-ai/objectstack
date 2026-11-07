// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os mcp connect` — register your environment's MCP server with your MCP
 * client in one command. The client then runs the environment's own OAuth.
 *
 * ## Which server
 *
 * The environment `os deploy` deploys to, resolved by the same function
 * (`resolveInstallTarget`): `--env`, then the active environment recorded for
 * this control plane, then your organization's only environment. None or
 * several is a refusal naming `--env`, exactly as deploy refuses. Its URL is
 * the control plane's environment read (`readCloudEnvironment`, the read
 * deploy's wait uses for the environment's origin) plus {@link MCP_ENDPOINT_PATH}.
 * `--url` skips the control plane: a self-hosted server or a local `os dev`.
 *
 * ## Which name
 *
 * The environment's own (its slug, else its display name, else its id), made
 * safe for a client's server name, so several environments can be registered
 * side by side. A `--url` server is named {@link OBJECTSTACK_MCP_SERVER_NAME},
 * the name `os dev`'s banner and the served `SKILL.md` give it, so a local
 * server is never registered twice under two names. `--name` overrides both.
 *
 * ## No token, anywhere
 *
 * ⛔ The command stores no MCP token and writes none into a client config.
 * It hands the client the URL alone; on first use the client follows the
 * environment's OAuth discovery, registers itself, and the browser shows the
 * environment's sign-in and consent. A token copied into a config file would
 * expire within the hour, skip the client's refresh, and outlive a revoked
 * grant. Reusing the CLI's ObjectOS Cloud login for that consent is out of
 * scope: it waits on the decision whether the control plane becomes the one
 * authorization server for the CLI and MCP.
 *
 * ## Which client
 *
 * Claude Code, by running `claude mcp add --transport http NAME URL`
 * ({@link claudeMcpAddArgs}, the one spelling `os dev`'s banner prints too).
 * `--print` prints that line and the endpoint and runs nothing, which is also
 * how to connect any other client: add the endpoint as a remote HTTP MCP server
 * in its own settings.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { Command, Flags } from '@oclif/core';
import { OBJECTSTACK_MCP_SERVER_NAME } from '@objectstack/mcp';
import { printError, printHeader, printStep, printSuccess, isExitSignal } from '../../utils/format.js';
import { DEFAULT_CLOUD_URL, resolveCloudCredential } from '../../utils/cloud-config.js';
import { describeEnvironment, resolveInstallTarget } from '../../utils/install-target.js';
import { readCloudEnvironment } from '../../utils/served-version.js';

/** Where every ObjectStack server mounts its MCP endpoint. */
export const MCP_ENDPOINT_PATH = '/api/v1/mcp';

/** The clients this command can register with. */
export const MCP_CLIENTS = ['claude-code'] as const;

/** A server name every client accepts: letters, digits, `-` and `_`. */
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** `claude`'s arguments that register `url` as the remote HTTP MCP server `name`. */
export function claudeMcpAddArgs(name: string, url: string): string[] {
  return ['mcp', 'add', '--transport', 'http', name, url];
}

/** The `claude mcp add` line, as `os dev`'s banner and this command print it. */
export function claudeMcpAddLine(name: string, url: string): string {
  return ['claude', ...claudeMcpAddArgs(name, url)].join(' ');
}

/**
 * The environment's name as a client's server name: its slug, else its
 * display name, else its id, lower-cased with every run of other characters
 * turned into one `-`. A value with nothing left (a display name in another
 * script) falls through to the next.
 */
export function environmentServerName(env: { id: string; slug?: string; displayName?: string }): string {
  for (const candidate of [env.slug, env.displayName, env.id]) {
    const safe = (candidate ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (safe) return safe;
  }
  return OBJECTSTACK_MCP_SERVER_NAME;
}

/**
 * `--url` as a server base URL: `http(s)://host[:port][/prefix]`, with no
 * query and no fragment. The MCP path is added here, so a URL that already
 * ends in it is refused rather than doubled.
 */
export function mcpUrlFromBase(raw: string): { ok: true; mcpUrl: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, reason: `\`--url ${raw}\` is not a URL. Pass the server's base URL, such as http://localhost:3000.` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `\`--url\` must be an http or https URL, not ${parsed.protocol}` };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, reason: '`--url` takes the server\'s base URL, with no query or fragment.' };
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path === MCP_ENDPOINT_PATH || path.endsWith(MCP_ENDPOINT_PATH)) {
    return {
      ok: false,
      reason: `\`--url\` takes the server's base URL; this command adds ${MCP_ENDPOINT_PATH} itself. Pass ${parsed.origin}${path.slice(0, -MCP_ENDPOINT_PATH.length)}.`,
    };
  }
  return { ok: true, mcpUrl: `${parsed.origin}${path}${MCP_ENDPOINT_PATH}` };
}

/** Runs a client's own CLI. A seam, so a test can stand in for `claude`. */
export const mcpClientRunner = {
  run(command: string, args: string[]): SpawnSyncReturns<Buffer> {
    // `claude` is a `.cmd` shim on Windows, which only a shell resolves.
    return spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  },
};

export default class McpConnect extends Command {
  static override description =
    "Register your environment's MCP server with your MCP client (Claude Code); the client then runs the environment's own sign-in and consent";

  static override examples = [
    '$ os mcp connect',
    '$ os mcp connect --print                     # print the endpoint and the `claude mcp add` line, run nothing',
    '$ os mcp connect --env env_abc123            # your account reaches several environments',
    '$ os mcp connect --url http://localhost:3000 # a self-hosted or local server',
  ];

  static override flags = {
    env: Flags.string({
      description:
        'Environment id to connect to. Defaults to the environment `os environments switch` recorded '
        + "for this control plane, then to your organization's only environment",
      env: 'OS_ENVIRONMENT_ID',
    }),
    url: Flags.string({
      description: 'Base URL of a self-hosted or local server (e.g. http://localhost:3000); skips ObjectOS Cloud',
    }),
    name: Flags.string({
      description: "Server name in the client (default: the environment's name; `objectstack` with --url)",
    }),
    client: Flags.string({
      description: 'MCP client to register with. For any other client, use --print and add the endpoint in its settings',
      options: [...MCP_CLIENTS],
      default: 'claude-code',
    }),
    print: Flags.boolean({
      description: 'Print the endpoint and the command that registers it; run nothing',
      default: false,
    }),
    server: Flags.string({
      char: 's',
      description: 'ObjectOS Cloud control-plane URL (override for self-hosted control planes)',
      env: 'OS_CLOUD_URL',
      default: DEFAULT_CLOUD_URL,
    }),
    token: Flags.string({
      char: 't',
      description: 'API key for ObjectOS Cloud (bearer token; defaults to OS_CLOUD_API_KEY / OS_TOKEN, then `os cloud login`). Used only to find the environment; never handed to the MCP client',
      env: 'OS_CLOUD_API_KEY',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(McpConnect);
    printHeader('MCP connect');

    try {
      if (flags.name !== undefined && !SERVER_NAME.test(flags.name)) {
        printError(`\`--name ${flags.name}\` is not a server name: use letters, digits, \`-\` and \`_\` only.`);
        this.exit(1);
        return;
      }

      let mcpUrl: string;
      let name: string;
      let where: string;
      if (flags.url !== undefined) {
        const local = mcpUrlFromBase(flags.url);
        if (!local.ok) {
          printError(local.reason);
          this.exit(1);
          return;
        }
        mcpUrl = local.mcpUrl;
        name = flags.name ?? OBJECTSTACK_MCP_SERVER_NAME;
        where = new URL(mcpUrl).origin;
      } else {
        const { token, baseUrl } = await resolveCloudCredential({ token: flags.token, server: flags.server });
        if (!token) {
          printError(
            'Not logged in to ObjectOS Cloud. Run `os cloud login` first, then `os mcp connect` again '
            + '(or pass `--url` for a self-hosted or local server).',
          );
          this.exit(1);
          return;
        }
        const target = await resolveInstallTarget({
          subject: '`os mcp connect`',
          purpose: 'to connect to',
          explicit: flags.env,
          baseUrl,
          token,
          timeoutMs: 30_000,
        });
        if (target.kind === 'refused') {
          printError(target.message);
          this.exit(1);
          return;
        }
        const env = await readCloudEnvironment({ baseUrl, token, environmentId: target.environmentId });
        const displayName = target.displayName ?? (env.ok ? env.displayName : undefined);
        where = describeEnvironment({ id: target.environmentId, displayName });
        if (!env.ok) {
          printError(
            `${where}'s address could not be read from ${baseUrl}`
            + `${env.status ? ` (${env.status})` : ''}: ${env.error}. Nothing was registered.`,
          );
          this.exit(1);
          return;
        }
        if (!env.origin) {
          printError(
            `${baseUrl} reports no hostname for ${where}, so it has no MCP URL to register. `
            + 'Open the environment in the ObjectOS Cloud console to check it is provisioned. Nothing was registered.',
          );
          this.exit(1);
          return;
        }
        mcpUrl = `${env.origin}${MCP_ENDPOINT_PATH}`;
        name = flags.name ?? environmentServerName({ id: target.environmentId, slug: env.slug, displayName });
        printStep(
          target.source === 'only'
            ? `Connecting to ${where}, your organization's only environment`
            : `Connecting to ${where}`,
        );
      }

      const line = claudeMcpAddLine(name, mcpUrl);
      console.log(`  Endpoint  ${mcpUrl}`);
      console.log(`  Name      ${name}`);
      console.log(`  Connect   ${line}`);

      if (!flags.print) {
        console.log('');
        printStep(`Registering ${name} with Claude Code...`);
        const ran = mcpClientRunner.run('claude', claudeMcpAddArgs(name, mcpUrl));
        if (ran.error) {
          const missing = (ran.error as NodeJS.ErrnoException).code === 'ENOENT';
          printError(
            missing
              ? 'Claude Code\'s `claude` command was not found on your PATH. Install Claude Code, then run the Connect line above '
                + '(or `os mcp connect` again). For another client, add the Endpoint above as a remote HTTP MCP server in its settings.'
              : `\`claude\` could not be started: ${ran.error.message}. Run the Connect line above yourself.`,
          );
          this.exit(1);
          return;
        }
        if (ran.status !== 0) {
          printError(
            `\`claude mcp add\` exited ${ran.status ?? `on ${ran.signal}`}; its reason is above. `
            + `If ${name} is already registered, remove it with \`claude mcp remove ${name}\` or pick another --name.`,
          );
          this.exit(ran.status || 1);
          return;
        }
        printSuccess(`Registered ${name} with Claude Code.`);
      }

      console.log('');
      console.log(
        `  Sign-in   In Claude Code, run /mcp and authenticate ${name}: your browser shows ${where}'s sign-in and consent. `
        + 'This command stored no token.',
      );
      console.log(
        `  Revoke    In ${where}'s console: Account → Connect an AI Assistant → your authorized assistants → Revoke.`,
      );
      console.log(
        '  Model     MCP reads the environment for context. A managed package\'s content changes through its source '
        + 'and `os deploy`, not through MCP.',
      );
    } catch (error) {
      if (isExitSignal(error)) throw error;
      printError((error as Error).message);
      this.exit(1);
    }
  }
}

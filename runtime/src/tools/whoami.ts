import type { ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';
import { serverIdentity } from '../lib/server-identity.js';

const whoami: ToolDefinition = {
  name: 'zotero_whoami',
  title: 'Zotero identity & access',
  description:
    'Resolve the current Zotero identity (userID, username, display name) and per-library access scopes from the configured API key, and report which library backends are available (cloud Web API and/or the desktop local API). Call this first to discover the userID — never ask the user to type a numeric ID. If no API key is configured, the server runs in local-only read mode against the desktop library (users/0). Also reports this tool server\'s own identity — name (ai4s-literature-zotero), version, install route — plus the active tool profile (full/workbench), whether the process is read-only, the write channel (cloud key and/or Zotero 10 desktop save), and any tools hidden by the current setup, so you never have to guess which server you are talking to or whether saving is possible.',
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (_args, ctx) => {
    const cloud = ctx.router.whoami();
    const lib = ctx.router.defaultLibrary();
    const profile = ctx.config?.toolProfile ?? 'full';
    const readOnly = ctx.config?.readOnly ?? false;
    const localDesktop = ctx.capabilities.localApi && Boolean(ctx.capabilities.localServerId);
    const cloudWrite = Boolean(cloud && (cloud as { access?: { user?: { write?: boolean } } }).access?.user?.write);
    const identity = serverIdentity(process.env);
    const structured = {
      server: identity,
      profile,
      read_only: readOnly,
      write_channel: {
        cloud_key: cloudWrite,
        local_desktop: localDesktop,
        read_only: readOnly,
      },
      hidden_tools: ctx.hiddenTools ?? [],
      cloud: Boolean(cloud),
      userID: cloud?.userID,
      username: cloud?.username,
      displayName: cloud?.displayName,
      access: cloud?.access ?? null,
      localApi: ctx.capabilities.localApi,
      localState: ctx.capabilities.localState ?? null,
      saveWithoutKey: localDesktop,
      defaultLibrary: lib,
    };
    const summary = cloud
      ? `Signed in as ${cloud.username} (userID ${cloud.userID}). Local API: ${ctx.capabilities.localApi ? 'available' : 'unavailable'}.`
      : `No cloud API key configured — reading the desktop library (local API ${ctx.capabilities.localApi ? 'available' : 'unavailable'}). ${
          localDesktop
            ? 'This Zotero (10 or later) can also save without a key: it asks the user once in its own window.'
            : 'Saving needs a Zotero key, or Zotero 10 or later.'
        }`;
    return ok(
      structured,
      `${summary} Server: ${identity.name} v${identity.version} (${identity.install} install), ${profile} profile${readOnly ? ', read-only' : ''}.`,
    );
  },
};

export default whoami;

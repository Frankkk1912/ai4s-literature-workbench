import type { ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';

const whoami: ToolDefinition = {
  name: 'zotero_whoami',
  title: 'Zotero identity & access',
  description:
    'Resolve the current Zotero identity (userID, username, display name) and per-library access scopes from the configured API key, and report which library backends are available (cloud Web API and/or the desktop local API). Call this first to discover the userID — never ask the user to type a numeric ID. If no API key is configured, the server runs in local-only read mode against the desktop library (users/0).',
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (_args, ctx) => {
    const cloud = ctx.router.whoami();
    const lib = ctx.router.defaultLibrary();
    const structured = {
      cloud: Boolean(cloud),
      userID: cloud?.userID,
      username: cloud?.username,
      displayName: cloud?.displayName,
      access: cloud?.access ?? null,
      localApi: ctx.capabilities.localApi,
      localState: ctx.capabilities.localState ?? null,
      saveWithoutKey: ctx.capabilities.localApi && Boolean(ctx.capabilities.localServerId),
      defaultLibrary: lib,
    };
    const summary = cloud
      ? `Signed in as ${cloud.username} (userID ${cloud.userID}). Local API: ${ctx.capabilities.localApi ? 'available' : 'unavailable'}.`
      : `No cloud API key configured — reading the desktop library (local API ${ctx.capabilities.localApi ? 'available' : 'unavailable'}). ${
          ctx.capabilities.localApi && ctx.capabilities.localServerId
            ? 'This Zotero (10 or later) can also save without a key: it asks the user once in its own window.'
            : 'Saving needs a Zotero key, or Zotero 10 or later.'
        }`;
    return ok(structured, summary);
  },
};

export default whoami;

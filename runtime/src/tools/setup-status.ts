import { z } from 'zod';
import type { ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';
import { CAPABILITY_IDS, buildSetupStatus, gatherFacts } from '../lib/setup-status.js';
import { currentSearchHelperInstall, probeSearchHelper } from '../lib/search-helper.js';

const setupStatus: ToolDefinition = {
  name: 'setup_status',
  title: 'What works now, what needs you',
  description:
    'Report what the user can do right now, what still needs them, and what is optional, in plain words in Chinese and English. Call this first in every session and at the end of setup. Show the user the `rendered` text for their language (Chinese unless they write in English) as three groups: Works now, Needs you, Optional. Do not read out `diagnostics` or invent component names. If search is under Needs you with the action install_helper, ask the user once in plain words and, after a yes, call install_search_helper. Run the skill scripts with `search_helper.run` (posix or powershell) in place of `uv run`. If a key is wanted, call open_setup and tell the user to paste it into the page that opens; never ask for a key in chat. Pass `wanted` with the capabilities the user asked for (for example zotero_save when they want to save to Zotero) so those move from Optional to Needs you. This tool only reads local settings and never returns a key.',
  inputSchema: {
    language: z.enum(['zh', 'en']).optional().describe('Language of the rendered text. Defaults to Chinese.'),
    wanted: z
      .array(z.enum(CAPABILITY_IDS as [string, ...string[]]))
      .optional()
      .describe('Capabilities the user asked for; unmet ones are listed under Needs you instead of Optional.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (args: { language?: 'zh' | 'en'; wanted?: Array<(typeof CAPABILITY_IDS)[number]> }, ctx) => {
    // Zotero may have been opened (or its setting switched on) since the tools started.
    await ctx.router.refreshLocal(true);
    const helper = await probeSearchHelper();
    const installing = currentSearchHelperInstall();
    const facts = gatherFacts({
      startedWithKey: Boolean(ctx.config.apiKey),
      cloud: ctx.router.whoami(),
      localApi: ctx.capabilities.localApi,
      localState: ctx.capabilities.localState,
      localServerId: ctx.capabilities.localServerId,
      uvAvailable: helper.available,
      uvCanInstall: helper.can_install,
      uvInstalling: installing && !installing.result ? installing.state : undefined,
      uvRun: helper.run,
    });
    const status = buildSetupStatus(facts, { language: args.language, wanted: args.wanted });
    return ok({ ...status }, status.rendered[status.language]);
  },
};

export default setupStatus;

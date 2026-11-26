import { z } from 'zod';
import type { ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';
import { CAPABILITY_IDS, buildSetupStatus, gatherFacts } from '../lib/setup-status.js';
import { serverIdentity } from '../lib/server-identity.js';
import { currentSearchHelperInstall, probeSearchHelper } from '../lib/search-helper.js';
import { probeNetworkEndpoints } from '../lib/net-probe.js';
import { tlsInsecureEnabled } from '../lib/tls.js';

const setupStatus: ToolDefinition = {
  name: 'setup_status',
  title: 'What works now, what needs you',
  description:
    'Report what the user can do right now, what still needs them, and what is optional, in plain words in Chinese and English. Call this first in every session and at the end of setup. Show the user the `rendered` text for their language (Chinese unless they write in English) as three groups: Works now, Needs you, Optional, plus a Network check section the rendered text already includes. Do not read out `diagnostics` or invent component names. The status also does a small read-only network check of the endpoints the workbench actually uses (Zotero Web API, PubMed, Europe PMC, EasyScholar, and optionally OpenAlex), one light request each with no key; pass `probe_network: false` to skip it, for example when the user is offline by choice. If a network check fails with a certificate error, show the fix from the rendered text. If search is under Needs you with the action install_helper, ask the user once in plain words and, after a yes, call install_search_helper. Run the skill scripts with `search_helper.run` (posix or powershell) in place of `uv run`. If a key is wanted, call open_setup and tell the user to paste it into the page that opens; never ask for a key in chat. Pass `wanted` with the capabilities the user asked for (for example zotero_save when they want to save to Zotero) so those move from Optional to Needs you. This tool reads local settings and does key-free read-only network probes; it never writes anything and never returns a key.',
  inputSchema: {
    language: z.enum(['zh', 'en']).optional().describe('Language of the rendered text. Defaults to Chinese.'),
    wanted: z
      .array(z.enum(CAPABILITY_IDS as [string, ...string[]]))
      .optional()
      .describe('Capabilities the user asked for; unmet ones are listed under Needs you instead of Optional.'),
    probe_network: z
      .boolean()
      .optional()
      .describe('Set false to skip the read-only network self-check (default: run it).'),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (
    args: { language?: 'zh' | 'en'; wanted?: Array<(typeof CAPABILITY_IDS)[number]>; probe_network?: boolean },
    ctx,
  ) => {
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
    // Read-only probes of the endpoints the workbench actually uses: light,
    // key-free, sequential, bounded. Skipped when the caller passes
    // probe_network: false; skipped results render no network section at all.
    const probes =
      args.probe_network === false ? null : await probeNetworkEndpoints({ logger: ctx.logger });
    const status = buildSetupStatus(facts, {
      language: args.language,
      wanted: args.wanted,
      probes,
      hiddenTools: ctx.hiddenTools ?? [],
      tlsInsecure: tlsInsecureEnabled(process.env),
      identity: {
        server: serverIdentity(process.env),
        profile: ctx.config.toolProfile ?? 'full',
        readOnly: ctx.config.readOnly ?? false,
      },
    });
    return ok({ ...status }, status.rendered[status.language]);
  },
};

export default setupStatus;

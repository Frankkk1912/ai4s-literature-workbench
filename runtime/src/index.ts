#!/usr/bin/env node
import { loadConfig } from './config.js';
import { buildServer, createServer, ContextCache } from './server.js';
import { startStdio } from './transports/stdio.js';
import { startHttp } from './transports/http.js';
import { buildOAuth } from './auth/router.js';
import { createLogger } from './lib/logger.js';
import { loadStartupEnvFiles } from './lib/env-files.js';
import { createMetrics } from './lib/metrics.js';
import { makeReadiness, storeCheck, zoteroPingCheck } from './lib/health.js';
import { installShutdownHandlers } from './lib/lifecycle.js';
import { runSetupCli } from './lib/setup-cli.js';
import { applyTlsTrust } from './lib/tls.js';
import { backfillMetrics } from './features/metrics-backfill.js';
import { createMetricsBackfillConsumer } from './features/plugin-channel/metrics-backfill-jobs.js';
import { requireCloudLibrary } from './registry/registry.js';
import type { Server } from 'node:http';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
}

import { SERVER_VERSION } from './lib/server-identity.js';

const VERSION = SERVER_VERSION;

async function main(): Promise<void> {
  // The double-click launchers run this. It needs no Zotero connection, so it runs before one is made.
  if (flag('setup') !== undefined) {
    process.exit(await runSetupCli({ check: flag('check') !== undefined, keys: flag('keys') }));
  }
  loadStartupEnvFiles();
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel, config.logFormat);
  // TLS trust first: custom CA env vars must be validated and applied before
  // any outbound fetch (including the ones buildServer makes). Verification
  // stays on unless LITERATURE_TLS_INSECURE is explicitly set (warned loudly).
  applyTlsTrust({ env: process.env, logger });
  const { server, ctx } = await buildServer(config);

  // Plugin-authored metrics-backfill requests (workbench order 11): while this
  // runtime is running, answer the Zotero add-on's preview requests with the
  // same reviewed backfill path in dry_run, and apply only when the add-on
  // submits a follow-up job with the user's confirmed plan_hash. The MCP tool
  // still defaults to dry_run and still requires its own confirm_plan_hash plus
  // receipt_path. Purely additive: it shares the ping jobs directory but never
  // claims, acks, or removes ping files, and any failure lands in the job's
  // result file instead of the MCP server.
  const backfillConsumer = createMetricsBackfillConsumer({
    dataDir: config.dataDir,
    runPreview: async (payload) => {
      const lib = requireCloudLibrary(ctx);
      const result = await backfillMetrics(ctx, lib, {
        ...(payload.collection_key ? { collection_key: payload.collection_key } : { item_keys: payload.item_keys }),
        mode: 'dry_run',
      });
      return {
        update: result.update,
        skip: result.skip,
        plan_hash: result.plan_hash,
        easyscholar: { key_configured: result.easyscholar.key_configured },
      };
    },
    runApply: async (payload, receipt_path) => {
      const lib = requireCloudLibrary(ctx);
      const result = await backfillMetrics(ctx, lib, {
        ...(payload.collection_key ? { collection_key: payload.collection_key } : { item_keys: payload.item_keys }),
        mode: 'apply',
        confirm_plan_hash: payload.confirm_plan_hash,
        receipt_path,
      });
      return {
        update: result.update,
        skip: result.skip,
        plan_hash: result.plan_hash,
        receipt_path: result.receipt_path ?? receipt_path,
      };
    },
    logger,
  });
  backfillConsumer.start();

  const httpFlag = flag('http');
  if (httpFlag !== undefined) {
    const port = Number(flag('port') ?? process.env.PORT ?? 3939);
    const metrics = config.metricsEnabled ? createMetrics() : undefined;
    const oauth = await buildOAuth(config, {
      onEvent: metrics ? (e) => metrics.inc(`${e === 'token_issued' ? 'tokens_issued' : 'auth_failures'}_total`) : undefined,
    });
    const host = flag('host') ?? process.env.HOST ?? (oauth ? '0.0.0.0' : '127.0.0.1');
    const cache = new ContextCache(config, ctx);
    const readiness = makeReadiness(
      {
        store: storeCheck(oauth?.store),
        ...(config.readyzCheckZotero ? { zotero: zoteroPingCheck() } : {}),
      },
      30_000,
    );

    let lifecycle: { drainSessions: (ms: number) => Promise<void>; activeSessions: () => number } | undefined;
    const httpServer: Server = await startHttp(async (authInfo) => createServer(await cache.resolve(authInfo)), {
      port,
      host,
      logger,
      oauth,
      metrics,
      readiness,
      version: VERSION,
      rateLimit: config.mcpRateLimit,
      enableDnsRebindingProtection: Boolean(oauth),
      allowedHosts: oauth?.allowedHosts,
      allowInsecureBind: config.allowInsecureHttp,
      registerLifecycle: (h) => {
        lifecycle = h;
      },
    });

    installShutdownHandlers({
      server: httpServer,
      logger,
      timeoutMs: 25_000,
      drainSessions: (ms) => lifecycle?.drainSessions(ms) ?? Promise.resolve(),
      flush: async () => {
        await oauth?.store.flush();
        await cache.flushIndexes();
        await backfillConsumer.stop();
      },
    });
  } else {
    await startStdio(server);
    logger.info('Literature Zotero MCP server started on stdio.');
    await backfillConsumer.stop();
  }
}

main().catch((err) => {
  process.stderr.write(`[literature-zotero-mcp] FATAL ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});

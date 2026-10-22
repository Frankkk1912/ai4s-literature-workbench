import type { ZoteusConfig } from '../config.js';
import type { WebApiClient, KeyInfo } from '../api/web-client.js';
import type { LocalApiClient, LocalProbe, LocalState } from '../api/local-client.js';
import type { Logger } from '../lib/logger.js';

export interface Capabilities {
  cloud: KeyInfo | null;
  localApi: boolean;
  /** Why the desktop connection is or is not usable. Absent where a caller only knows the boolean. */
  localState?: LocalState;
  /** Set when Zotero 10 or later answered; those versions accept local writes. */
  localServerId?: string;
}

export interface ProbeDeps {
  web: Pick<WebApiClient, 'hasKey' | 'keysCurrent'>;
  local?: Pick<LocalApiClient, 'ping'> & Partial<Pick<LocalApiClient, 'probe'>>;
  logger: Logger;
}

export async function probeCapabilities(
  config: ZoteusConfig,
  deps: ProbeDeps,
): Promise<Capabilities> {
  const cloudPromise: Promise<KeyInfo | null> = deps.web.hasKey
    ? deps.web
        .keysCurrent()
        .then((info) => info)
        .catch((err) => {
          deps.logger.warn('Cloud key probe failed:', String(err));
          return null;
        })
    : Promise.resolve(null);

  const unreachable: LocalProbe = { state: 'unreachable' };
  const localPromise: Promise<LocalProbe> =
    config.local !== 'off' && deps.local
      ? (deps.local.probe
          ? deps.local.probe()
          : deps.local.ping().then((up): LocalProbe => (up ? { state: 'ok' } : unreachable))
        ).catch(() => unreachable)
      : Promise.resolve(unreachable);

  const [cloud, local] = await Promise.all([cloudPromise, localPromise]);
  const localApi = local.state === 'ok';
  deps.logger.info(
    `Capabilities: cloud=${cloud ? `user ${cloud.userID}` : 'none'}, localApi=${localApi}`,
  );
  const asked = config.local !== 'off' && Boolean(deps.local);
  return { cloud, localApi, localState: asked ? local.state : undefined, localServerId: local.serverId };
}

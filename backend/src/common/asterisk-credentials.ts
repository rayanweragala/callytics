/**
 * ARI credentials from the environment.
 *
 * The compose file passes ARI_PASSWORD to the backend while the diagnostics
 * service read ARI_PASS, and the preflight service used a different default
 * password. Both names are accepted here so every service resolves the same
 * credentials and health checks no longer report ARI as disconnected.
 */
export interface AriCredentials {
  user: string;
  password: string;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value) => Boolean(value));
}

export function getAriCredentials(env: NodeJS.ProcessEnv = process.env): AriCredentials {
  return {
    user: firstNonEmpty(env.ARI_USER) ?? 'callytics',
    password: firstNonEmpty(env.ARI_PASS, env.ARI_PASSWORD) ?? 'callytics',
  };
}

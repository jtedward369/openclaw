import { loadConfig } from "../config/io.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveGatewayAuth } from "../gateway/auth.js";
import { buildGatewayConnectionDetails } from "../gateway/call.js";
import { resolveGatewayConnectionAuth } from "../gateway/connection-auth.js";
import { isLoopbackHost } from "../gateway/net.js";
import { normalizeStringifiedOptionalString } from "../shared/string-coerce.js";

export type DirectLoopbackGatewayAuthOpts = {
  url?: string;
  token?: string;
  password?: string;
  config?: OpenClawConfig;
};

async function isConfiguredSharedGatewayToken(params: {
  token: string | undefined;
  config?: OpenClawConfig;
}): Promise<boolean> {
  if (!params.token) {
    return false;
  }
  const config = params.config ?? loadConfigForDirectAuthProbe();
  const auth = resolveGatewayAuth({
    authConfig: config?.gateway?.auth,
    tailscaleMode: config?.gateway?.tailscale?.mode,
    env: process.env,
  });
  if (auth.mode !== "token") {
    return false;
  }
  if (!config) {
    return auth.token === params.token;
  }
  const credentials = await resolveGatewayConnectionAuth({
    config,
    env: process.env,
  });
  return credentials.token === params.token;
}

function loadConfigForDirectAuthProbe(): OpenClawConfig | undefined {
  try {
    return loadConfig({ skipPluginValidation: true, pin: false });
  } catch {
    return undefined;
  }
}

export async function shouldUseDirectLoopbackGatewayAuth(
  opts: DirectLoopbackGatewayAuthOpts,
): Promise<boolean> {
  const token = normalizeStringifiedOptionalString(opts.token);
  const password = normalizeStringifiedOptionalString(opts.password);
  const hasExplicitSharedAuth = Boolean(
    password || (await isConfiguredSharedGatewayToken({ token, config: opts.config })),
  );
  if (!hasExplicitSharedAuth) {
    return false;
  }
  const explicitUrl = normalizeStringifiedOptionalString(opts.url);
  const gatewayUrl = explicitUrl ?? buildGatewayConnectionDetails({ config: opts.config }).url;
  try {
    return isLoopbackHost(new URL(gatewayUrl).hostname);
  } catch {
    return false;
  }
}

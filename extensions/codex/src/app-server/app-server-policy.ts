/**
 * Policy promotion for Codex app-server runs that can safely use OpenClaw tool
 * approvals.
 */
import type {
  CodexAppServerRuntimeOptions,
  CodexPluginConfig,
  OpenClawExecPolicyForCodexAppServer,
} from "./config.js";

/**
 * Promotes implicit `never` approval policy to `untrusted` only when runtime
 * requirements allow OpenClaw to handle tool approvals.
 */
export function resolveCodexAppServerForOpenClawToolPolicy(params: {
  appServer: CodexAppServerRuntimeOptions;
  pluginConfig: CodexPluginConfig;
  env: NodeJS.ProcessEnv;
  shouldPromote: boolean;
  canUseUntrustedApprovalPolicy: boolean;
  execPolicy?: OpenClawExecPolicyForCodexAppServer;
}): CodexAppServerRuntimeOptions {
  if (
    !params.shouldPromote ||
    !params.canUseUntrustedApprovalPolicy ||
    params.appServer.approvalPolicy !== "never"
  ) {
    return params.appServer;
  }
  const explicitMode =
    params.execPolicy?.mode === "full" ||
    params.pluginConfig.appServer?.mode !== undefined ||
    isCodexAppServerPolicyMode(params.env.OPENCLAW_CODEX_APP_SERVER_MODE);
  const explicitApprovalPolicy =
    params.pluginConfig.appServer?.approvalPolicy !== undefined ||
    isCodexAppServerApprovalPolicy(params.env.OPENCLAW_CODEX_APP_SERVER_APPROVAL_POLICY) ||
    params.appServer.approvalPolicySource === "requirements";
  if (explicitMode || explicitApprovalPolicy) {
    return params.appServer;
  }
  return {
    ...params.appServer,
    approvalPolicy: "untrusted",
  };
}

export function resolveCodexAppServerForModelProvider(params: {
  appServer: CodexAppServerRuntimeOptions;
  provider?: string;
  model?: string;
}): CodexAppServerRuntimeOptions {
  const explicitProvider = normalizeModelBackedReviewerProvider(params.provider);
  const modelProvider = inferProviderFromModelRef(params.model);
  if (
    !isCodexModelBackedApprovalsReviewer(params.appServer.approvalsReviewer) ||
    (canUseCodexModelBackedApprovalsReviewer(explicitProvider) &&
      canUseCodexModelBackedApprovalsReviewer(modelProvider))
  ) {
    return params.appServer;
  }
  return {
    ...params.appServer,
    approvalsReviewer: "user",
  };
}

function isCodexAppServerPolicyMode(value: unknown): boolean {
  return value === "guardian" || value === "yolo";
}

function isCodexAppServerApprovalPolicy(value: unknown): boolean {
  return (
    value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted"
  );
}

function isCodexModelBackedApprovalsReviewer(value: string): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

function canUseCodexModelBackedApprovalsReviewer(provider: string | undefined): boolean {
  return !provider || provider === "codex" || provider === "openai";
}

function normalizeModelBackedReviewerProvider(provider: string | undefined): string | undefined {
  const normalized = provider?.trim().toLowerCase();
  return normalized || undefined;
}

function inferProviderFromModelRef(model: string | undefined): string | undefined {
  const normalized = model?.trim().toLowerCase();
  const slashIndex = normalized?.indexOf("/") ?? -1;
  return slashIndex > 0 ? normalized?.slice(0, slashIndex) : undefined;
}

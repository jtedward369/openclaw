// Codex tests cover app server policy plugin behavior.
import { describe, expect, it } from "vitest";
import {
  resolveCodexAppServerForModelProvider,
  resolveCodexAppServerForOpenClawToolPolicy,
} from "./app-server-policy.js";
import { readCodexPluginConfig, resolveCodexAppServerRuntimeOptions } from "./config.js";

describe("Codex app-server policy", () => {
  it("keeps implicit Codex yolo approval policy when untrusted approvals are disallowed", () => {
    const appServer = resolveCodexAppServerRuntimeOptions({ env: {}, requirementsToml: null });

    const resolved = resolveCodexAppServerForOpenClawToolPolicy({
      appServer,
      pluginConfig: readCodexPluginConfig({}),
      env: {},
      shouldPromote: true,
      canUseUntrustedApprovalPolicy: false,
    });

    expect(resolved.approvalPolicy).toBe("never");
  });

  it("promotes implicit yolo approval policy when OpenClaw tool policy requires review", () => {
    const appServer = resolveCodexAppServerRuntimeOptions({ env: {}, requirementsToml: null });

    const resolved = resolveCodexAppServerForOpenClawToolPolicy({
      appServer,
      pluginConfig: readCodexPluginConfig({}),
      env: {},
      shouldPromote: true,
      canUseUntrustedApprovalPolicy: true,
    });

    expect(resolved.approvalPolicy).toBe("untrusted");
  });

  it("preserves explicit operator app-server policy", () => {
    const appServer = resolveCodexAppServerRuntimeOptions({ env: {}, requirementsToml: null });
    const requirementsAppServer = resolveCodexAppServerRuntimeOptions({
      env: {},
      requirementsToml:
        'allowed_approval_policies = ["never"]\nallowed_sandbox_modes = ["workspace-write"]\n',
    });

    const explicitConfig = resolveCodexAppServerForOpenClawToolPolicy({
      appServer,
      pluginConfig: readCodexPluginConfig({ appServer: { mode: "yolo" } }),
      env: {},
      shouldPromote: true,
      canUseUntrustedApprovalPolicy: true,
    });
    const explicitEnv = resolveCodexAppServerForOpenClawToolPolicy({
      appServer,
      pluginConfig: readCodexPluginConfig({}),
      env: { OPENCLAW_CODEX_APP_SERVER_APPROVAL_POLICY: "never" },
      shouldPromote: true,
      canUseUntrustedApprovalPolicy: true,
    });
    const explicitRequirements = resolveCodexAppServerForOpenClawToolPolicy({
      appServer: requirementsAppServer,
      pluginConfig: readCodexPluginConfig({}),
      env: {},
      shouldPromote: true,
      canUseUntrustedApprovalPolicy: true,
    });

    expect(explicitConfig.approvalPolicy).toBe("never");
    expect(explicitEnv.approvalPolicy).toBe("never");
    expect(explicitRequirements.approvalPolicy).toBe("never");
  });

  it("keeps model-backed reviewers for Codex-native and OpenAI model providers", () => {
    const appServer = resolveCodexAppServerRuntimeOptions({
      env: {},
      requirementsToml: null,
      execMode: "auto",
    });

    expect(resolveCodexAppServerForModelProvider({ appServer }).approvalsReviewer).toBe(
      "auto_review",
    );
    expect(
      resolveCodexAppServerForModelProvider({ appServer, provider: "codex" }).approvalsReviewer,
    ).toBe("auto_review");
    expect(
      resolveCodexAppServerForModelProvider({ appServer, provider: "openai" }).approvalsReviewer,
    ).toBe("auto_review");
  });

  it("uses human approval instead of Codex Guardian for custom model providers", () => {
    const appServer = resolveCodexAppServerRuntimeOptions({
      env: {},
      requirementsToml: null,
      execMode: "auto",
    });

    const resolved = resolveCodexAppServerForModelProvider({
      appServer,
      provider: "lmstudio",
    });

    expect(appServer.approvalsReviewer).toBe("auto_review");
    expect(resolved.approvalPolicy).toBe("on-request");
    expect(resolved.sandbox).toBe("workspace-write");
    expect(resolved.approvalsReviewer).toBe("user");
  });

  it("infers custom providers from provider-qualified model refs", () => {
    const appServer = resolveCodexAppServerRuntimeOptions({
      env: {},
      requirementsToml: null,
      execMode: "auto",
    });

    expect(
      resolveCodexAppServerForModelProvider({
        appServer,
        model: "lmstudio/local-model",
      }).approvalsReviewer,
    ).toBe("user");
  });

  it("uses provider-qualified model refs to override broad native provider wrappers", () => {
    const appServer = resolveCodexAppServerRuntimeOptions({
      env: {},
      requirementsToml: null,
      execMode: "auto",
    });

    expect(
      resolveCodexAppServerForModelProvider({
        appServer,
        provider: "codex",
        model: "lmstudio/local-model",
      }).approvalsReviewer,
    ).toBe("user");
  });

  it("downgrades legacy guardian_subagent for custom model providers", () => {
    const appServer = resolveCodexAppServerRuntimeOptions({
      env: {},
      requirementsToml: null,
      pluginConfig: {
        appServer: {
          mode: "guardian",
          approvalsReviewer: "guardian_subagent",
        },
      },
    });

    expect(
      resolveCodexAppServerForModelProvider({ appServer, provider: "local" }).approvalsReviewer,
    ).toBe("user");
  });
});

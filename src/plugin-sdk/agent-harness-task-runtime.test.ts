import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverSubagentAnnouncement } from "../agents/subagent-announce-delivery.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { createAgentHarnessTaskRuntimeScope } from "../tasks/agent-harness-task-runtime-scope.js";
import { createRunningTaskRun, finalizeTaskRunByRunId } from "../tasks/detached-task-runtime.js";
import { listTaskRecords } from "../tasks/runtime-internal.js";
import {
  createAgentHarnessTaskRuntime,
  deliverAgentHarnessTaskCompletion,
  emitAgentHarnessSubagentEndedHook,
  emitAgentHarnessSubagentSpawnedHook,
  isDurableAgentHarnessCompletionDelivery,
} from "./agent-harness-task-runtime.js";

vi.mock("../agents/subagent-announce-delivery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/subagent-announce-delivery.js")>();
  return {
    ...actual,
    deliverSubagentAnnouncement: vi.fn(async () => ({ delivered: true, path: "steered" })),
    isInternalAnnounceRequesterSession: vi.fn(() => true),
  };
});

vi.mock("../tasks/detached-task-runtime.js", () => ({
  createRunningTaskRun: vi.fn((params) => ({ taskId: "task-1", ...params })),
  recordTaskRunProgressByRunId: vi.fn(() => []),
  finalizeTaskRunByRunId: vi.fn(() => []),
  setDetachedTaskDeliveryStatusByRunId: vi.fn(() => []),
}));

vi.mock("../tasks/runtime-internal.js", () => ({
  listTaskRecords: vi.fn(() => []),
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: vi.fn(() => null),
}));

describe("agent-harness-task-runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listTaskRecords).mockReturnValue([]);
    vi.mocked(getGlobalHookRunner).mockReturnValue(null);
  });

  function createScope(
    requesterSessionKey = "agent:main:channel:C123",
    requesterOrigin?: Parameters<typeof createAgentHarnessTaskRuntimeScope>[0]["requesterOrigin"],
  ) {
    return createAgentHarnessTaskRuntimeScope({ requesterSessionKey, requesterOrigin });
  }

  it("scopes task lifecycle mutations to the owning requester session", () => {
    const runtime = createAgentHarnessTaskRuntime({
      runtime: "subagent",
      taskKind: "example-harness",
      scope: createScope(),
      runIdPrefix: "example:",
    });

    runtime.createRunningTaskRun({
      runId: "example:child-1",
      sourceId: "example:child-1",
      task: "do work",
      label: "worker",
    });
    runtime.finalizeTaskRunByRunId({
      runId: "example:child-1",
      status: "succeeded",
      endedAt: 1,
    });

    expect(createRunningTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "subagent",
        taskKind: "example-harness",
        requesterSessionKey: "agent:main:channel:C123",
        ownerKey: "agent:main:channel:C123",
        scopeKind: "session",
        runId: "example:child-1",
      }),
    );
    expect(finalizeTaskRunByRunId).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "subagent",
        sessionKey: "agent:main:channel:C123",
        runId: "example:child-1",
      }),
    );
  });

  it("rejects task run ids outside the configured harness scope", () => {
    const runtime = createAgentHarnessTaskRuntime({
      runtime: "subagent",
      scope: createScope(),
      runIdPrefix: "example:",
    });

    expect(() =>
      runtime.finalizeTaskRunByRunId({
        runId: "other:child-1",
        status: "succeeded",
        endedAt: 1,
      }),
    ).toThrow(/outside the configured scope/);
  });

  it("rejects caller-forged task runtime scopes", async () => {
    const forgedScope = {
      requesterSessionKey: "agent:other:channel:C999",
    } as ReturnType<typeof createScope>;
    expect(() =>
      createAgentHarnessTaskRuntime({
        runtime: "subagent",
        scope: forgedScope,
      }),
    ).toThrow(/host-issued scope/);
    await expect(
      deliverAgentHarnessTaskCompletion({
        scope: forgedScope,
        childSessionKey: "harness-thread:child",
        childSessionId: "child",
        announceId: "harness:parent:child:succeeded",
        status: "succeeded",
        result: "child final answer",
      }),
    ).rejects.toThrow(/host-issued scope/);
  });

  it("lists only task records owned by the scoped requester session", () => {
    vi.mocked(listTaskRecords).mockReturnValue([
      {
        taskId: "task-1",
        runtime: "subagent",
        taskKind: "example-harness",
        requesterSessionKey: "agent:main:channel:C123",
        ownerKey: "agent:main:channel:C123",
        scopeKind: "session",
        runId: "example:child-1",
        task: "owned",
        status: "running",
        deliveryStatus: "not_applicable",
        notifyPolicy: "silent",
        createdAt: 1,
      },
      {
        taskId: "task-2",
        runtime: "subagent",
        taskKind: "example-harness",
        requesterSessionKey: "agent:other:channel:C999",
        ownerKey: "agent:other:channel:C999",
        scopeKind: "session",
        runId: "example:child-2",
        task: "other",
        status: "running",
        deliveryStatus: "not_applicable",
        notifyPolicy: "silent",
        createdAt: 1,
      },
    ]);
    const runtime = createAgentHarnessTaskRuntime({
      runtime: "subagent",
      taskKind: "example-harness",
      scope: createScope(),
      runIdPrefix: "example:",
    });

    expect(runtime.listTaskRecords().map((task) => task.taskId)).toEqual(["task-1"]);
  });

  it("delivers a generic harness completion through subagent announcement delivery", async () => {
    await deliverAgentHarnessTaskCompletion({
      scope: createScope("agent:main:main"),
      childSessionKey: "harness-thread:child",
      childSessionId: "child",
      announceId: "harness:parent:child:succeeded",
      announceType: "Example harness worker",
      taskLabel: "Example worker",
      status: "succeeded",
      statusLabel: "task_complete",
      result: "child final answer",
    });

    expect(deliverSubagentAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterSessionKey: "agent:main:main",
        announceId: "harness:parent:child:succeeded",
        sourceSessionKey: "harness-thread:child",
        sourceTool: "agent_harness_task",
        expectsCompletionMessage: true,
        directIdempotencyKey: "announce:harness:parent:child:succeeded",
      }),
    );
  });

  it("emits subagent_spawned with requester metadata from the harness scope", async () => {
    const runSubagentSpawned = vi.fn(async () => {});
    vi.mocked(getGlobalHookRunner).mockReturnValue({
      hasHooks: (hookName: string) => hookName === "subagent_spawned",
      runSubagentSpawned,
    } as never);
    const scope = createScope("agent:main:discord:channel:C123", {
      channel: "discord",
      accountId: "work",
      to: "channel:C123",
      threadId: "456",
    });

    await emitAgentHarnessSubagentSpawnedHook({
      scope,
      runId: "codex-thread:child-thread",
      childSessionKey: "codex-thread:child-thread",
      agentId: "main",
      label: "research",
      threadRequested: false,
      mode: "run",
    });

    expect(runSubagentSpawned).toHaveBeenCalledWith(
      {
        runId: "codex-thread:child-thread",
        childSessionKey: "codex-thread:child-thread",
        agentId: "main",
        label: "research",
        requester: {
          channel: "discord",
          accountId: "work",
          to: "channel:C123",
          threadId: "456",
        },
        threadRequested: false,
        mode: "run",
      },
      {
        runId: "codex-thread:child-thread",
        childSessionKey: "codex-thread:child-thread",
        requesterSessionKey: "agent:main:discord:channel:C123",
      },
    );
  });

  it("emits subagent_ended with requester account metadata and swallows hook failures", async () => {
    const runSubagentEnded = vi.fn(async () => {
      throw new Error("hook failed");
    });
    vi.mocked(getGlobalHookRunner).mockReturnValue({
      hasHooks: (hookName: string) => hookName === "subagent_ended",
      runSubagentEnded,
    } as never);
    const scope = createScope("agent:main:discord:channel:C123", {
      channel: "discord",
      accountId: "work",
      to: "channel:C123",
    });

    await expect(
      emitAgentHarnessSubagentEndedHook({
        scope,
        runId: "codex-thread:child-thread",
        targetSessionKey: "codex-thread:child-thread",
        reason: "subagent-error",
        outcome: "error",
        endedAt: 1_234,
        error: "boom",
      }),
    ).resolves.toBeUndefined();

    expect(runSubagentEnded).toHaveBeenCalledWith(
      {
        targetSessionKey: "codex-thread:child-thread",
        targetKind: "subagent",
        reason: "subagent-error",
        accountId: "work",
        runId: "codex-thread:child-thread",
        endedAt: 1_234,
        outcome: "error",
        error: "boom",
      },
      {
        runId: "codex-thread:child-thread",
        childSessionKey: "codex-thread:child-thread",
        requesterSessionKey: "agent:main:discord:channel:C123",
      },
    );
  });

  it("checks durable direct delivery phases", () => {
    expect(
      isDurableAgentHarnessCompletionDelivery({
        delivered: true,
        path: "direct",
        phases: [{ phase: "direct-primary", delivered: true, path: "direct" }],
      }),
    ).toBe(true);
    expect(
      isDurableAgentHarnessCompletionDelivery({
        delivered: true,
        path: "direct",
        phases: [{ phase: "steer-fallback", delivered: true, path: "steered" }],
      }),
    ).toBe(false);
  });
});

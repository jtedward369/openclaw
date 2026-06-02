import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertSessionEntry } from "./session-accessor.js";
import {
  deleteSessionEntries,
  patchSessionEntries,
  patchSessionLifecycleEntry,
} from "./session-entry-lifecycle.js";
import { loadSessionStore } from "./store.js";

describe("session entry lifecycle seam", () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-session-lifecycle-"));
    storePath = path.join(tempDir, "sessions.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("patches one entry with replacement semantics", async () => {
    await upsertSessionEntry(
      { sessionKey: "agent:main:main", storePath },
      {
        model: "gpt-5.5",
        sessionId: "session-1",
        updatedAt: 10,
      },
    );

    const patched = await patchSessionLifecycleEntry(
      { sessionKey: "agent:main:main", storePath },
      (entry) => {
        delete entry.model;
        entry.providerOverride = "openai";
        return entry;
      },
      { replaceEntry: true, skipMaintenance: true },
    );

    expect(patched).toMatchObject({
      providerOverride: "openai",
      sessionId: "session-1",
    });
    expect(
      loadSessionStore(storePath, { skipCache: true })["agent:main:main"]?.model,
    ).toBeUndefined();
  });

  it("preserves an existing raw row key while exposing normalized context", async () => {
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        GLOBAL: {
          sessionId: "session-raw",
          updatedAt: 10,
        },
      }),
    );
    let contextKey: string | undefined;

    await patchSessionLifecycleEntry(
      { sessionKey: "GLOBAL", storePath },
      (entry, context) => {
        contextKey = context.sessionKey;
        entry.fastMode = true;
        return entry;
      },
      { replaceEntry: true, skipMaintenance: true },
    );

    const store = loadSessionStore(storePath, { skipCache: true });
    expect(contextKey).toBe("global");
    expect(store.GLOBAL?.fastMode).toBe(true);
    expect(store.global).toBeUndefined();
  });

  it("collapses legacy aliases when a usable canonical row exists", async () => {
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        "agent:main:main": {
          sessionId: "session-canonical",
          updatedAt: 10,
          fastMode: false,
        },
        "Agent:Main:Main": {
          sessionId: "session-legacy",
          updatedAt: 20,
          fastMode: false,
        },
      }),
    );

    await patchSessionLifecycleEntry(
      { sessionKey: "Agent:Main:Main", storePath },
      (entry) => {
        entry.fastMode = true;
        return entry;
      },
      { replaceEntry: true, skipMaintenance: true },
    );

    const store = loadSessionStore(storePath, { skipCache: true });
    expect(store["agent:main:main"]?.sessionId).toBe("session-legacy");
    expect(store["agent:main:main"]?.fastMode).toBe(true);
    expect(store["Agent:Main:Main"]).toBeUndefined();
  });

  it("preserves a fallback raw row key", async () => {
    await patchSessionLifecycleEntry(
      { sessionKey: "UNKNOWN", storePath },
      (entry) => {
        entry.fastMode = true;
        return entry;
      },
      {
        fallbackEntry: {
          sessionId: "session-fallback",
          updatedAt: 10,
        },
        replaceEntry: true,
        skipMaintenance: true,
      },
    );

    const store = loadSessionStore(storePath, { skipCache: true });
    expect(store.UNKNOWN?.fastMode).toBe(true);
    expect(store.unknown).toBeUndefined();
  });

  it("patches multiple entries without exposing a mutable store", async () => {
    await upsertSessionEntry(
      { sessionKey: "agent:main:one", storePath },
      { sessionId: "session-1", updatedAt: 10 },
    );
    await upsertSessionEntry(
      { sessionKey: "agent:main:two", storePath },
      { sessionId: "session-2", updatedAt: 20 },
    );

    const result = await patchSessionEntries(
      { storePath },
      (entry, { sessionKey }) =>
        sessionKey.endsWith(":two")
          ? {
              ...entry,
              model: "gpt-5.5",
            }
          : null,
      { replaceEntry: true, skipMaintenance: true },
    );

    expect(result.patched).toHaveLength(1);
    expect(loadSessionStore(storePath, { skipCache: true })["agent:main:two"]?.model).toBe(
      "gpt-5.5",
    );
  });

  it("deletes selected entries and returns cleanup metadata", async () => {
    await upsertSessionEntry(
      { sessionKey: "agent:main:keep", storePath },
      { sessionFile: path.join(tempDir, "keep.jsonl"), sessionId: "keep", updatedAt: 20 },
    );
    await upsertSessionEntry(
      { sessionKey: "agent:main:delete", storePath },
      { sessionFile: path.join(tempDir, "delete.jsonl"), sessionId: "delete", updatedAt: 10 },
    );

    const deletion = await deleteSessionEntries(
      { storePath },
      (entry) => entry.sessionId === "delete",
      {
        skipMaintenance: true,
      },
    );

    expect(deletion.deleted.map((entry) => entry.sessionKey)).toEqual(["agent:main:delete"]);
    expect(deletion.referencedSessionIds).toEqual(new Set(["keep"]));
    expect(deletion.removedSessionFiles).toEqual(
      new Map([["delete", path.join(tempDir, "delete.jsonl")]]),
    );
    expect(loadSessionStore(storePath, { skipCache: true })["agent:main:delete"]).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { enablePluginInConfig as enableFetchPluginInConfig } from "./provider-web-fetch-contract.js";
import { enablePluginInConfig as enableSearchPluginInConfig } from "./provider-web-search-contract.js";

describe("provider contract enablePluginInConfig", () => {
  it("enables and allowlists provider plugins without touching channels", () => {
    const config = {
      plugins: {
        allow: ["openai"],
      },
      channels: {
        brave: { enabled: false },
      },
    };

    const result = enableSearchPluginInConfig(config, "brave");

    expect(result).toEqual({
      enabled: true,
      config: {
        plugins: {
          allow: ["openai", "brave"],
          entries: {
            brave: { enabled: true },
          },
        },
        channels: {
          brave: { enabled: false },
        },
      },
    });
  });

  it("shares denylist behavior across provider contract subpaths", () => {
    const config = {
      plugins: {
        deny: ["firecrawl"],
      },
    };

    expect(enableFetchPluginInConfig(config, "firecrawl")).toEqual({
      config,
      enabled: false,
      reason: "blocked by denylist",
    });
  });

  it("enables provider plugins without using hostile config array methods", () => {
    const allow = Object.assign(["mockplugin"], {
      includes() {
        throw new Error("fuzzplugin allow includes failed");
      },
      [Symbol.iterator]() {
        throw new Error("mockplugin allow iterator failed");
      },
    });
    const deny = Object.assign(["blockedplugin"], {
      includes() {
        throw new Error("fuzzplugin deny includes failed");
      },
      [Symbol.iterator]() {
        throw new Error("mockplugin deny iterator failed");
      },
    });

    const result = enableSearchPluginInConfig(
      {
        plugins: {
          allow,
          deny,
        },
      },
      "fuzzplugin",
    );

    expect(result.enabled).toBe(true);
    expect(result.config.plugins?.allow).toEqual(["mockplugin", "fuzzplugin"]);
    expect(result.config.plugins?.deny).toEqual(["blockedplugin"]);
    expect(result.config.plugins?.entries?.fuzzplugin).toEqual({ enabled: true });
  });

  it("skips unreadable provider plugin entry config during enablement", () => {
    const entries = {
      get fuzzplugin() {
        throw new Error("fuzzplugin entry read failed");
      },
      mockplugin: { enabled: false },
    };

    const result = enableSearchPluginInConfig(
      {
        plugins: {
          entries,
        },
      },
      "fuzzplugin",
    );

    expect(result.enabled).toBe(true);
    expect(result.config.plugins?.entries).toEqual({
      mockplugin: { enabled: false },
      fuzzplugin: { enabled: true },
    });
  });
});

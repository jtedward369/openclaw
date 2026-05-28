import { ensurePluginAllowlisted } from "../config/plugins-allowlist.js";

type ProviderPluginConfig = {
  enabled?: boolean;
};

type ProviderEnableConfigCarrier = {
  plugins?: {
    enabled?: boolean;
    deny?: string[];
    allow?: string[];
    entries?: Record<string, ProviderPluginConfig | undefined>;
  };
};

export type PluginEnableResult<TConfig extends ProviderEnableConfigCarrier> = {
  config: TConfig;
  enabled: boolean;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRecordValue(record: Record<string, unknown>, key: string): unknown {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function copyStringArrayEntries(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  let length: number;
  try {
    length = value.length;
  } catch {
    return [];
  }
  const entries: string[] = [];
  for (let index = 0; index < length; index += 1) {
    try {
      if (index in value) {
        const entry = value[index];
        if (typeof entry === "string") {
          entries.push(entry);
        }
      }
    } catch {
      continue;
    }
  }
  return entries;
}

function copyRecordEntries(value: unknown): Array<[string, unknown]> {
  if (!isRecord(value)) {
    return [];
  }
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return [];
  }
  const entries: Array<[string, unknown]> = [];
  for (const key of keys) {
    try {
      entries.push([key, value[key]]);
    } catch {
      continue;
    }
  }
  return entries;
}

/**
 * Provider contract surfaces only ever enable provider plugins, so they do not
 * need the built-in channel normalization path from plugins/enable.ts.
 */
export function enablePluginInConfig<TConfig extends ProviderEnableConfigCarrier>(
  cfg: TConfig,
  pluginId: string,
): PluginEnableResult<TConfig> {
  const cfgRecord = isRecord(cfg) ? Object.fromEntries(copyRecordEntries(cfg)) : {};
  const pluginsValue = readRecordValue(cfgRecord, "plugins");
  const plugins = isRecord(pluginsValue)
    ? Object.fromEntries(copyRecordEntries(pluginsValue))
    : undefined;
  if (readRecordValue(plugins ?? {}, "enabled") === false) {
    return { config: cfg, enabled: false, reason: "plugins disabled" };
  }
  const deny = copyStringArrayEntries(readRecordValue(plugins ?? {}, "deny"));
  if (deny?.includes(pluginId)) {
    return { config: cfg, enabled: false, reason: "blocked by denylist" };
  }

  const allow = copyStringArrayEntries(readRecordValue(plugins ?? {}, "allow"));
  const entries = Object.fromEntries(copyRecordEntries(readRecordValue(plugins ?? {}, "entries")));
  const existingEntry = readRecordValue(entries, pluginId);
  const nextPluginEntry = {
    ...(isRecord(existingEntry) ? Object.fromEntries(copyRecordEntries(existingEntry)) : {}),
    enabled: true,
  };
  let next = {
    ...cfgRecord,
    plugins: {
      ...plugins,
      ...(allow ? { allow } : {}),
      ...(deny ? { deny } : {}),
      entries: {
        ...entries,
        [pluginId]: nextPluginEntry,
      },
    },
  } as TConfig;
  next = ensurePluginAllowlisted(next, pluginId);
  return { config: next, enabled: true };
}

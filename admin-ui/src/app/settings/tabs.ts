// Settings tabs. Each has its own URL (?tab=), so "Set up" links can open one.
export const SETTINGS_TABS = ["general", "llm", "auth", "danger"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

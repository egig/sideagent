export const pretty = (v: unknown) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

/** Relative time, e.g. "5 minutes ago". */
export const ago = (t: number) => {
  const s = Math.round((t - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(s, "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
};

/** The URL if it is http(s), otherwise null. */
export const httpUrl = (u: unknown): string | null => {
  try {
    const url = new URL(String(u));
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

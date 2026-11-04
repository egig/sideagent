// Input limits enforced by the control plane (worker/control/config.ts) and
// mirrored in dashboard forms. Change them here only.

export const NAME_MAX = 80;
export const INSTRUCTIONS_MAX = 8000;
export const ORIGINS_MAX = 20;
export const ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "EdDSA"] as const;
export const DEFAULT_ALGORITHMS = ["RS256", "ES256", "EdDSA"] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

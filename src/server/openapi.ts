import { dereference } from "@scalar/openapi-parser";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
export type HttpMethod = (typeof METHODS)[number];

/** Per-operation hints, read from the `x-agent` extension in the spec. */
export interface AgentExt {
  approval?: "required" | "auto";
  description?: string;
  /** Tags handed to client hooks after the operation succeeds. */
  invalidates?: string[];
  /** Only these field names (at any depth) reach the LLM and the browser. */
  responseFields?: string[];
}

export interface ParamDef {
  name: string;
  in: "path" | "query";
  required: boolean;
}

export interface Operation {
  operationId: string;
  method: HttpMethod;
  path: string;
  description: string;
  tags: string[];
  params: ParamDef[];
  hasBody: boolean;
  inputSchema: Record<string, unknown>;
  ext: AgentExt;
  needsApproval: boolean;
}

type Json = Record<string, any>;

async function loadSpec(spec: string | Record<string, unknown>): Promise<Json> {
  let input: string | Record<string, unknown> = spec;
  if (typeof spec === "string" && /^https?:\/\//.test(spec.trim())) {
    const res = await fetch(spec.trim());
    if (!res.ok) throw new Error(`Could not fetch spec: HTTP ${res.status}`);
    input = await res.text();
  }
  const { schema, errors } = await dereference(input as any);
  if (!schema) throw new Error(`Invalid OpenAPI spec: ${errors?.[0]?.message ?? "could not parse"}`);
  const version = String((schema as Json).openapi ?? "");
  if (!/^3\.[01]/.test(version)) throw new Error(`Unsupported spec version "${version}"; need OpenAPI 3.0 or 3.1`);
  return schema as Json;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matches(pattern: string, opId: string, tags: string[]): boolean {
  if (pattern.startsWith("tag:")) return tags.includes(pattern.slice(4));
  return globToRegExp(pattern).test(opId);
}

const STRIP = new Set(["example", "examples", "xml", "externalDocs", "deprecated", "readOnly", "writeOnly"]);
function cleanSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (s && typeof s === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(s)) {
      if (STRIP.has(k)) continue;
      out[k] = cleanSchema(v);
    }
    if (out.nullable === true && typeof out.type === "string") out.type = [out.type, "null"];
    delete out.nullable;
    return out;
  }
  return s;
}

/** Parses the spec and returns only allowlisted operations. Default-deny. */
export async function loadOperations(
  spec: string | Record<string, unknown>,
  allow: string[],
  maxTools: number,
): Promise<Operation[]> {
  const doc = await loadSpec(spec);
  const ops: Operation[] = [];
  const used = new Set<string>();

  for (const [path, item] of Object.entries<Json>(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op: Json | undefined = item?.[method];
      if (!op) continue;
      const operationId: string = (op.operationId ?? `${method}_${path}`).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const tags: string[] = op.tags ?? [];
      if (!allow.some((p) => matches(p, operationId, tags))) continue;
      if (used.has(operationId)) throw new Error(`Duplicate operationId "${operationId}"`);
      used.add(operationId);

      const ext: AgentExt = op["x-agent"] ?? {};
      if (method === "delete" && ext.approval === "auto") {
        throw new Error(`Operation "${operationId}": DELETE cannot be approval:"auto"`);
      }

      const rawParams: Json[] = [...(item.parameters ?? []), ...(op.parameters ?? [])];
      const params: ParamDef[] = [];
      const properties: Json = {};
      const required: string[] = [];
      for (const p of rawParams) {
        if (p.in !== "path" && p.in !== "query") continue; // header/cookie params are never model-controlled
        params.push({ name: p.name, in: p.in, required: p.in === "path" || !!p.required });
        properties[p.name] = {
          ...(cleanSchema(p.schema ?? {}) as Json),
          ...(p.description ? { description: p.description } : {}),
        };
        if (p.in === "path" || p.required) required.push(p.name);
      }
      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema) {
        properties.body = cleanSchema(bodySchema);
        if (op.requestBody.required) required.push("body");
      }

      ops.push({
        operationId,
        method,
        path,
        description: ext.description ?? op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`,
        tags,
        params,
        hasBody: !!bodySchema,
        inputSchema: { type: "object", properties, required, additionalProperties: false },
        ext,
        needsApproval: ext.approval ? ext.approval === "required" : method !== "get",
      });
    }
  }

  for (const pattern of allow) {
    const hit = ops.some((o) => matches(pattern, o.operationId, o.tags));
    if (!hit) throw new Error(`allow pattern "${pattern}" matched no operation in the spec`);
  }
  if (ops.length > maxTools) {
    throw new Error(`allow exposes ${ops.length} operations; limit is ${maxTools}. Narrow the allowlist.`);
  }
  return ops;
}

/** Throws if args don't fit the operation: unknown names, missing required, wrong body presence. */
export function validateArgs(op: Operation, args: unknown): Json {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const a = args as Json;
  const props = (op.inputSchema.properties ?? {}) as Json;
  for (const k of Object.keys(a)) if (!(k in props)) throw new Error(`unknown argument "${k}"`);
  for (const r of (op.inputSchema.required as string[]) ?? []) {
    if (a[r] === undefined) throw new Error(`missing required argument "${r}"`);
  }
  return a;
}

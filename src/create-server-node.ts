// sideagent/server/node: createServer for Node, which also serves the dashboard's files and listens on a port.
import { serve } from "@hono/node-server";
import { serveAdminUi } from "./admin/node.js";
import { createServer as create, type Server, type ServerOptions } from "./create-server.js";

export * from "./create-server.js";

export interface NodeServerOptions extends Omit<ServerOptions, "ui"> {
  /** Folder with the built dashboard. Default: the one shipped in this package. */
  dashboardDir?: string;
  /** Docs link shown in the dashboard's sidebar. */
  docsUrl?: string;
}

export interface NodeServer extends Server {
  /** Listens on `port` and returns once it is bound. */
  listen(port: number): Promise<{ close(): Promise<void> }>;
}

/** `createServer` plus the dashboard's files. Without a built dashboard (`pnpm build`) the dashboard routes 404; the API still works. */
export function createServer(options: NodeServerOptions): NodeServer {
  const { dashboardDir, docsUrl, ...rest } = options;
  const server = create({ ...rest, ui: serveAdminUi({ dir: dashboardDir, docsUrl }) });
  return {
    ...server,
    listen: (port) =>
      new Promise((resolve) => {
        const http = serve({ fetch: server.fetch, port }, () =>
          resolve({
            close: () =>
              new Promise<void>((done) => {
                http.close(() => done());
              }).then(server.close),
          }),
        );
      }),
  };
}

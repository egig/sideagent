throw new Error(
  "sideagent/server is server-only and was imported into a browser bundle. " +
    "It holds your LLM key and tool credentials. Import 'sideagent' in the browser instead.",
);

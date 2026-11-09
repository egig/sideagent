import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `dedupe` keeps one copy of React when sideagent is linked from the repo (it has its own node_modules).
export default defineConfig({ plugins: [react()], resolve: { dedupe: ["react", "react-dom"] } });

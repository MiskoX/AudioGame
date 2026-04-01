import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import babel from "@rolldown/plugin-babel";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base =
  process.env.GITHUB_ACTIONS === "true" && repoName ? `/${repoName}/` : "/";

// https://vite.dev/config/
export default defineConfig({
  base,
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  plugins: [basicSsl(), react(), babel({ presets: [reactCompilerPreset()] })],
});

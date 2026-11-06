import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/node_modules/", "**/dist/", "**/build/", "**/coverage/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // specs/04: rule packs are data, expressions are parsed — never evaluated.
    rules: {
      "no-eval": "error",
      "no-new-func": "error",
      "no-implied-eval": "error",
    },
  },
);

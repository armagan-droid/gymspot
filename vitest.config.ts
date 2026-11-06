import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "packages",
          include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
        },
      },
      // apps/web brings its own config (React plugin, jsdom)
      "apps/web",
    ],
  },
});

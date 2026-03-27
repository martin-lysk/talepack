import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "./packages/zlib-random-access/vitest.config.ts",
  "./packages/git-random-access/vitest.config.ts",
]);

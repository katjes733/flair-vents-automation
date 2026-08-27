import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import parser from "@typescript-eslint/parser";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  {
    name: "node-bun-config",
    files: ["{src,tests}/server/**/*.{ts,tsx}"],
    languageOptions: {
      parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        console: true,
        process: true,
        module: true,
        require: true,
        Bun: true,
        logger: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": ts,
    },
    rules: {
      // The base rule doesn't understand TS-only constructs (interface
      // method signatures, function-type params) and misfires on them —
      // same issue and same fix as the client config below.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    settings: {
      "import/resolver": {
        node: true,
      },
    },
  },
  {
    // domain/ purity boundary: pure, injected-input functions only. No
    // database, Redis, Flair client, or direct fetch/node-cron access — that
    // I/O lives in control/ (orchestration) instead. Enforced here rather
    // than by review, per the plan's "Two new domain directories" decision.
    name: "domain-purity-boundary",
    files: ["src/server/domain/**/*.ts", "tests/server/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["~/server/database/**", "*/database/**"],
              message:
                "domain/ must stay pure — no database access. Fetch data in control/ and pass it in as a parameter.",
            },
            {
              group: [
                "~/server/util/redis",
                "*/util/redis",
                "ioredis",
                "*/util/routes/**",
              ],
              message:
                "domain/ must stay pure — no Redis/repository access. Read state in control/ and pass it in as a parameter.",
            },
            {
              group: ["~/server/util/flair/**", "*/util/flair/**", "axios"],
              message:
                "domain/ must stay pure — no Flair client access. Fetch readings in control/ and pass them in as a parameter.",
            },
            {
              group: ["node-cron"],
              message:
                "domain/ must stay pure — the tick timer lives in control/, not domain/.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "domain/ must stay pure — no direct network access. Fetch in control/ and pass the result in as a parameter.",
        },
      ],
    },
  },
  {
    name: "client-react-config",
    files: ["{src,tests}/client/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
        console: true,
        process: true,
        module: true,
        require: true,
      },
    },
    plugins: {
      "@typescript-eslint": ts,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // TypeScript already checks for undefined/unused bindings — the base
      // rules don't understand TS-only constructs (interface method
      // signatures, function-type params) and misfire on them.
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "warn",
    },
  },
]);

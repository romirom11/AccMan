// ESLint 9 flat config. Uses only the packages already in devDependencies
// (@typescript-eslint/*, eslint-plugin-react-hooks, eslint-plugin-react-refresh).
import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"

const tsRecommended = tsPlugin.configs["flat/recommended"]

export default [
  {
    ignores: ["dist/**", "node_modules/**", "**/*.d.ts", "tsconfig.tsbuildinfo"],
  },

  // typescript-eslint recommended (parser + plugin, eslint-recommended overrides, rules).
  ...tsRecommended.map((config) => ({
    ...config,
    files: config.files ?? ["**/*.{ts,tsx}"],
  })),

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },

  // Vendored shadcn/ui components: keep their upstream shape.
  {
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // Node-run tests and config files.
  {
    files: ["tests/**/*.ts", "*.config.{js,ts,mjs}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]

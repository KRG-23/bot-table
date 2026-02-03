const tseslint = require("typescript-eslint");
const pluginImport = require("eslint-plugin-import");

module.exports = tseslint.config(
  // Base ignores
  {
    ignores: ["dist", "node_modules", "coverage"]
  },
  // TypeScript recommended rules
  ...tseslint.configs.recommended,
  // Project rules
  {
    files: ["src/**/*.ts"],
    plugins: {
      import: pluginImport
    },
    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".ts"]
        }
      }
    },
    rules: {
      "import/order": [
        "error",
        {
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true }
        }
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off"
    }
  }
);

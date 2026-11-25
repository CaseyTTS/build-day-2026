// ESLint flat config: recommended JS + type-aware TypeScript rules.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  // node:test returns promises from test(); the runner awaits them for you.
  { files: ["test/**/*.ts"], rules: { "@typescript-eslint/no-floating-promises": "off" } },
  { files: ["eslint.config.js"], ...tseslint.configs.disableTypeChecked },
);

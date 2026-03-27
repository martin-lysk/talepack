import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
	pluginJs.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.{js,ts}"],
		languageOptions: {
			parserOptions: {
				tsconfigRootDir: __dirname,
			},
		},
		rules: {
			"no-restricted-imports": [
				"error",
				{
					name: "no import from dist",
					message:
						"Importing from the compiled dist is not allowed (and you likely did this by accident). Import from source directly instead e.g. `./file.js`",
				},
			],
		},
	},
	{
		files: ["**/*.test.ts"],
		rules: {
			// any makes testing sometimes easier
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
];

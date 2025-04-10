/**
 * @type {import('@types/eslint').ESLint.ConfigData}
 */
module.exports = {
	root: true,

	env: {
		browser: true,
		es6: true,
		node: true,
	},

	parser: "@typescript-eslint/parser",

	parserOptions: {
		project: ["./tsconfig.json"],
		sourceType: "module",
		extraFileExtensions: [".json"],
	},

	ignorePatterns: [
		".eslintrc.js",
		"**/*.js",
		"**/node_modules/**",
		"**/dist/**",
	],

	// Adding global rules to disable template literal warnings
	rules: {
		"prefer-template": "off",
		"no-useless-template-literals": "off",
		"@typescript-eslint/restrict-template-expressions": "off",
		"@typescript-eslint/no-unnecessary-template-expression": "off",
		"@typescript-eslint/no-template-literals-if-not-needed": "off",
		"@typescript-eslint/prefer-string-literals": "off",
		"sort-keys": "off",
		"@typescript-eslint/quotes": "off",
		"@typescript-eslint/no-redundant-type-constituents": "off",
	},

	overrides: [
		{
			files: ["package.json"],
			plugins: ["eslint-plugin-n8n-nodes-base"],
			extends: ["plugin:n8n-nodes-base/community"],
			rules: {
				"n8n-nodes-base/community-package-json-name-still-default": "off",
				"n8n-nodes-base/community-package-json-author-email-still-default":
					"off",
				"n8n-nodes-base/community-package-json-author-name-still-default":
					"off",
				"n8n-nodes-base/community-package-json-description-still-default":
					"off",
			},
		},
		{
			files: ["./nodes/Ventriloquist/actions/decision.operation.ts"],
			rules: {
				// Disable all template literal rules for this file
				"@typescript-eslint/no-unnecessary-template-literal": "off",
				"@typescript-eslint/prefer-string-literals": "off",
				"@typescript-eslint/restrict-template-expressions": "off",
				"@typescript-eslint/no-template-literals-if-not-needed": "off",
			},
		},
		{
			files: ["./credentials/**/*.ts"],
			plugins: ["eslint-plugin-n8n-nodes-base"],
			extends: ["plugin:n8n-nodes-base/credentials"],
			rules: {
				"n8n-nodes-base/cred-class-field-documentation-url-missing": "off",
				"n8n-nodes-base/cred-class-field-documentation-url-miscased": "off",
				"n8n-nodes-base/cred-class-field-documentation-url-not-http-url": "off",
			},
		},
		{
			files: ["./nodes/**/*.ts"],
			plugins: ["eslint-plugin-n8n-nodes-base"],
			extends: ["plugin:n8n-nodes-base/nodes"],
			rules: {
				"n8n-nodes-base/node-execute-block-missing-continue-on-fail": "off",
				"n8n-nodes-base/node-resource-description-filename-against-convention":
					"off",
				"n8n-nodes-base/node-param-fixed-collection-type-unsorted-items": "off",
				"n8n-nodes-base/node-param-options-type-unsorted-items": "off",
				"n8n-nodes-base/node-param-collection-type-unsorted-items": "off",
				"n8n-nodes-base/node-execute-block-wrong-error-thrown": "off",
				"n8n-nodes-base/node-param-description-boolean-without-whether": "off",
				"n8n-nodes-base/node-class-description-inputs-wrong-regular-node":
					"off",
				"n8n-nodes-base/node-class-description-outputs-wrong": "off",
				"n8n-nodes-base/node-param-operation-option-without-action": "off",
			},
		},
	],
};

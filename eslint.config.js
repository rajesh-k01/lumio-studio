// Run with: npm run lint
const globals = require("globals");
const js = require("@eslint/js");

const rules = {
  "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
  "no-empty": ["warn", { allowEmptyCatch: true }],
  eqeqeq: ["warn", "smart"],
  "no-prototype-builtins": "off",
  "no-inner-declarations": "off",
  "no-cond-assign": "off",
  "no-constant-condition": "off",
  "no-useless-escape": "warn"
};

module.exports = [
  { ignores: ["node_modules/**", "dist/**", "data/**", "public/ai-web/**", "ai-web/**", "index.html"] },
  js.configs.recommended,
  {
    files: ["public/js/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, module: "writable", require: "readonly", Lumio: "writable", UI: "writable", Photo: "writable", Video: "writable", Tools: "writable", LumioEngine: "writable", LumioFeatures: "writable" } }
  },
  { files: ["server/**/*.js", "test/**/*.js", "scripts/**/*.js", "ai/train/*.js", "eslint.config.js"], languageOptions: { sourceType: "commonjs", globals: { ...globals.node } } },
  { rules }
];

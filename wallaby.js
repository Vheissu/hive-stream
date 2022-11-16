module.exports = function (wallaby) {
  return {
    files: [
      "**/*.css",
      "**/*.json",
      "src/**/*.ts",
      "src/**/*.html",
      "tests/setup.ts",
      "tsconfig.json",
    ],

    tests: ["tests/**/*.spec.ts"],

    compilers: {
      "**/*.ts": wallaby.compilers.typeScript({
        module: "commonjs",
        typescript: require("typescript"),
      }),
    },

    env: {
      runner: "node",
      type: "node",
    },
  };
};

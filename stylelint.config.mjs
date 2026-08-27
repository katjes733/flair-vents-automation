export default {
  extends: ["stylelint-config-standard"],
  rules: {
    // css-tree 3.x doesn't resolve <cursor-predefined> — disable until upstream fix
    "declaration-property-value-no-unknown": null,
  },
};

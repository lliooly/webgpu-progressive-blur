# Consumption fixtures

These fixtures are intentionally small source projects. They do not contain generated components or `node_modules`; their committed `package-lock.json` files freeze the dependency graph. `scripts/verify-fixtures.mjs` copies each fixture to a temporary directory, installs the locked framework versions, installs the current package tarball, runs the CLI, and then performs the type/build checks.

# Consumption fixtures

These fixtures are intentionally small source projects. They do not contain generated components or `node_modules`; their committed `package-lock.json` files freeze the dependency graph. `scripts/verify-fixtures.mjs` copies each fixture to a temporary directory, installs the locked framework versions, installs the current package tarball, runs the CLI, and then performs the type/build checks.

`dom-capture-layout` is a separate browser regression fixture using the real capture library. Run `npx vite --config tests/fixtures/dom-capture-layout/vite.config.ts` and open `http://127.0.0.1:4174/tests/fixtures/dom-capture-layout/index.html`. It first reproduces the old layout shift, then checks pixel alignment, clone geometry, subtree exclusion and live-page preservation for sticky, relative and fixed targets with both capture strategies. All 31 checks should report PASS.

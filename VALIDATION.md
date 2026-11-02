# Validation — 0.1.0

- TypeScript strict type check: passed.
- Automated tests: **51 passed, 0 failed** using Node's test runner.
- Core cases: Unicode controls, paragraph boundaries, Persian ZWNJ, UTF-16 offsets after emoji, CRLF/CR input, CSS/Tailwind fixes and parser exclusions, TeX provider detection, prose exclusions and exact wrapper edits.
- Adapter cases: manifest commands, diagnostics and Quick Fix wiring, stale-edit rejection, workspace-local TeX roots, file-size bounds, selection wrapping, scriptless preview options and workspace scan aggregation.
- Preview security: source is escaped; scripts and remote resources are disallowed by webview options and CSP.
- Dependency audit: **0 known vulnerabilities** reported for production dependencies after updating PostCSS to 8.5.32.
- Package: built with the official VS Code `vsce` packager; includes the compiled runtime, required notices, examples and guides.

The adapter tests use a VS Code API test double. A graphical Extension Development Host was not available in this build environment, and the TeX installation does not include XePersian/bidi, so full graphical VS Code interaction and final XePersian PDF compilation were not run. The supplied source examples and F5 launch configuration support these next checks on a configured developer machine.

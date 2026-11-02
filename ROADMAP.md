# Next steps

This release deliberately separates universal text behavior from format-specific rules.

1. Run the packaged extension with Persian, Arabic and Hebrew users in a real VS Code session; review suggestion noise, cursor navigation expectations and preview readability.
2. Add a TeX parser adapter for custom direction commands/environments and more complex preamble discovery; verify against an installed XePersian/bidi toolchain in CI.
3. Add format adapters for HTML `dir` inheritance, Markdown prose/code boundaries, and localization JSON/YAML values.
4. Support dynamic Vue/Svelte class expressions and more CSS-in-JS patterns through their real parsers.
5. Add line-level suppression and a project-level direction policy. Keep fixes explicit and reversible.
6. Add graphical Extension Host integration tests on Windows and Linux before Marketplace publication.

Publishing requires an owner-selected publisher identity, repository URL, support policy and real-user validation. No Marketplace publication or user-machine installation is performed by this project scaffold.

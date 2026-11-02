# RTL Layout Guard

A local-first VS Code extension for reviewing right-to-left text and direction-sensitive layouts. Version **0.1.0** is an installable development release, with a shared Unicode layer and separate LaTeX, CSS and Tailwind analyzers.

فارسی: راهنمای فارسی در فایل `README.fa.md` همراه پروژه قرار دارد.

## Install

Requires desktop VS Code **1.95 or newer**. In the Extensions view, open the `…` menu, choose **Install from VSIX…**, and select `rtl-layout-guard-0.1.0.vsix`. Reload VS Code if prompted. No account, API key or companion extension is required.

The development publisher ID is `rtl-layout-guard-dev`. This is a sideloadable package; it has not been published to the Marketplace. Choose your own publisher ID before publishing.

## What it does

| Layer | Coverage in 0.1.0 |
| --- | --- |
| Unicode | All open text documents, including notebook-cell text: literal bidi overrides, legacy embeddings and unmatched directional controls. Inspect LRM/RLM/ALM and isolates by name and location. Persian ZWNJ and ZWJ are left alone. |
| LaTeX | Suggest wrappers around unwrapped Latin runs on RTL prose lines. Recognize XePersian, bidi/luabidi, and RTL Polyglossia; recognize RTL Babel setup without guessing its wrapper macros. Check explicit pdfTeX engine magic comments when a known Unicode bidi provider is present. |
| CSS | Review physical left/right margin, padding, inset, border, scroll margin/padding, text alignment, float and clear. Includes basic SCSS declarations and HTML style blocks/attributes. |
| React / Tailwind | Review static JSX/TSX class attributes, `cn`, `clsx`, `classNames`, `twMerge`, arrays, conditional branches and class-map keys. Review JSX style objects. Retain variants, negative values, important markers and arbitrary values. |
| HTML / Vue / Svelte | Review static class attributes, inline styles and style blocks. Dynamic Vue/Svelte class expressions are outside this first release. |
| Text preview | A scriptless, escaped source view with Auto / RTL / LTR base direction and an inventory of invisible direction controls. Works on any text document. |

Physical left/right properties are **review suggestions**, not proof of a bug. They can be correct in a map, chart, directional icon or fixed physical arrangement. Layout Quick Fixes offer both interpretations: a side as used in an LTR source layout, or a side as used in an RTL source layout. No layout fixes run automatically or through Fix All. Check utility availability against your Tailwind version (logical spacing generally requires Tailwind 3.3+).

Examples:

```css
/* Review intent before choosing the corresponding logical side. */
.card { margin-left: 12px; text-align: right; }
```

```tsx
<div className={cn('md:ml-4', selected && 'pr-2')} />
// Suggestions include md:ms-4 / md:me-4 and pe-2 / ps-2.
// Explicit rtl:ml-4 and ltr:mr-4 variants are not flagged.
```

## LaTeX use

Open `examples/persian.tex`. With XePersian configured, this text:

```tex
این مقاله درباره React و TypeScript است.
```

offers individual Quick Fixes such as:

```tex
این مقاله درباره \lr{React} و \lr{TypeScript} است.
```

In XePersian documents, selection wrapping uses `\lr{...}` / `\rl{...}`. With bidi/RTL Polyglossia it uses `\textLR{...}` / `\textRL{...}`. In automatic mode, unrecognized setups receive advice but **no undefined macros are inserted**. If a custom or indirectly included preamble loads a compatible provider, explicitly set `rtlLayoutGuard.latex.directionPackage` to `xepersian` or `bidi`.

For split documents, put an explicit root comment near the top of a chapter:

```tex
% !TeX root = ../main.tex
```

The extension reads up to five root links within the same open workspace folder. It uses unsaved root-document contents when available. It does not recursively expand arbitrary `\input`, execute TeX or read roots outside the workspace. XePersian and fonts must be installed in your TeX distribution to compile the example; its `DejaVu Sans` font can be changed to an installed Persian font.

Known math environments, inline math, comments, code environments, citations, labels, URLs and existing direction wrappers are excluded from prose checks. This is a source heuristic, **not a TeX macro expansion engine**. Packages hidden in arbitrary macros and user-defined verbatim/direction environments are not fully inferred. The mixed-Latin rule is informational: an explicit wrapper is not necessary for every Latin token.

The extension does **not** replace your TeX compiler or LaTeX Workshop PDF preview. Its own preview displays **escaped source text**, not rendered TeX mathematics or typeset pages. Compile to validate final line breaking, fonts and direction.

## Commands

Open the Command Palette and search for `RTL Guard`:

- **Scan Current Document** — rescan and show a count.
- **Scan Workspace** — cancellable scan of configured text-file patterns; default limit 500 files, 512 KiB each.
- **Open Direction-Aware Text Preview** — live source preview with line-level direction controls.
- **Wrap Selected Text as LTR / RTL** — provider-specific LaTeX macros; otherwise Unicode LRI/RLI + PDI pairs. Select only prose or string contents, not source identifiers. Each selected source line gets its own isolate pair; do not assume every downstream renderer implements isolates.
- **Inspect Invisible Direction Controls** — list literal direction marks/controls and jump to one.
- **Enable / Disable for This Workspace**.

Quick Fixes are available via the lightbulb or `Ctrl+.` / `Cmd+.`. There is no automatic Fix All. In multi-paragraph LaTeX selections, use a TeX direction environment instead of an inline wrapper.

## Configuration

```json
{
  "rtlLayoutGuard.enabled": true,
  "rtlLayoutGuard.css.enabled": true,
  "rtlLayoutGuard.tailwind.enabled": true,
  "rtlLayoutGuard.tailwind.classFunctions": ["cn", "clsx", "classNames", "twMerge"],
  "rtlLayoutGuard.latex.enabled": true,
  "rtlLayoutGuard.latex.directionPackage": "auto",
  "rtlLayoutGuard.latex.mixedLatin": true,
  "rtlLayoutGuard.unicode.enabled": true,
  "rtlLayoutGuard.preview.direction": "auto",
  "rtlLayoutGuard.maxFileSizeKB": 512,
  "rtlLayoutGuard.workspace.maxFiles": 500,
  "rtlLayoutGuard.ignoredRules": []
}
```

The default workspace glob covers common text/code files; edit `workspace.include` for other extensions. All open text documents are still eligible for Unicode checks regardless of this glob. Plain text, Markdown and custom text languages get Unicode analysis and text preview; this release does not interpret every file format's direction markup.

| Rule ID | Default severity |
| --- | --- |
| `css/physical-property` | Information |
| `css/physical-value` | Information |
| `tailwind/physical-utility` | Information |
| `latex/mixed-latin` | Information |
| `latex/rtl-setup` | Information |
| `latex/engine` | Warning |
| `unicode/override` | Warning |
| `unicode/unbalanced-control` | Warning |
| `unicode/legacy-embedding` | Information |

Add rule IDs to `rtlLayoutGuard.ignoredRules` to suppress them. Unicode checks examine **literal** characters, not escape sequences such as `"\\u202e"` in JSON or JavaScript. An opener ending at a Unicode paragraph boundary can be intentional; the unmatched-control rule asks for review rather than claiming invalid Unicode. It is not a complete implementation of UAX #9 embedding-level overflow handling.

## Privacy and editor behavior

All analysis is local. No telemetry, model calls, network requests, shell commands or package installation occurs during extension use. Text preview escapes source, blocks scripts and remote resources, and never patches VS Code or another extension. File changes occur only when you explicitly apply a Quick Fix or selection-wrapping command. This extension does not change VS Code's native cursor, selection or source-editor bidirectional rendering.

## Development

Use Node.js **20+**:

```sh
npm ci
npm run check
npm test
npm run build
```

Open this folder in VS Code and press **F5** to launch an Extension Development Host with `examples/`. To package, make sure the sibling `deliverables/` directory exists, then run `npm run package`.

Pure analyzers live in `src/core/`; the VS Code adapter is `src/extension.ts`. Tests cover offsets, parser exclusions, fixes, Unicode balancing, LaTeX provider/root handling, preview escaping and extension/API wiring. Adapter tests use a VS Code API test double; they are not graphical Extension Host tests. The source archive includes the compiled extension, so you can sideload the supplied VSIX before installing build dependencies.

## References

- [VS Code Diagnostics and Code Actions](https://code.visualstudio.com/api/language-extensions/programmatic-language-features)
- [VS Code Webview security](https://code.visualstudio.com/api/extension-guides/webview)
- [Unicode Bidirectional Algorithm, UAX #9](https://www.unicode.org/reports/tr9/)
- [W3C: Inline markup and bidirectional text](https://www.w3.org/International/articles/inline-bidi-markup/)
- [XePersian](https://ctan.org/pkg/xepersian) and [bidi](https://ctan.org/pkg/bidi)
- [Tailwind logical margin utilities](https://tailwindcss.com/docs/margin)

MIT license. Bundled dependency licenses are in `third-party/`.

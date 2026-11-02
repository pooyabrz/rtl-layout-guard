const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.cjs');
const only = (issues, rule) => issues.filter(issue => issue.rule === rule);
const tex = text => String.raw`\documentclass{article}
\usepackage{xepersian}
\begin{document}
${text}
\end{document}`;
function apply(text, fix) {
  return [...fix.edits].sort((a, b) => b.start - a.start).reduce((value, edit) => value.slice(0, edit.start) + edit.text + value.slice(edit.end), text);
}

test('Persian half-spaces, Arabic shaping marks and Hebrew are accepted without spurious Unicode warnings', () => {
  assert.deepEqual(core.analyze('می\u200cخواهم متن فارسی؛ العربية وשלום\u200d', 'plaintext'), []);
});
test('UTF-16 locations stay correct after an emoji', () => {
  const issues = core.analyze('😀\u202eabc\u202c', 'python');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'unicode/override');
  assert.equal(issues[0].start, 2);
  assert.equal(apply('😀\u202eabc\u202c', issues[0].fixes[0]), '😀abc\u202c');
});
test('well-formed nested isolates have no diagnostics', () => {
  assert.deepEqual(core.analyzeUnicode('فارسی \u2066React \u2067שלום\u2069 19\u2069'), []);
});
test('PDI closes nested embeddings implicitly but PDF cannot close an isolate', () => {
  const valid = core.analyzeUnicode('\u2066\u202aabc\u2069');
  assert.deepEqual(valid.map(issue => issue.rule), ['unicode/legacy-embedding']);
  const invalid = core.analyzeUnicode('\u2066x\u202c\u2069');
  assert.equal(only(invalid, 'unicode/unbalanced-control').length, 1);
});
test('an isolate crossing a paragraph boundary is reported at both unmatched controls', () => {
  const issues = core.analyzeUnicode('\u2066abc\r\nفارسی\u2069');
  assert.deepEqual(issues.map(issue => issue.start), [0, 11]);
});
test('LS is not a paragraph separator; PS is', () => {
  assert.equal(core.analyzeUnicode('\u2066abc\u2028def\u2069').length, 0);
  assert.equal(core.analyzeUnicode('\u2066abc\u2029def\u2069').length, 2);
});
test('direction inspector lists marks without treating marks as errors', () => {
  assert.equal(core.listControls('a\u200fب\u061c\u200e').length, 3);
  assert.equal(core.analyzeUnicode('a\u200fب\u061c\u200e').length, 0);
});
test('multiline wrapping never leaves isolates spanning source paragraphs', () => {
  const wrapped = core.isolateLines('hello\r\nworld\n\nשלום', 'ltr');
  assert.equal(wrapped, '\u2066hello\u2069\r\n\u2066world\u2069\n\n\u2066שלום\u2069');
  assert.deepEqual(core.analyzeUnicode(wrapped), []);
});

test('CSS suggestions preserve value, important, CRLF and surrounding comments', () => {
  const source = '/* margin-left: 99px */\r\n.card { margin-left: 12px !important; }';
  const [issue] = core.analyze(source, 'css');
  assert.equal(source.slice(issue.start, issue.end), 'margin-left');
  assert.equal(apply(source, issue.fixes[0]), '/* margin-left: 99px */\r\n.card { margin-inline-start: 12px !important; }');
  assert.equal(apply(source, issue.fixes[1]), '/* margin-left: 99px */\r\n.card { margin-inline-end: 12px !important; }');
});
test('CSS values are changed without replacing the property or other declarations', () => {
  const source = '.x { text-align: right !important; float: left; clear: right }';
  const issues = core.analyze(source, 'css');
  assert.equal(issues.length, 3);
  assert.equal(apply(source, issues[0].fixes[0]), '.x { text-align: end !important; float: left; clear: right }');
  assert.equal(apply(source, issues[1].fixes[0]), '.x { text-align: right !important; float: inline-start; clear: right }');
});
test('CSS strings, URLs, custom properties and logical properties are not linted as declarations', () => {
  const source = '.x {content: "margin-left: 4px"; --margin-left: 8px; background: url("left.png"); margin-inline-start: 2px; }';
  assert.deepEqual(core.analyze(source, 'css'), []);
});
test('CSS source maps are never probed or loaded from workspace comments', () => {
  const fs = require('node:fs');
  const original = fs.existsSync;
  let probed = false;
  fs.existsSync = function(path) { if (String(path).includes('rtl-guard-private.map')) probed = true; return original.call(this, path); };
  try {
    const source = '.x { margin-left: 2px }\n/*# sourceMappingURL=/tmp/rtl-guard-private.map */';
    assert.equal(core.analyze(source, 'css').length, 1);
    assert.equal(probed, false);
  } finally { fs.existsSync = original; }
});
test('incomplete CSS produces bounded edits rather than throwing', () => {
  const source = '.x { margin-left: 2px; padding-right:';
  const issues = core.analyze(source, 'css');
  assert.ok(issues.length >= 1);
  for (const issue of issues) assert.ok(issue.start >= 0 && issue.end <= source.length);
});

test('Tailwind retains variants, negative sign and important markers', () => {
  const value = 'md:hover:!-ml-[3px] [&:hover]:mr-2 text-left!';
  const issues = core.analyzeClasses(value, 0);
  assert.equal(issues.length, 3);
  assert.equal(apply(value, issues[0].fixes[0]), 'md:hover:!-ms-[3px] [&:hover]:mr-2 text-left!');
  assert.equal(apply(value, issues[1].fixes[0]), 'md:hover:!-ml-[3px] [&:hover]:me-2 text-left!');
  assert.equal(apply(value, issues[2].fixes[0]), 'md:hover:!-ml-[3px] [&:hover]:mr-2 text-start!');
});
test('intentional direction variants and already logical classes are skipped', () => {
  assert.deepEqual(core.analyzeClasses('rtl:ml-4 ltr:mr-3 md:rtl:pr-1 ms-2 text-start border-s-2', 0), []);
});
test('arbitrary property utilities are translated as a whole token', () => {
  const [issue] = core.analyzeClasses('hover:[margin-left:var(--gap)]', 10);
  assert.equal(issue.start, 10);
  assert.equal(issue.fixes[0].edits[0].text, 'hover:[margin-inline-start:var(--gap)]');
});
test('bare border utilities and color utilities both retain their suffix', () => {
  const issues = core.analyzeClasses('border-l border-r-red-400', 0);
  assert.equal(issues[0].fixes[0].edits[0].text, 'border-s');
  assert.equal(issues[1].fixes[0].edits[0].text, 'border-e-red-400');
});

test('JSX className and inline styles use exact original source positions', () => {
  const source = 'const element = <div className="ml-4" style={{ paddingRight: 8, textAlign: "left" }} />;';
  const issues = core.analyze(source, 'typescriptreact', 'sample.tsx');
  assert.equal(issues.length, 3);
  assert.deepEqual(issues.map(issue => source.slice(issue.start, issue.end)), ['ml-4', 'paddingRight', 'left']);
  assert.ok(apply(source, issues[1].fixes[0]).includes('paddingInlineEnd: 8'));
});
test('class helper arguments support arrays, conditions and class-map keys once each', () => {
  const source = `const x = <div className={cn('ml-2', active && 'pr-3', {'text-right': selected}, active ? 'left-0' : 'right-0')} />`;
  const issues = core.analyze(source, 'typescriptreact', 'x.tsx');
  assert.equal(issues.length, 5);
  assert.equal(new Set(issues.map(issue => issue.start)).size, 5);
});
test('ordinary strings and commented JSX are not mistaken for Tailwind classes', () => {
  const source = `const label = 'ml-4'; /* <div className="mr-4"/> */ const x = <div title="pr-2"/>;`;
  assert.deepEqual(core.analyze(source, 'typescriptreact', 'x.tsx'), []);
});
test('dynamic class interpolation is left untouched', () => {
  assert.deepEqual(core.analyze('const x = <div className={`ml-${count}`} />', 'typescriptreact', 'x.tsx'), []);
});
test('custom class functions are opt-in', () => {
  assert.equal(core.analyze(`custom('ml-4')`, 'typescript', 'x.ts').length, 0);
  assert.equal(core.analyze(`custom('ml-4')`, 'typescript', 'x.ts', { classFunctions: ['custom'] }).length, 1);
});
test('HTML quoted > characters do not terminate tags; inline styles keep offsets', () => {
  const source = '<div title="x > y" class="ml-2" style="padding-right:8px">متن</div>';
  const issues = core.analyze(source, 'html');
  assert.deepEqual(issues.map(issue => source.slice(issue.start, issue.end)), ['ml-2', 'padding-right']);
});
test('attributes inside attribute values, script bodies and HTML comments are ignored', () => {
  const source = `<div data-label=" class='ml-4'" :class="'pr-2'"></div><script>const x='<div class="mr-2">';</script><!-- <div class="left-0"> -->`;
  assert.deepEqual(core.analyze(source, 'vue'), []);
});
test('HTML style blocks and unquoted static classes are checked', () => {
  const source = '<style>.x { border-left-color:red }</style><div class=ml-4></div>';
  const issues = core.analyze(source, 'html');
  assert.deepEqual(issues.map(issue => source.slice(issue.start, issue.end)), ['border-left-color', 'ml-4']);
});

test('LaTeX wraps a Latin run using XePersian and preserves surrounding text', () => {
  const source = tex('این متن درباره React و TypeScript است.');
  const issues = core.analyze(source, 'latex');
  assert.equal(issues.length, 2);
  assert.equal(source.slice(issues[0].start, issues[0].end), 'React');
  assert.ok(apply(source, issues[0].fixes[0]).includes(String.raw`درباره \lr{React} و`));
});
test('existing direction commands, comments, URLs, citations and math are ignored', () => {
  const source = tex(String.raw`این \lr{React} و \textLR{Node} و $English$ و \(Math\) است.
% این Comment است
این \url{https://example.com/English} و \cite{RefName} است.`);
  assert.deepEqual(core.analyze(source, 'latex'), []);
});
test('verbatim, minted, lstlisting and Latin environments are not treated as RTL prose', () => {
  const source = tex(String.raw`\begin{minted}{js}
const x = 'فارسی English';
\end{minted}
\begin{latin}
فارسی English
\end{latin}
\verb|فارسی English %|`);
  assert.deepEqual(core.analyze(source, 'latex'), []);
});
test('masked commands cannot merge separate Latin spans into a destructive replacement', () => {
  const source = tex(String.raw`این React \lr{Already Wrapped} Vue است.`);
  const issues = core.analyze(source, 'latex');
  assert.deepEqual(issues.map(issue => source.slice(issue.start, issue.end)), ['React', 'Vue']);
});
test('LaTeX title text remains inspectable inside normal formatting commands', () => {
  const source = tex(String.raw`\section{آموزش React}`);
  const issues = core.analyze(source, 'latex');
  assert.equal(issues.length, 1);
  assert.equal(source.slice(issues[0].start, issues[0].end), 'React');
});
test('root preambles enable correct wrappers for chapter fragments', () => {
  const source = 'این React است.';
  const issues = core.analyze(source, 'latex', 'chapter.tex', { latexRootText: tex('') });
  assert.equal(issues[0].fixes[0].edits[0].text, String.raw`\lr{React}`);
});
test('no provider means no undefined direction macros are inserted', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
این React است.
\end{document}`;
  const issues = core.analyze(source, 'latex');
  assert.equal(only(issues, 'latex/rtl-setup').length, 1);
  assert.equal(only(issues, 'latex/mixed-latin')[0].fixes.length, 0);
});
test('Babel RTL setup is recognized without assuming XePersian command availability', () => {
  const setup = core.detectLatexSetup(String.raw`\usepackage[english,arabic]{babel}`);
  assert.deepEqual(setup, { provider: 'none', supported: true });
});
test('Polyglossia with RTL language uses bidi direction wrappers', () => {
  const setup = core.detectLatexSetup(String.raw`\usepackage{polyglossia}\setmainlanguage{hebrew}`);
  assert.equal(setup.provider, 'bidi');
  assert.equal(core.latexWrapper(setup.provider, 'ltr'), 'textLR');
});
test('commented packages do not enable fixes', () => {
  assert.equal(core.detectLatexSetup('% \\usepackage{xepersian}').supported, false);
});
test('engine advice targets only a real incompatible magic comment', () => {
  const source = '% !TeX program = pdflatex\n' + tex('متن فارسی');
  const [issue] = core.analyze(source, 'latex');
  assert.equal(issue.rule, 'latex/engine');
  assert.ok(apply(source, issue.fixes[0]).startsWith('% !TeX program = xelatex'));
});
test('CRLF and emoji do not shift LaTeX Quick Fix ranges', () => {
  const source = tex('😀 این React است.').replaceAll('\n', '\r\n');
  const [issue] = core.analyze(source, 'latex');
  assert.equal(source.slice(issue.start, issue.end), 'React');
  assert.ok(apply(source, issue.fixes[0]).includes(String.raw`😀 این \lr{React} است.`));
});
test('LaTeX files with CR-only newlines retain prose after a comment', () => {
  const source = '% یک Comment\rاین React است.';
  const issues = core.analyze(source, 'latex', 'x.tex', { directionPackage: 'xepersian' });
  assert.equal(issues.length, 1);
  assert.equal(source.slice(issues[0].start, issues[0].end), 'React');
});
test('long escaped backslash runs and escaped braces stay bounded and preserve source offsets', () => {
  const source = tex(String.raw`این \lr{English \{literal\}} است.` + '\n' + '\\\\'.repeat(16000));
  assert.equal(core.latexProse(source).length, source.length);
  assert.deepEqual(core.analyze(source, 'latex'), []);
});

test('ignored rules and individual rule families are honored', () => {
  assert.deepEqual(core.analyze('.x{margin-left:1px}', 'css', 'x.css', { ignoredRules: ['css/physical-property'] }), []);
  assert.deepEqual(core.analyze('.x{margin-left:1px}', 'css', 'x.css', { css: false }), []);
  assert.deepEqual(core.analyze('\u202eabc', 'plaintext', 'x.txt', { unicode: false }), []);
});
test('unknown text languages still receive Unicode inspection', () => {
  assert.equal(core.analyze('\u2069', 'custom-language').length, 1);
});
test('preview escapes HTML and TeX source; it cannot run scripts or load external resources', () => {
  const html = core.renderPreview('<script>alert(1)</script>\nفارسی \\lr{English}', '<img src=x>', 'latex', 'testnonce');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("script-src 'none'"));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(html.includes('LaTeX source preview only'));
});
test('preview exposes all three base-direction controls and invisible control inventory', () => {
  const html = core.renderPreview('فارسی \u2066English\u2069', 'sample', 'plaintext', 'nonce', 'rtl');
  assert.ok(html.includes('id="dir-rtl" name="direction" type="radio" checked'));
  assert.ok(html.includes('LRI U+2066'));
  assert.ok(html.includes('PDI U+2069'));
});

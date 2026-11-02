const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// API contract tests exercise the actual bundled extension against a small VS Code
// test double. No claim of a graphical Extension Host test is made here.
function environment(initialSettings = {}) {
  const callbacks = {}, commands = new Map(), docs = [], diagnostics = new Map();
  const settings = { ...initialSettings };
  const disposable = () => ({ dispose() {} });
  const on = name => callback => { callbacks[name] = callback; return disposable(); };
  class Uri {
    constructor(value) { this.path = value; this.scheme = 'file'; this.authority = ''; }
    toString() { return `file://${this.path}`; }
    with(change) { return Object.assign(new Uri(this.path), this, change); }
    static joinPath(uri, value) { return uri.with({ path: path.posix.join(uri.path, value) }); }
  }
  class Position { constructor(line, character) { this.line = line; this.character = character; } }
  class Range { constructor(start, end) { this.start = start; this.end = end; } }
  class Selection extends Range { get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; } }
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  class WorkspaceEdit {
    edits = [];
    replace(uri, range, text) { this.edits.push({ uri, range, text }); }
  }
  class CodeAction { constructor(title, kind) { Object.assign(this, { title, kind }); } }
  const collection = {
    set(uri, items) { diagnostics.set(uri.toString(), items); }, get(uri) { return diagnostics.get(uri.toString()); },
    delete(uri) { diagnostics.delete(uri.toString()); }, clear() { diagnostics.clear(); }, dispose() {},
    *[Symbol.iterator]() { for (const [key, items] of diagnostics) yield [new Uri(key.replace('file://', '')), items]; }
  };
  const notices = [];
  const api = {
    Uri, Position, Range, Selection, Diagnostic, WorkspaceEdit, CodeAction,
    DiagnosticSeverity: { Warning: 1, Information: 2 }, CodeActionKind: { QuickFix: 'quickfix' },
    StatusBarAlignment: { Right: 2 }, ConfigurationTarget: { Workspace: 2, Global: 1 },
    ViewColumn: { Beside: 2 }, ProgressLocation: { Notification: 15 },
    workspace: {
      textDocuments: docs, workspaceFolders: [{ uri: new Uri('/project') }],
      getWorkspaceFolder: () => ({ uri: new Uri('/project') }),
      getConfiguration: () => ({ get(key, fallback) { return Object.hasOwn(settings, key) ? settings[key] : fallback; }, async update(key, value) { settings[key] = value; } }),
      fs: { async stat(uri) { const doc = docs.find(d => d.uri.toString() === uri.toString()); if (!doc) throw Error('not found'); return { size: Buffer.byteLength(doc.getText()) }; }, async readFile() { throw Error('unexpected filesystem read'); } },
      onDidOpenTextDocument: on('open'), onDidChangeTextDocument: on('change'), onDidCloseTextDocument: on('close'), onDidChangeConfiguration: on('config'),
      async findFiles() { return docs.map(doc => doc.uri); }, async openTextDocument(uri) { return docs.find(doc => doc.uri.toString() === uri.toString()); }
    },
    window: {
      activeTextEditor: undefined,
      createStatusBarItem() { return { ...disposable(), show() {}, hide() {} }; },
      createOutputChannel() { return { ...disposable(), appendLine() {} }; },
      onDidChangeActiveTextEditor: on('active'),
      async showInformationMessage(message) { notices.push(message); },
      async showQuickPick(items) { return items[0]; },
      async showTextDocument(document) { return api.window.activeTextEditor; },
      async withProgress(_options, callback) { return callback({ report() {} }, { isCancellationRequested: false }); },
      createWebviewPanel(_type, title, _column, options) {
        const panel = { title, options, webview: { html: '' }, onDidDispose(fn) { this.close = fn; return disposable(); }, dispose() { this.close?.(); } };
        api.panel = panel; return panel;
      }
    },
    languages: { createDiagnosticCollection() { return collection; }, registerCodeActionsProvider(_selector, provider) { api.provider = provider; return disposable(); } },
    commands: { registerCommand(id, fn) { commands.set(id, fn); return disposable(); } }
  };
  function document(text, language = 'css', filename = '/project/example.css') {
    const doc = {
      uri: new Uri(filename), languageId: language, version: 1, isClosed: false, text,
      getText(range) { return range ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : this.text; },
      positionAt(offset) { const before = this.text.slice(0, offset); const lines = before.split('\n'); return new Position(lines.length - 1, lines.at(-1).length); },
      offsetAt(pos) { return this.text.split('\n').slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character; }
    };
    docs.push(doc);
    const empty = new Selection(new Position(0, 0), new Position(0, 0));
    api.window.activeTextEditor = {
      document: doc, selection: empty, selections: [empty], revealRange() {},
      async edit(callback) {
        const edits = [];
        callback({ replace(range, value) { edits.push({ start: doc.offsetAt(range.start), end: doc.offsetAt(range.end), value }); } });
        for (const edit of edits.sort((a, b) => b.start - a.start)) doc.text = doc.text.slice(0, edit.start) + edit.value + doc.text.slice(edit.end);
        doc.version++; return true;
      }
    };
    return doc;
  }
  const context = { subscriptions: [] };
  const original = Module._load;
  Module._load = function(request, parent, isMain) { return request === 'vscode' ? api : original.call(this, request, parent, isMain); };
  try {
    delete require.cache[require.resolve('../dist/extension.cjs')];
    require('../dist/extension.cjs').activate(context);
  } finally { Module._load = original; }
  return { api, context, document, commands, callbacks, diagnostics, notices,
    dispose() { for (const item of context.subscriptions) item.dispose(); } };
}

test('extension registers every manifest command, scans a document and produces executable Quick Fix edits', async () => {
  const env = environment();
  try {
    const manifest = require('../package.json');
    for (const command of manifest.contributes.commands) assert.ok(env.commands.has(command.command));
    const doc = env.document('.x { margin-left: 12px }');
    await env.commands.get('rtlLayoutGuard.scanDocument')();
    const diagnostics = env.diagnostics.get(doc.uri.toString());
    assert.equal(diagnostics.length, 1);
    const actions = env.api.provider.provideCodeActions(doc, undefined, { diagnostics });
    assert.equal(actions.length, 2);
    assert.equal(actions[0].edit.edits[0].text, 'margin-inline-start');
    assert.equal(actions[0].isPreferred, undefined);
    doc.version++;
    assert.equal(env.api.provider.provideCodeActions(doc, undefined, { diagnostics }).length, 0);
  } finally { env.dispose(); }
});
test('LaTeX root magic comments are resolved from open workspace documents', async () => {
  const env = environment();
  try {
    env.document('\\usepackage{xepersian}', 'latex', '/project/main.tex');
    const doc = env.document('% !TeX root = ../main.tex\nاین React است.', 'latex', '/project/chapters/one.tex');
    await env.commands.get('rtlLayoutGuard.scanDocument')();
    const [diagnostic] = env.diagnostics.get(doc.uri.toString());
    assert.equal(diagnostic.guardIssue.fixes[0].edits[0].text, '\\lr{React}');
  } finally { env.dispose(); }
});
test('LaTeX roots outside the workspace are not read automatically', async () => {
  const env = environment();
  try {
    const doc = env.document('% !TeX root = /private/main.tex\nاین React است.', 'latex', '/project/one.tex');
    await env.commands.get('rtlLayoutGuard.scanDocument')();
    assert.equal(env.diagnostics.get(doc.uri.toString())[0].guardIssue.fixes.length, 0);
  } finally { env.dispose(); }
});
test('disabled diagnostics and file-size bounds clear stale results', async () => {
  const env = environment({ enabled: false });
  try {
    const doc = env.document('.x { margin-left: 12px }');
    await env.commands.get('rtlLayoutGuard.scanDocument')();
    assert.equal(env.diagnostics.has(doc.uri.toString()), false);
  } finally { env.dispose(); }
});
test('oversized documents are not analyzed or rendered', async () => {
  const env = environment({ maxFileSizeKB: 16 });
  try {
    const doc = env.document('.x{margin-left:1px}' + ' '.repeat(17000));
    await env.commands.get('rtlLayoutGuard.scanDocument')();
    assert.equal(env.diagnostics.has(doc.uri.toString()), false);
    await env.commands.get('rtlLayoutGuard.preview')();
    assert.equal(env.api.panel, undefined);
  } finally { env.dispose(); }
});
test('preview uses a scriptless webview and escapes untrusted document contents', async () => {
  const env = environment();
  try {
    env.document('<script>alert(1)</script>فارسی', 'plaintext', '/project/text.txt');
    await env.commands.get('rtlLayoutGuard.preview')();
    assert.equal(env.api.panel.options.enableScripts, false);
    assert.deepEqual(env.api.panel.options.localResourceRoots, []);
    assert.ok(env.api.panel.webview.html.includes('&lt;script&gt;'));
  } finally { env.dispose(); }
});
test('selection wrapping applies XePersian macros in LaTeX and isolates in plain text', async () => {
  const env = environment({ 'latex.directionPackage': 'xepersian' });
  try {
    const doc = env.document('React', 'latex', '/project/text.tex');
    let selection = new env.api.Selection(new env.api.Position(0, 0), new env.api.Position(0, 5));
    env.api.window.activeTextEditor.selections = [selection];
    await env.commands.get('rtlLayoutGuard.wrapLtr')();
    assert.equal(doc.getText(), '\\lr{React}');
    const plain = env.document('سلام', 'plaintext', '/project/text.txt');
    selection = new env.api.Selection(new env.api.Position(0, 0), new env.api.Position(0, 4));
    env.api.window.activeTextEditor.selections = [selection];
    await env.commands.get('rtlLayoutGuard.wrapRtl')();
    assert.equal(plain.getText(), '\u2067سلام\u2069');
  } finally { env.dispose(); }
});
test('workspace scan aggregates suggestions without applying edits', async () => {
  const env = environment();
  try {
    const css = env.document('.x { margin-left: 2px }');
    env.document('\u2069', 'plaintext', '/project/sample.txt');
    await env.commands.get('rtlLayoutGuard.scanWorkspace')();
    assert.ok(env.notices.some(notice => notice.includes('2 files checked, 2 suggestions')));
    assert.equal(css.getText(), '.x { margin-left: 2px }');
  } finally { env.dispose(); }
});

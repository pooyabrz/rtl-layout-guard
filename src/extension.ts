import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { analyze, defaults, detectLatexSetup, isolateLines, latexWrapper, listControls, renderPreview } from './core';
import type { AnalysisOptions, DirectionPackage, Issue } from './core';

type GuardDiagnostic = vscode.Diagnostic & { guardIssue: Issue; guardVersion: number };
const SOURCE = 'RTL Layout Guard';
const isLatex = (document: vscode.TextDocument) => ['latex', 'tex'].includes(document.languageId) || /\.(tex|ltx)$/i.test(document.uri.path);

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('rtlLayoutGuard');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 30);
  const output = vscode.window.createOutputChannel(SOURCE);
  status.command = 'rtlLayoutGuard.scanDocument';
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const revisions = new Map<string, number>();
  let workspaceScanning = false;
  let preview: vscode.WebviewPanel | undefined;
  let previewUri: string | undefined;
  let disposed = false;

  function config(uri?: vscode.Uri) { return vscode.workspace.getConfiguration('rtlLayoutGuard', uri); }
  function options(uri: vscode.Uri): AnalysisOptions {
    const cfg = config(uri);
    return {
      ...defaults,
      css: cfg.get('css.enabled', true), tailwind: cfg.get('tailwind.enabled', true),
      unicode: cfg.get('unicode.enabled', true), latex: cfg.get('latex.enabled', true),
      mixedLatin: cfg.get('latex.mixedLatin', true),
      directionPackage: cfg.get<DirectionPackage>('latex.directionPackage', 'auto'),
      classFunctions: cfg.get<string[]>('tailwind.classFunctions', defaults.classFunctions),
      ignoredRules: cfg.get<string[]>('ignoredRules', [])
    };
  }
  function withinSize(document: vscode.TextDocument): boolean {
    return Buffer.byteLength(document.getText(), 'utf8') <= config(document.uri).get<number>('maxFileSizeKB', 512) * 1024;
  }
  function refreshStatus() {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) { status.hide(); return; }
    const count = collection.get(document.uri)?.length ?? 0;
    status.text = config(document.uri).get('enabled', true) ? `$(globe) RTL ${count ? `· ${count}` : 'Guard'}` : '$(circle-slash) RTL Guard';
    status.tooltip = withinSize(document) ? `${count} direction/layout suggestions in this document. Click to rescan.` : 'Document exceeds the configured analysis size limit.';
    status.show();
  }

  async function latexRootText(document: vscode.TextDocument): Promise<string | undefined> {
    const visited = new Set<string>([document.uri.toString()]);
    let current = document;
    const roots: string[] = [];
    // Follow explicit root magic comments only; never walk arbitrary \input trees or run TeX.
    for (let depth = 0; depth < 5; depth++) {
      const root = /^%\s*!\s*TeX\s+root\s*=\s*(.+?)\s*$/im.exec(current.getText().slice(0, 8192));
      if (!root) break;
      const name = root[1]!.replace(/^["']|["']$/g, '');
      if (/^[a-z]+:\/\//i.test(name) || name.includes('\0')) break;
      const parent = current.uri.with({ path: current.uri.path.slice(0, current.uri.path.lastIndexOf('/') + 1) });
      const uri = name.startsWith('/') ? current.uri.with({ path: name }) : vscode.Uri.joinPath(parent, name.replace(/\\/g, '/'));
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!folder || uri.scheme !== folder.uri.scheme || uri.authority !== folder.uri.authority ||
        !(uri.path === folder.uri.path || uri.path.startsWith(`${folder.uri.path.replace(/\/$/, '')}/`))) break;
      if (visited.has(uri.toString())) break;
      visited.add(uri.toString());
      try {
        const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
        if (open) {
          if (!withinSize(open)) break;
          current = open;
        } else {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > config(document.uri).get<number>('maxFileSizeKB', 512) * 1024) break;
          const bytes = await vscode.workspace.fs.readFile(uri);
          const value = Buffer.from(bytes).toString('utf8');
          roots.unshift(value);
          // Further root resolution needs no new visible editor.
          current = { uri, getText: () => value } as vscode.TextDocument;
          continue;
        }
        roots.unshift(current.getText());
      } catch { break; }
    }
    return roots.length ? roots.join('\n') : undefined;
  }

  function updatePreview(document: vscode.TextDocument) {
    if (!preview || previewUri !== document.uri.toString()) return;
    if (!withinSize(document)) { preview.dispose(); return; }
    preview.webview.html = renderPreview(document.getText(), document.uri.path.split('/').at(-1) || 'Untitled', document.languageId,
      randomBytes(16).toString('hex'), config(document.uri).get<'auto' | 'rtl' | 'ltr'>('preview.direction', 'auto'));
  }

  async function scan(document: vscode.TextDocument): Promise<number> {
    const key = document.uri.toString();
    const revision = (revisions.get(key) ?? 0) + 1;
    revisions.set(key, revision);
    if (disposed || document.isClosed || !config(document.uri).get('enabled', true) || !withinSize(document)) {
      collection.delete(document.uri); refreshStatus(); return 0;
    }
    const version = document.version;
    const text = document.getText();
    const settings = options(document.uri);
    if (isLatex(document) && settings.latex) settings.latexRootText = await latexRootText(document);
    if (disposed || document.isClosed || document.version !== version || revisions.get(key) !== revision) return 0;
    const issues = analyze(text, document.languageId, document.uri.path, settings);
    const diagnostics = issues.map(issue => {
      const range = new vscode.Range(document.positionAt(issue.start), document.positionAt(issue.end));
      const diagnostic = new vscode.Diagnostic(range, issue.message,
        issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information) as GuardDiagnostic;
      diagnostic.source = SOURCE;
      diagnostic.code = issue.rule;
      diagnostic.guardIssue = issue;
      diagnostic.guardVersion = version;
      return diagnostic;
    });
    collection.set(document.uri, diagnostics);
    refreshStatus();
    updatePreview(document);
    return issues.length;
  }

  function schedule(document: vscode.TextDocument) {
    if (disposed || ['output', 'debug', 'search-editor'].includes(document.uri.scheme)) return;
    const key = document.uri.toString();
    const timer = pending.get(key);
    if (timer) clearTimeout(timer);
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      void scan(document).catch(error => output.appendLine(`Could not scan ${document.uri.path}: ${String(error)}`));
    }, 220));
  }

  const provider: vscode.CodeActionProvider = {
    provideCodeActions(document, _range, actionContext) {
      const actions: vscode.CodeAction[] = [];
      for (const item of actionContext.diagnostics) {
        const diagnostic = item as GuardDiagnostic;
        if (diagnostic.source !== SOURCE || !diagnostic.guardIssue || diagnostic.guardVersion !== document.version) continue;
        for (const fix of diagnostic.guardIssue.fixes) {
          const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
          action.diagnostics = [diagnostic];
          action.edit = new vscode.WorkspaceEdit();
          for (const edit of fix.edits) action.edit.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
          // No fix is preferred or offered as Fix All: layout intent needs human review.
          actions.push(action);
        }
      }
      return actions;
    }
  };

  async function wrap(direction: 'ltr' | 'rtl') {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selections.every(selection => selection.isEmpty)) {
      void vscode.window.showInformationMessage('Select the prose or string contents you want to wrap.'); return;
    }
    const version = editor.document.version;
    const selections = [...editor.selections].filter(selection => !selection.isEmpty);
    let macro: string | undefined;
    if (isLatex(editor.document)) {
      const root = await latexRootText(editor.document);
      let setup = detectLatexSetup(root ?? editor.document.getText(), options(editor.document.uri).directionPackage);
      if (!setup.supported) setup = detectLatexSetup(editor.document.getText(), options(editor.document.uri).directionPackage);
      macro = latexWrapper(setup.provider, direction);
      if (!macro) {
        void vscode.window.showInformationMessage('No supported LaTeX wrapper provider detected. Configure XePersian or bidi in your preamble, or set RTL Guard › LaTeX: Direction Package for an included preamble.'); return;
      }
      if (selections.some(selection => /\r?\n\s*\r?\n/.test(editor.document.getText(selection)))) {
        void vscode.window.showInformationMessage('LaTeX inline wrappers accept one paragraph. Select a single paragraph, or use a direction environment in your document.'); return;
      }
    }
    if (editor.document.version !== version) { void vscode.window.showInformationMessage('The document changed. Select the text again to apply a direction wrapper.'); return; }
    await editor.edit(builder => {
      for (const selection of selections) {
        const value = editor.document.getText(selection);
        builder.replace(selection, macro ? `\\${macro}{${value}}` : isolateLines(value, direction));
      }
    });
  }

  const commands: [string, (...args: never[]) => unknown][] = [
    ['rtlLayoutGuard.scanDocument', async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document) return;
      if (!withinSize(document)) { void vscode.window.showInformationMessage('This document exceeds RTL Guard’s configured file-size limit.'); return; }
      const count = await scan(document);
      void vscode.window.showInformationMessage(`RTL Guard: ${count} suggestion${count === 1 ? '' : 's'} in this document.`);
    }],
    ['rtlLayoutGuard.scanWorkspace', async () => {
      if (!vscode.workspace.workspaceFolders?.length) { void vscode.window.showInformationMessage('Open a workspace folder to scan its text files.'); return; }
      const cfg = config();
      const maximum = cfg.get<number>('workspace.maxFiles', 500);
      const files = await vscode.workspace.findFiles(cfg.get<string>('workspace.include', '**/*.{tex,css,tsx,md,txt}'), cfg.get<string>('workspace.exclude', '**/node_modules/**'), maximum + 1);
      const limited = files.length > maximum;
      let checked = 0, skipped = 0, suggestions = 0;
      const staleUris = new Map([...collection].map(([uri]) => [uri.toString(), uri]));
      workspaceScanning = true;
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'RTL Guard: checking workspace', cancellable: true }, async (progress, token) => {
          for (const uri of files.slice(0, maximum)) {
            if (token.isCancellationRequested) break;
            try {
              const stat = await vscode.workspace.fs.stat(uri);
              if (stat.size > cfg.get<number>('maxFileSizeKB', 512) * 1024) { skipped++; continue; }
              const document = await vscode.workspace.openTextDocument(uri);
              if (document.getText().includes('\0')) { skipped++; continue; }
              suggestions += await scan(document); checked++;
              staleUris.delete(uri.toString());
              progress.report({ increment: 100 / Math.min(files.length || 1, maximum), message: `${checked} files` });
            } catch { skipped++; }
          }
        });
        // Keep open-document diagnostics; remove stale workspace-only diagnostics after an explicit scan.
        const openUris = new Set(vscode.workspace.textDocuments.map(document => document.uri.toString()));
        for (const [key, uri] of staleUris) if (!openUris.has(key)) collection.delete(uri);
      } finally { workspaceScanning = false; }
      const summary = `RTL Guard: ${checked} files checked, ${suggestions} suggestions, ${skipped} skipped.${limited ? ` Scan limited to ${maximum} files; adjust workspace.maxFiles if needed.` : ''}`;
      output.appendLine(summary);
      void vscode.window.showInformationMessage(summary);
    }],
    ['rtlLayoutGuard.preview', () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document) return;
      if (!withinSize(document)) { void vscode.window.showInformationMessage('This document exceeds the preview size limit.'); return; }
      if (preview) { preview.dispose(); preview = undefined; }
      previewUri = document.uri.toString();
      preview = vscode.window.createWebviewPanel('rtlLayoutGuard.preview', 'RTL Guard · Text Preview', vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
      preview.onDidDispose(() => { preview = undefined; previewUri = undefined; }, undefined, context.subscriptions);
      updatePreview(document);
    }],
    ['rtlLayoutGuard.wrapLtr', () => wrap('ltr')],
    ['rtlLayoutGuard.wrapRtl', () => wrap('rtl')],
    ['rtlLayoutGuard.inspectControls', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !withinSize(editor.document)) return;
      const document = editor.document;
      const version = document.version;
      const controls = listControls(document.getText());
      if (!controls.length) { void vscode.window.showInformationMessage('No literal Unicode direction controls found. ZWNJ and ZWJ are not flagged.'); return; }
      const items = controls.map(control => {
        const position = document.positionAt(control.start);
        return { label: `${control.name} · ${control.codePoint}`, description: `Line ${position.line + 1}, column ${position.character + 1}`, control };
      });
      const selected = await vscode.window.showQuickPick(items, { title: 'Invisible direction controls', matchOnDescription: true });
      if (!selected || document.isClosed || document.version !== version) return;
      const target = await vscode.window.showTextDocument(document);
      target.selection = new vscode.Selection(document.positionAt(selected.control.start), document.positionAt(selected.control.end));
      target.revealRange(target.selection);
    }],
    ['rtlLayoutGuard.toggle', async () => {
      await config().update('enabled', !config().get('enabled', true), vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    }]
  ];

  context.subscriptions.push(collection, status, output,
    vscode.languages.registerCodeActionsProvider('*', provider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    ...commands.map(([id, handler]) => vscode.commands.registerCommand(id, handler)),
    vscode.workspace.onDidOpenTextDocument(document => { if (!workspaceScanning) schedule(document); }),
    vscode.workspace.onDidChangeTextDocument(event => {
      schedule(event.document);
      if (isLatex(event.document)) for (const document of vscode.workspace.textDocuments) if (document !== event.document && isLatex(document)) schedule(document);
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      const key = document.uri.toString();
      const timer = pending.get(key);
      if (timer) clearTimeout(timer);
      pending.delete(key); revisions.delete(key); collection.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('rtlLayoutGuard')) return;
      collection.clear();
      for (const document of vscode.workspace.textDocuments) schedule(document);
      refreshStatus();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => refreshStatus()),
    { dispose() { disposed = true; for (const timer of pending.values()) clearTimeout(timer); pending.clear(); preview?.dispose(); } }
  );
  for (const document of vscode.workspace.textDocuments) schedule(document);
  refreshStatus();
}

export function deactivate(): void { /* All resources are owned by context.subscriptions. */ }

import { listControls } from './unicode';

export const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderPreview(text: string, title: string, language: string, nonce: string, direction: 'auto' | 'rtl' | 'ltr' = 'auto'): string {
  const controls = listControls(text);
  const rows = text.split(/\r\n|\r|\n/).map((line, index) => `<div class="row"><span class="number" aria-hidden="true">${index + 1}</span><div class="line" dir="auto">${escapeHtml(line) || '&#8203;'}</div></div>`).join('\n');
  const controlRows = controls.map(control => {
    const before = text.slice(0, control.start);
    const line = before.split(/\r\n|\r|\n/).length;
    const lastBreak = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
    const column = control.start - lastBreak;
    return `<li><code>${control.name} ${control.codePoint}</code> · line ${line}, column ${column}</li>`;
  }).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>RTL Guard — ${escapeHtml(title)}</title><style nonce="${nonce}">
:root{color-scheme:light dark}body{background:var(--vscode-editor-background,#101820);color:var(--vscode-editor-foreground,#e7eef5);font:15px/1.85 var(--vscode-font-family,system-ui);max-width:1100px;margin:32px auto;padding:0 24px}h1{font-size:25px;line-height:1.4;margin-bottom:6px}p{color:var(--vscode-descriptionForeground,#a8b7c7)}.badge{font-size:12px;color:#63d9bd;letter-spacing:.08em}.toolbar{display:flex;align-items:center;gap:8px;margin:24px 0 16px}label{padding:6px 13px;border:1px solid var(--vscode-panel-border,#324454);border-radius:6px;cursor:pointer}input{accent-color:#44c9a6}main{border:1px solid var(--vscode-panel-border,#324454);border-radius:10px;padding:16px 0;overflow:auto}.row{display:grid;grid-template-columns:48px minmax(0,1fr);min-height:32px}.number{font:12px/32px var(--vscode-editor-font-family,monospace);text-align:center;color:var(--vscode-editorLineNumber-foreground,#6c8195);user-select:none}.line{white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext;padding:2px 20px;font-size:18px;min-width:0}#dir-rtl:checked~main .line{direction:rtl;unicode-bidi:isolate}#dir-ltr:checked~main .line{direction:ltr;unicode-bidi:isolate}.note{font-size:13px}details{margin-top:24px;border-top:1px solid var(--vscode-panel-border,#324454);padding-top:16px}li{font-size:13px}code{font-family:var(--vscode-editor-font-family,monospace);unicode-bidi:isolate;direction:ltr}footer{margin:24px 0;color:var(--vscode-descriptionForeground,#a8b7c7);font-size:12px}</style></head><body>
<div class="badge">RTL LAYOUT GUARD · TEXT PREVIEW</div><h1>${escapeHtml(title)}</h1>
<p>Read mixed-direction source text with an explicit base direction. This view does not modify your file.</p>
<p class="note">${/latex|tex/i.test(language) ? 'LaTeX source preview only. Compile the document with your TeX toolchain to verify typeset output.' : 'Text preview only. HTML, Markdown, source code and mathematical expressions are displayed as escaped source.'}</p>
<input id="dir-auto" name="direction" type="radio" ${direction === 'auto' ? 'checked' : ''}><label for="dir-auto">Auto per line</label>
<input id="dir-rtl" name="direction" type="radio" ${direction === 'rtl' ? 'checked' : ''}><label for="dir-rtl">Right to left</label>
<input id="dir-ltr" name="direction" type="radio" ${direction === 'ltr' ? 'checked' : ''}><label for="dir-ltr">Left to right</label>
<div class="toolbar"><span class="note">${text.split(/\r\n|\r|\n/).length} lines · ${controls.length} explicit direction controls · ${escapeHtml(language)}</span></div>
<main aria-label="Source text">${rows}</main>
<details ${controls.length ? 'open' : ''}><summary>Invisible direction controls (${controls.length})</summary><ul>${controlRows || '<li>No explicit direction controls. Persian ZWNJ is not treated as a bidi control.</li>'}</ul></details>
<footer>Processed locally · No scripts, remote resources or telemetry · Original source order is preserved</footer></body></html>`;
}

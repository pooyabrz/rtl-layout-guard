import { hasRtl } from './types';
import type { AnalysisOptions, DirectionPackage, Issue } from './types';

function escaped(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) count++;
  return count % 2 === 1;
}
function closeGroup(text: string, start: number, open = '{', close = '}'): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i + 1;
  }
  return text.length;
}
export function stripLatexComments(text: string): string {
  return text.replace(/(^|\r\n|\r|\n)([^\r\n]*)/g, (_whole, newline: string, line: string) => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '%' && !escaped(line, i)) return newline + line.slice(0, i) + ' '.repeat(line.length - i);
    }
    return newline + line;
  });
}
export interface LatexSetup { provider: Exclude<DirectionPackage, 'auto'>; supported: boolean }
export function detectLatexSetup(text: string, setting: DirectionPackage = 'auto'): LatexSetup {
  if (setting !== 'auto') return { provider: setting, supported: setting !== 'none' };
  const clean = stripLatexComments(text).split(/\\begin\s*\{document\}/)[0]!;
  const packages = [...clean.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/g)].flatMap(m => m[1]!.split(',').map(p => p.trim()));
  if (packages.includes('xepersian')) return { provider: 'xepersian', supported: true };
  if (packages.some(p => p === 'bidi' || p === 'luabidi')) return { provider: 'bidi', supported: true };
  const rtlLanguages = 'persian|farsi|arabic|hebrew|syriac|urdu|divehi|nko';
  if (packages.includes('polyglossia') && new RegExp(`\\\\set(?:main|other)language\\s*(?:\\[[^\\]]*\\]\\s*)?\\{(?:${rtlLanguages})\\}`, 'i').test(clean)) return { provider: 'bidi', supported: true };
  if (packages.includes('babel') && new RegExp(`\\b(?:${rtlLanguages})\\b`, 'i').test(clean)) return { provider: 'none', supported: true };
  return { provider: 'none', supported: false };
}

/** Mask non-prose without changing UTF-16 offsets. This is a source heuristic, not a TeX expansion engine. */
export function latexProse(text: string): string {
  const mask = text.split('');
  const blank = (start: number, end: number) => {
    for (let j = start; j < end; j++) if (text[j] !== '\n' && text[j] !== '\r') mask[j] = '\uFFFC';
  };
  const skipEnvironments = new Set(['verbatim', 'Verbatim', 'lstlisting', 'minted', 'comment', 'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*', 'displaymath', 'math', 'tikzpicture', 'latin', 'LTR', 'english']);
  const skipArguments: Record<string, number> = {
    lr: 1, rl: 1, textLR: 1, textRL: 1, LRE: 1, RLE: 1, foreignlanguage: 2,
    textenglish: 1, textpersian: 1, textarabic: 1, texthebrew: 1,
    label: 1, ref: 1, pageref: 1, eqref: 1, autoref: 1, cref: 1, Cref: 1,
    cite: 1, citep: 1, citet: 1, nocite: 1, url: 1, path: 1, href: 1,
    input: 1, include: 1, includegraphics: 1, bibliography: 1, bibliographystyle: 1,
    usepackage: 1, RequirePackage: 1, documentclass: 1,
    settextfont: 1, setlatintextfont: 1, setmainfont: 1, setsansfont: 1,
    begin: 1, end: 1, hspace: 1, vspace: 1
  };
  for (let i = 0; i < text.length;) {
    if (text[i] === '%' && !escaped(text, i)) {
      const next = /[\r\n]/.exec(text.slice(i));
      const end = next ? i + next.index : text.length;
      blank(i, end); i = end; continue;
    }
    if (text[i] === '$' && !escaped(text, i)) {
      const delimiter = text[i + 1] === '$' ? '$$' : '$';
      let end = i + delimiter.length;
      while (end < text.length && !(text.startsWith(delimiter, end) && !escaped(text, end))) end++;
      end = Math.min(text.length, end + delimiter.length);
      blank(i, end); i = end; continue;
    }
    // The scanner consumes escaped pairs together. Re-scanning the preceding
    // backslash run here would be quadratic on generated/verbatim-heavy input.
    if (text[i] !== '\\') { i++; continue; }
    if (text.startsWith('\\(', i) || text.startsWith('\\[', i)) {
      const delimiter = text[i + 1] === '(' ? '\\)' : '\\]';
      const endAt = text.indexOf(delimiter, i + 2);
      const end = endAt < 0 ? text.length : endAt + 2;
      blank(i, end); i = end; continue;
    }
    const command = /^\\([A-Za-z@]+)\*?/.exec(text.slice(i));
    if (!command) { blank(i, Math.min(i + 2, text.length)); i += 2; continue; }
    const name = command[1]!;
    let end = i + command[0].length;
    if (name === 'verb' || name === 'lstinline') {
      if (text[end] === '[') end = closeGroup(text, end, '[', ']');
      const delimiter = text[end];
      if (delimiter && !/\s/.test(delimiter)) {
        const until = text.indexOf(delimiter, end + 1);
        end = until < 0 ? (text.indexOf('\n', end) < 0 ? text.length : text.indexOf('\n', end)) : until + 1;
      }
      blank(i, end); i = end; continue;
    }
    if (name === 'begin') {
      const env = /^\s*\{([^}]+)\}/.exec(text.slice(end));
      if (env && skipEnvironments.has(env[1]!)) {
        const close = `\\end{${env[1]}}`;
        const until = text.indexOf(close, end + env[0].length);
        const next = until < 0 ? text.length : until + close.length;
        blank(i, next); i = next; continue;
      }
    }
    blank(i, end);
    while (/\s/.test(text[end] ?? '') && end < text.length) end++;
    while (text[end] === '[') {
      const next = closeGroup(text, end, '[', ']');
      blank(end, next); end = next;
      while (/\s/.test(text[end] ?? '') && end < text.length) end++;
    }
    const count = skipArguments[name] ?? 0;
    for (let arg = 0; arg < count && text[end] === '{'; arg++) {
      const next = closeGroup(text, end); blank(end, next); end = next;
      while (/\s/.test(text[end] ?? '') && end < text.length) end++;
    }
    i = end;
  }
  const begin = /\\begin\s*\{document\}/.exec(text);
  if (begin) blank(0, begin.index + begin[0].length);
  const end = /\\end\s*\{document\}/.exec(text);
  if (end) blank(end.index, text.length);
  return mask.join('');
}

export function latexWrapper(provider: LatexSetup['provider'], direction: 'ltr' | 'rtl'): string | undefined {
  if (provider === 'xepersian') return direction === 'ltr' ? 'lr' : 'rl';
  if (provider === 'bidi') return direction === 'ltr' ? 'textLR' : 'textRL';
  return;
}

export function analyzeLatex(text: string, options: AnalysisOptions): Issue[] {
  const issues: Issue[] = [];
  const prose = latexProse(text);
  if (!hasRtl(prose)) return issues;
  // Detect from root and current document separately: a root's body must not hide a fragment preamble.
  let setup = detectLatexSetup(options.latexRootText ?? text, options.directionPackage);
  if (!setup.supported && options.directionPackage === 'auto') setup = detectLatexSetup(text);
  if (!setup.supported && /\\documentclass\b/.test(stripLatexComments(text)) && options.directionPackage !== 'none') {
    const start = text.indexOf('\\documentclass');
    issues.push({ rule: 'latex/rtl-setup', start, end: start + 14, severity: 'information', fixes: [],
      message: 'RTL prose found, but this preamble has no recognized RTL setup. Configure XePersian, bidi, or RTL Polyglossia/Babel. An included preamble may already do this; set latex.directionPackage when appropriate.' });
  }
  const engine = /^%\s*!\s*TeX\s+(?:program|TS-program)\s*=\s*(pdf(?:la)?tex)\b/im.exec(text);
  if (engine && setup.provider !== 'none') {
    const start = engine.index + engine[0].lastIndexOf(engine[1]!);
    issues.push({ rule: 'latex/engine', start, end: start + engine[1]!.length, severity: 'warning',
      message: 'This magic comment selects pdfTeX for Unicode RTL text. Review the engine required by your packages; the supplied XePersian example uses XeLaTeX.',
      fixes: [{ title: 'Set the magic-comment engine to XeLaTeX', edits: [{ start, end: start + engine[1]!.length, text: 'xelatex' }] }] });
  }
  if (!options.mixedLatin) return issues;
  const wrapper = latexWrapper(setup.provider, 'ltr');
  let offset = 0;
  for (const line of prose.split(/(?<=\n)/)) {
    if (hasRtl(line)) {
      for (const match of line.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[ \t]+[A-Za-z][A-Za-z0-9]*)*/g)) {
        const value = text.slice(offset + match.index, offset + match.index + match[0].length);
        const start = offset + match.index;
        issues.push({ rule: 'latex/mixed-latin', start, end: start + value.length, severity: 'information',
          message: `Latin text inside RTL prose may need an explicit direction wrapper.${wrapper ? ` Review whether \\${wrapper}{...} is appropriate.` : ' Configure the document direction package to enable macro fixes.'}`,
          fixes: wrapper ? [{ title: `Wrap in \\${wrapper}{...}`, edits: [{ start, end: start + value.length, text: `\\${wrapper}{${value}}` }] }] : [] });
      }
    }
    offset += line.length;
  }
  return issues;
}

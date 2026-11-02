import type { Issue } from './types';

export const CONTROLS: Record<string, string> = {
  '\u061c': 'ALM', '\u200e': 'LRM', '\u200f': 'RLM',
  '\u202a': 'LRE', '\u202b': 'RLE', '\u202c': 'PDF', '\u202d': 'LRO', '\u202e': 'RLO',
  '\u2066': 'LRI', '\u2067': 'RLI', '\u2068': 'FSI', '\u2069': 'PDI'
};
export interface DirectionControl { start: number; end: number; name: string; codePoint: string }
export function listControls(text: string): DirectionControl[] {
  const found: DirectionControl[] = [];
  let start = 0;
  for (const char of text) {
    const name = CONTROLS[char];
    if (name) found.push({ start, end: start + char.length, name, codePoint: `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` });
    start += char.length;
  }
  return found;
}

export function analyzeUnicode(text: string): Issue[] {
  const issues: Issue[] = [];
  let stack: { char: string; start: number; isolate: boolean }[] = [];
  function add(rule: string, start: number, message: string, severity: Issue['severity'] = 'warning') {
    issues.push({ rule, start, end: start + 1, message, severity,
      fixes: [{ title: 'Remove this direction control (review intended direction)', edits: [{ start, end: start + 1, text: '' }] }] });
  }
  function finishParagraph() {
    for (const entry of stack) add('unicode/unbalanced-control', entry.start,
      `${CONTROLS[entry.char]} is not explicitly closed in this paragraph. Unicode resets direction state at a paragraph boundary; check whether a closing control is missing.`);
    stack = [];
  }
  let start = 0;
  for (const char of text) {
    if (/[\r\n\u001c-\u001e\u0085\u2029]/u.test(char)) finishParagraph();
    else if (/[\u2066-\u2068]/u.test(char)) stack.push({ char, start, isolate: true });
    else if (/[\u202a\u202b\u202d\u202e]/u.test(char)) {
      stack.push({ char, start, isolate: false });
      if (char === '\u202d' || char === '\u202e') add('unicode/override', start,
        `${CONTROLS[char]} overrides normal character order. Review this literal hidden control; it can make source text appear in a different order.`);
      else add('unicode/legacy-embedding', start,
        `${CONTROLS[char]} is a legacy direction embedding. In plain text, prefer an isolate pair when isolation is intended; markup languages should use their direction markup.`, 'information');
    } else if (char === '\u202c') {
      const top = stack.at(-1);
      if (top && !top.isolate) stack.pop();
      else add('unicode/unbalanced-control', start, 'PDF has no open embedding in its current isolate.');
    } else if (char === '\u2069') {
      let index = stack.length - 1;
      while (index >= 0 && !stack[index]!.isolate) index--;
      if (index >= 0) stack.splice(index);
      else add('unicode/unbalanced-control', start, 'PDI has no matching isolate opener in this paragraph.');
    }
    start += char.length;
  }
  finishParagraph();
  return issues;
}

export function isolateLines(text: string, direction: 'ltr' | 'rtl'): string {
  const opener = direction === 'ltr' ? '\u2066' : '\u2067';
  return text.split(/([\r\n\u001c-\u001e\u0085\u2029]+)/u).map(part =>
    !part || /^[\r\n\u001c-\u001e\u0085\u2029]+$/u.test(part) ? part : `${opener}${part}\u2069`).join('');
}

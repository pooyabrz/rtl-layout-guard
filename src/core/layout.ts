import safeParse from 'postcss-safe-parser';
import type { Issue } from './types';
import { replaceIssue } from './types';

const PHYSICAL: Record<string, [string, string]> = {
  'left': ['inset-inline-start', 'inset-inline-end'],
  'right': ['inset-inline-end', 'inset-inline-start']
};
for (const base of ['margin', 'padding', 'scroll-margin', 'scroll-padding']) {
  PHYSICAL[`${base}-left`] = [`${base}-inline-start`, `${base}-inline-end`];
  PHYSICAL[`${base}-right`] = [`${base}-inline-end`, `${base}-inline-start`];
}
for (const suffix of ['', '-width', '-style', '-color']) {
  PHYSICAL[`border-left${suffix}`] = [`border-inline-start${suffix}`, `border-inline-end${suffix}`];
  PHYSICAL[`border-right${suffix}`] = [`border-inline-end${suffix}`, `border-inline-start${suffix}`];
}
export function logicalProperties(property: string): [string, string] | undefined { return PHYSICAL[property.toLowerCase()]; }
const camel = (text: string) => text.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());

export function propertyIssue(property: string, start: number, end: number, camelCase = false): Issue | undefined {
  const names = logicalProperties(property);
  if (!names) return;
  return replaceIssue('css/physical-property', start, end,
    `${property} uses a physical side. If this spacing or edge should follow text direction, choose a logical property. Physical positioning can be intentional.`,
    names.map((name, index) => ({ title: `Use ${camelCase ? camel(name) : name} (${index === 0 ? 'left/right as in an LTR source layout' : 'left/right as in an RTL source layout'})`, text: camelCase ? camel(name) : name })));
}
export function valueIssue(property: string, value: string, start: number, end: number): Issue | undefined {
  if (!['text-align', 'float', 'clear'].includes(property) || !['left', 'right'].includes(value)) return;
  const side = value === 'left' ? 'start' : 'end';
  const opposite = side === 'start' ? 'end' : 'start';
  const prefix = property === 'text-align' ? '' : 'inline-';
  return replaceIssue('css/physical-value', start, end,
    `${property}: ${value} is physical. Review whether alignment should follow the content direction.`,
    [side, opposite].map((logical, index) => ({ title: `Use ${prefix}${logical} (${index === 0 ? 'LTR source layout' : 'RTL source layout'})`, text: `${prefix}${logical}` })));
}

export function analyzeCss(text: string, offset = 0, inline = false): Issue[] {
  const source = inline ? `a{${text}}` : text;
  const base = offset - (inline ? 2 : 0);
  const issues: Issue[] = [];
  try {
    // CSS may come from an untrusted workspace. Never auto-load sourceMappingURL files.
    safeParse(source, { map: false }).walkDecls(decl => {
      if (decl.prop.startsWith('--')) return;
      const local = decl.source?.start?.offset;
      if (local === undefined) return;
      const start = base + local;
      const property = decl.prop.toLowerCase();
      if (source.slice(local, local + decl.prop.length).toLowerCase() !== property) return;
      const found = propertyIssue(property, start, start + decl.prop.length);
      if (found) issues.push(found);
      if (['text-align', 'float', 'clear'].includes(property)) {
        const rest = source.slice(local + decl.prop.length);
        const match = /^\s*:\s*(left|right)\b/.exec(rest);
        if (match) {
          const value = match[1]!;
          const valueStart = start + decl.prop.length + match[0].lastIndexOf(value);
          const issue = valueIssue(property, value, valueStart, valueStart + value.length);
          if (issue) issues.push(issue);
        }
      }
    });
  } catch { /* Incomplete source must never break editing or emit fabricated fixes. */ }
  return issues.filter(issue => issue.start >= offset && issue.end <= offset + text.length);
}

function splitVariants(token: string): { prefix: string; utility: string; variants: string[] } {
  let depth = 0;
  let quote = '';
  const cuts: number[] = [];
  for (let i = 0; i < token.length; i++) {
    const char = token[i]!;
    if (char === '\\') { i++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[' || char === '(') depth++;
    else if (char === ']' || char === ')') depth--;
    else if (char === ':' && depth === 0) cuts.push(i);
  }
  const last = cuts.at(-1) ?? -1;
  const prefix = token.slice(0, last + 1);
  return { prefix, utility: token.slice(last + 1), variants: prefix.split(':').filter(Boolean) };
}
function logicalUtility(utility: string): [string, string] | undefined {
  const importantBefore = utility.startsWith('!') ? '!' : '';
  let value = utility.slice(importantBefore.length);
  const importantAfter = value.endsWith('!') ? '!' : '';
  if (importantAfter) value = value.slice(0, -1);
  const negative = value.startsWith('-') ? '-' : '';
  value = value.slice(negative.length);
  const options: Record<string, [string, string]> = {
    ml: ['ms', 'me'], mr: ['me', 'ms'], pl: ['ps', 'pe'], pr: ['pe', 'ps'],
    left: ['start', 'end'], right: ['end', 'start'],
    'border-l': ['border-s', 'border-e'], 'border-r': ['border-e', 'border-s'],
    'scroll-ml': ['scroll-ms', 'scroll-me'], 'scroll-mr': ['scroll-me', 'scroll-ms'],
    'scroll-pl': ['scroll-ps', 'scroll-pe'], 'scroll-pr': ['scroll-pe', 'scroll-ps']
  };
  let names: [string, string] | undefined;
  const alignment = /^(text|float|clear)-(left|right)$/.exec(value);
  if (alignment) names = alignment[2] === 'left' ? [`${alignment[1]}-start`, `${alignment[1]}-end`] : [`${alignment[1]}-end`, `${alignment[1]}-start`];
  else {
    for (const prefix of Object.keys(options).sort((a, b) => b.length - a.length)) {
      if ((prefix.startsWith('border-') && value === prefix) || value.startsWith(`${prefix}-`)) {
        const suffix = value.slice(prefix.length);
        names = options[prefix]!.map(option => `${option}${suffix}`) as [string, string];
        break;
      }
    }
    const arbitrary = /^\[([a-z-]+):(.+)\]$/.exec(value);
    if (arbitrary) {
      const properties = logicalProperties(arbitrary[1]!);
      if (properties) names = properties.map(prop => `[${prop}:${arbitrary[2]}]`) as [string, string];
    }
  }
  return names?.map(name => `${importantBefore}${negative}${name}${importantAfter}`) as [string, string] | undefined;
}

export function analyzeClasses(classes: string, offset: number): Issue[] {
  const issues: Issue[] = [];
  // Keep arbitrary values together, including spaces inside brackets/quotes.
  const tokens = classes.matchAll(/(?:[^\s\[\]]|\[(?:[^\]\\]|\\.)*\])+/g);
  for (const match of tokens) {
    const token = match[0];
    const { prefix, utility, variants } = splitVariants(token);
    if (variants.some(variant => variant === 'rtl' || variant === 'ltr')) continue;
    const names = logicalUtility(utility);
    if (!names) continue;
    const start = offset + match.index;
    issues.push(replaceIssue('tailwind/physical-utility', start, start + token.length,
      `${token} uses a physical side. Choose start/end if this utility should follow text direction. Explicit rtl:/ltr: variants are left alone.`,
      names.map((name, index) => ({ title: `Use ${prefix}${name} (${index === 0 ? 'LTR source layout' : 'RTL source layout'})`, text: `${prefix}${name}` }))));
  }
  return issues;
}

import { defaults } from './types';
import type { AnalysisOptions, Issue } from './types';
import { analyzeUnicode } from './unicode';
import { analyzeCss } from './layout';
import { analyzeMarkup, analyzeScript } from './syntax';
import { analyzeLatex } from './latex';
export * from './types';
export * from './unicode';
export * from './layout';
export * from './latex';
export * from './preview';

export function analyze(text: string, language: string, filename = 'untitled', partial: Partial<AnalysisOptions> = {}): Issue[] {
  const options = { ...defaults, ...partial };
  const issues: Issue[] = options.unicode ? analyzeUnicode(text) : [];
  if (options.latex && (['latex', 'tex'].includes(language) || /\.(tex|ltx)$/i.test(filename))) issues.push(...analyzeLatex(text, options));
  else if (options.css || options.tailwind) {
    if (['css', 'scss'].includes(language) || /\.(css|scss)$/i.test(filename)) {
      if (options.css) issues.push(...analyzeCss(text));
    } else if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'mdx'].includes(language) || /\.[cm]?[jt]sx?$/.test(filename)) issues.push(...analyzeScript(text, filename, options));
    else if (['html', 'vue', 'svelte', 'markdown'].includes(language) || /\.(html?|vue|svelte|md)$/i.test(filename)) issues.push(...analyzeMarkup(text, options));
  }
  const seen = new Set<string>();
  return issues.filter(issue => {
    const id = `${issue.rule}:${issue.start}:${issue.end}`;
    if (seen.has(id) || options.ignoredRules.includes(issue.rule)) return false;
    if (issue.start < 0 || issue.end < issue.start || issue.end > text.length) return false;
    seen.add(id);
    return true;
  }).sort((a, b) => a.start - b.start || a.rule.localeCompare(b.rule));
}

export interface TextEdit { start: number; end: number; text: string }
export interface Fix { title: string; edits: TextEdit[] }
export interface Issue {
  rule: string; start: number; end: number; message: string;
  severity: 'warning' | 'information'; fixes: Fix[];
}
export type DirectionPackage = 'auto' | 'xepersian' | 'bidi' | 'none';
export interface AnalysisOptions {
  css: boolean; tailwind: boolean; unicode: boolean; latex: boolean;
  mixedLatin: boolean; classFunctions: string[]; directionPackage: DirectionPackage;
  ignoredRules: string[]; latexRootText?: string;
}
export const defaults: AnalysisOptions = {
  css: true, tailwind: true, unicode: true, latex: true, mixedLatin: true,
  classFunctions: ['cn', 'clsx', 'classNames', 'twMerge'],
  directionPackage: 'auto', ignoredRules: []
};
export const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;
export function hasRtl(text: string): boolean {
  // Filter punctuation, digits and Arabic-script marks that have no strong direction.
  return [...text].some(char => /\p{Letter}/u.test(char) && RTL_LETTER.test(char));
}
export function replaceIssue(rule: string, start: number, end: number, message: string, replacements: { title: string; text: string }[]): Issue {
  return { rule, start, end, message, severity: 'information', fixes: replacements.map(r => ({ title: r.title, edits: [{ start, end, text: r.text }] })) };
}

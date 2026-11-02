import ts from 'typescript';
import { analyzeClasses, analyzeCss, propertyIssue, valueIssue } from './layout';
import type { AnalysisOptions, Issue } from './types';

export function analyzeScript(text: string, filename: string, options: AnalysisOptions): Issue[] {
  const issues: Issue[] = [];
  const kind = /\.[cm]?tsx?$/.test(filename) ? (/\.tsx$/.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.TS) : ts.ScriptKind.JSX;
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, kind);
  const visited = new Set<number>();
  function stringClasses(node: ts.StringLiteralLike) {
    const start = node.getStart(source);
    if (visited.has(start)) return;
    visited.add(start);
    issues.push(...analyzeClasses(text.slice(start + 1, node.end - 1), start + 1));
  }
  function classes(node: ts.Node | undefined): void {
    if (!node || !options.tailwind) return;
    if (ts.isStringLiteralLike(node)) stringClasses(node);
    else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) classes(node.expression);
    else if (ts.isConditionalExpression(node)) { classes(node.whenTrue); classes(node.whenFalse); }
    else if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) classes(node.right);
      else if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) { classes(node.left); classes(node.right); }
    } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(classes);
    else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) if (ts.isPropertyAssignment(prop) && ts.isStringLiteralLike(prop.name)) stringClasses(prop.name);
    } else if (ts.isCallExpression(node) && isClassHelper(node)) node.arguments.forEach(classes);
  }
  function isClassHelper(node: ts.CallExpression): boolean {
    const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
    return options.classFunctions.includes(name);
  }
  function style(node: ts.Node | undefined): void {
    if (!node || !options.css) return;
    if (ts.isParenthesizedExpression(node)) { style(node.expression); return; }
    if (!ts.isObjectLiteralExpression(node)) return;
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop) || !(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) continue;
      const name = prop.name.text;
      const kebab = name.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`);
      const quoted = ts.isStringLiteral(prop.name);
      const start = prop.name.getStart(source) + (quoted ? 1 : 0);
      const end = prop.name.end - (quoted ? 1 : 0);
      const issue = propertyIssue(kebab, start, end, !name.includes('-'));
      if (issue) issues.push(issue);
      if (ts.isStringLiteral(prop.initializer)) {
        const valueStart = prop.initializer.getStart(source) + 1;
        const found = valueIssue(kebab, prop.initializer.text, valueStart, prop.initializer.end - 1);
        if (found) issues.push(found);
      }
    }
  }
  function walk(node: ts.Node): void {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      const initializer = node.initializer;
      const value = initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
      if (name === 'className' || name === 'class') classes(value);
      else if (name === 'style') style(value);
    }
    if (options.tailwind && ts.isCallExpression(node) && isClassHelper(node)) node.arguments.forEach(classes);
    ts.forEachChild(node, walk);
  }
  walk(source);
  return issues;
}

export function analyzeMarkup(text: string, options: AnalysisOptions): Issue[] {
  const issues: Issue[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf('<', cursor);
    if (open < 0) break;
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open + 4);
      cursor = close < 0 ? text.length : close + 3;
      continue;
    }
    const nameMatch = /^<([A-Za-z][\w:.-]*)\b/.exec(text.slice(open));
    if (!nameMatch) { cursor = open + 1; continue; }
    let end = open + nameMatch[0].length;
    let quote = '';
    for (; end < text.length; end++) {
      const char = text[end]!;
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end >= text.length) break;
    const tag = text.slice(open, end + 1);
    let attrCursor = nameMatch[0].length;
    while (attrCursor < tag.length - 1) {
      while (/\s|\//.test(tag[attrCursor] ?? '') && attrCursor < tag.length - 1) attrCursor++;
      const nameStart = attrCursor;
      while (attrCursor < tag.length - 1 && !/[\s=>]/.test(tag[attrCursor]!)) attrCursor++;
      const attrName = tag.slice(nameStart, attrCursor);
      if (attrCursor === nameStart) { attrCursor++; continue; }
      while (/\s/.test(tag[attrCursor] ?? '') && attrCursor < tag.length - 1) attrCursor++;
      if (tag[attrCursor] !== '=') continue;
      attrCursor++;
      while (/\s/.test(tag[attrCursor] ?? '') && attrCursor < tag.length - 1) attrCursor++;
      const delimiter = tag[attrCursor] === '"' || tag[attrCursor] === "'" ? tag[attrCursor++] : '';
      const valueStart = attrCursor;
      while (attrCursor < tag.length - 1 && (delimiter ? tag[attrCursor] !== delimiter : !/\s|>/.test(tag[attrCursor]!))) attrCursor++;
      const value = tag.slice(valueStart, attrCursor);
      if (delimiter) attrCursor++;
      if (attrName === 'style' && options.css) issues.push(...analyzeCss(value, open + valueStart, true));
      else if ((attrName === 'class' || attrName === 'className') && options.tailwind && !value.startsWith('{')) issues.push(...analyzeClasses(value, open + valueStart));
    }
    cursor = end + 1;
    const name = nameMatch[1]!.toLowerCase();
    if (name === 'script' || name === 'style') {
      const closePattern = new RegExp(`</${name}\\s*>`, 'ig');
      closePattern.lastIndex = cursor;
      const close = closePattern.exec(text);
      const contentEnd = close?.index ?? text.length;
      if (name === 'style' && options.css) issues.push(...analyzeCss(text.slice(cursor, contentEnd), cursor));
      cursor = close ? close.index + close[0].length : text.length;
    }
  }
  return issues;
}

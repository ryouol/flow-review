import ts from 'typescript';
import { structuredPatch, diffLines } from 'diff';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Report, Unit, CallLink, CodeSide, ChangedFile, Hunk, Diagnostic, Side, ChangedLine } from './model.js';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);
export const isSource = (file: string) => /\.(?:ts|tsx|mts|cts)$/.test(file) && !/\.d\.(?:ts|mts|cts)$/.test(file);
const vpath = (file: string) => path.posix.resolve('/snapshot', file);
type ParsedUnit = { unit: Unit; node: ts.Node; source: ts.SourceFile; symbol?: ts.Symbol };
type Snapshot = { parsed: Map<string, ParsedUnit>; links: CallLink[]; diagnostics: Diagnostic[]; analyzedFiles: number; strictNullChecks: boolean };
const lfStarts = new WeakMap<ts.SourceFile, number[]>();
function sourceLine(source: ts.SourceFile, position: number): number {
  let starts = lfStarts.get(source);
  if (!starts) {
    starts = [0];
    for (let i = source.text.indexOf('\n'); i !== -1; i = source.text.indexOf('\n', i + 1)) starts.push(i + 1);
    lfStarts.set(source, starts);
  }
  let low = 0, high = starts.length;
  while (low < high) { const mid = (low + high) >>> 1; if (starts[mid] <= position) low = mid + 1; else high = mid; }
  return low;
}

export function fileDiff(file: string, before: string, after: string): Hunk[] {
  const patch = structuredPatch(file, file, before, after, '', '', { context: 3 });
  return patch.hunks.map((h, index) => {
    let oldLine = h.oldStart, newLine = h.newStart;
    return {
      id: `h-${hash(file)}-${index}`, oldStart: h.oldStart, oldLines: h.oldLines,
      newStart: h.newStart, newLines: h.newLines,
      lines: h.lines.filter(line => !line.startsWith('\\')).map(line => {
        const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : 'context';
        return { kind, text: line.slice(1), ...(kind !== 'add' ? { oldLine: oldLine++ } : {}), ...(kind !== 'remove' ? { newLine: newLine++ } : {}) };
      }),
    };
  });
}

function parseSnapshot(files: Record<string, string>, side: Side): Snapshot {
  const diagnostics: Diagnostic[] = [], parsed = new Map<string, ParsedUnit>();
  const virtual = new Map(Object.entries(files).map(([file, text]) => [vpath(file), text]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true, noEmit: true, skipLibCheck: true, strict: true, jsx: ts.JsxEmit.Preserve, allowImportingTsExtensions: true,
  };
  if (files['tsconfig.json']) {
    const config = ts.parseConfigFileTextToJson('tsconfig.json', files['tsconfig.json']);
    if (config.error) diagnostics.push({ side, path: 'tsconfig.json', message: 'Could not parse project configuration; only ordinary local imports will resolve.' });
    else {
      const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions ?? {}, '/snapshot');
      for (const key of ['baseUrl', 'paths', 'rootDirs', 'moduleSuffixes', 'strict', 'strictNullChecks'] as const) {
        if (converted.options[key] !== undefined) Object.assign(options, { [key]: converted.options[key] });
      }
      if (config.config.extends) diagnostics.push({ side, path: 'tsconfig.json', message: 'Extended configuration is not loaded. Inherited aliases may be unresolved.' });
      for (const error of converted.errors) diagnostics.push({ side, path: 'tsconfig.json', message: ts.flattenDiagnosticMessageText(error.messageText, '\n') });
    }
  } else diagnostics.push({ side, message: 'No root tsconfig.json. Local imports are resolved with the bundled TypeScript compiler; external dependencies are not loaded.' });
  const host: ts.CompilerHost = {
    getSourceFile: (file, languageVersion) => virtual.has(file) ? ts.createSourceFile(file, virtual.get(file)!, languageVersion, true) : undefined,
    getDefaultLibFileName: () => '/snapshot/__no_lib__.d.ts', writeFile: () => {}, getCurrentDirectory: () => '/snapshot',
    getDirectories: dir => [...new Set([...virtual.keys()].filter(f => f.startsWith(dir + '/')).map(f => f.slice(dir.length + 1).split('/')[0]))],
    fileExists: file => virtual.has(file), readFile: file => virtual.get(file),
    directoryExists: dir => dir === '/snapshot' || [...virtual.keys()].some(f => f.startsWith(dir + '/')),
    getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    realpath: file => file,
  };
  const roots = Object.keys(files).filter(isSource).map(vpath);
  const program = ts.createProgram(roots, options, host), checker = program.getTypeChecker();
  const nodeIds = new Map<ts.Node, string>(), symbolIds = new Map<ts.Symbol, string>(), invalidSources = new Set<string>();
  const mutated = new Set<ts.Symbol>();
  const resolveSymbol = (node: ts.Node): ts.Symbol | undefined => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
      try { symbol = checker.getAliasedSymbol(symbol); } catch { return undefined; }
    }
    return symbol;
  };
  let analyzedFiles = 0;
  for (const source of program.getSourceFiles()) {
    const file = path.posix.relative('/snapshot', source.fileName);
    if (!isSource(file)) continue;
    const errors = program.getSyntacticDiagnostics(source);
    if (errors.length) {
      invalidSources.add(source.fileName);
      for (const error of errors) diagnostics.push({ side, path: file, message: `Syntax error: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}` });
      continue;
    }
    analyzedFiles++;
    const counts = new Map<string, number>();
    function visit(node: ts.Node, parents: string[] = []) {
      let name: string | undefined, symbolNode: ts.Node | undefined, kind: Unit['kind'] = 'function';
      let declaration: ts.Node = node;
      if (ts.isFunctionDeclaration(node) && node.body) { name = node.name?.text ?? 'default'; symbolNode = node.name; }
      else if (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) && ts.isIdentifier(node.name)) {
        name = node.name.text; symbolNode = node.name; declaration = node;
      } else if (ts.isMethodDeclaration(node) && node.body) { name = node.name.getText(source); symbolNode = node.name; kind = 'method'; }
      if (name) {
        const qualified = [...parents, name].join('.'), count = counts.get(qualified) ?? 0;
        counts.set(qualified, count + 1);
        const id = `u-${hash(`${file}:${qualified}:${count}`)}`;
        const start = sourceLine(source, declaration.getStart(source));
        const end = sourceLine(source, declaration.getEnd());
        const code: CodeSide = { path: file, startLine: start, endLine: end, text: declaration.getText(source) };
        const symbol = symbolNode ? resolveSymbol(symbolNode) : undefined;
        const exported = !!ts.getCombinedModifierFlags(declaration as ts.Declaration) && !!(ts.getCombinedModifierFlags(declaration as ts.Declaration) & (ts.ModifierFlags.Export | ts.ModifierFlags.Default));
        const functionNode = ts.isVariableDeclaration(node) ? node.initializer as ts.ArrowFunction | ts.FunctionExpression : node as ts.FunctionDeclaration | ts.MethodDeclaration;
        const signature = checker.getSignatureFromDeclaration(functionNode);
        const returnType = signature ? checker.getReturnTypeOfSignature(signature) : undefined;
        const typeText = returnType ? checker.typeToString(returnType, functionNode, ts.TypeFormatFlags.NoTruncation) : '';
        const contract = signature ? { signature: checker.signatureToString(signature, functionNode, ts.TypeFormatFlags.NoTruncation), returnType: typeText, inferred: !functionNode.type,
          unknown: !!(returnType!.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) || /\b(?:any|unknown)\b/.test(typeText) || typeText === '{}' } : undefined;
        const unit: Unit = { id, name: qualified, kind, path: file, changed: false, exported, [side]: code, hunkIds: [], markers: [], ...(contract ? { contract: { [side]: contract } } : {}) };
        parsed.set(id, { unit, node: declaration, source, symbol });
        nodeIds.set(declaration, id);
        if (ts.isVariableDeclaration(node) && node.initializer) nodeIds.set(node.initializer, id);
        if (symbol) symbolIds.set(symbol, id);
        ts.forEachChild(node, child => visit(child, [...parents, name!]));
        return;
      }
      if (ts.isClassDeclaration(node) && node.name) { ts.forEachChild(node, child => visit(child, [...parents, node.name!.text])); return; }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const symbol = resolveSymbol(node.left); if (symbol) mutated.add(symbol);
      }
      ts.forEachChild(node, child => visit(child, parents));
    }
    visit(source);
  }
  const links: CallLink[] = [];
  for (const item of parsed.values()) {
    const { node, unit, source } = item;
    function visitCalls(child: ts.Node) {
      if (child !== node && nodeIds.has(child) && nodeIds.get(child) !== unit.id) return;
      if (ts.isCallExpression(child)) {
        const symbol = resolveSymbol(child.expression);
        let target = symbol ? symbolIds.get(symbol) : undefined;
        let reason = 'Target is external, dynamic, or not a supported declaration in this snapshot.';
        const targetItem = target ? parsed.get(target) : undefined;
        if (symbol && mutated.has(symbol)) { target = undefined; reason = 'Function binding is assigned elsewhere; runtime target may differ.'; }
        if (targetItem && ts.isVariableDeclaration(targetItem.node)) {
          const list = targetItem.node.parent;
          if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) { target = undefined; reason = 'Mutable function binding; runtime target may differ.'; }
        }
        if (targetItem && ts.isMethodDeclaration(targetItem.node) && !(ts.getCombinedModifierFlags(targetItem.node) & ts.ModifierFlags.Static)) {
          target = undefined; reason = 'Instance-method dispatch is outside the supported direct-call subset.';
        }
        if (target && invalidSources.has(parsed.get(target)!.source.fileName)) target = undefined;
        const line = sourceLine(source, child.getStart(source));
        links.push({ id: `l-${hash(`${side}:${unit.id}:${child.pos}:${child.expression.getText(source)}`)}`, from: unit.id, ...(target ? { to: target } : {}), side, line,
          expression: child.expression.getText(source), evidence: target ? 'resolved' : 'unresolved', ...(!target ? { reason } : {}), status: 'retained' });
      }
      ts.forEachChild(child, visitCalls);
    }
    visitCalls(node);
  }
  return { parsed, links, diagnostics, analyzedFiles, strictNullChecks: options.strictNullChecks ?? options.strict ?? false };
}

const contains = (code: CodeSide | undefined, line: number | undefined) => !!code && line !== undefined && line >= code.startLine && line <= code.endLine;
function markers(before?: CodeSide, after?: CodeSide): string[] {
  if (!before) return ['Added declaration'];
  if (!after) return ['Removed declaration'];
  const hunks = fileDiff('unit', before.text, after.text);
  const labels = new Set<string>();
  for (const side of ['base', 'head'] as const) {
    const text = side === 'base' ? before.text : after.text;
    const modified = new Set(hunks.flatMap(h => h.lines.filter(l => l.kind === (side === 'base' ? 'remove' : 'add')).map(l => side === 'base' ? l.oldLine! : l.newLine!)));
    // Methods require class context; variable declaration text lacks its const keyword.
    const method = /^(?:(?:public|private|protected|static|async)\s+)*[\w$]+\s*\(/.test(text);
    const prefix = method ? 'class __FlowReview {\n' : /^[\w$]+\s*=/.test(text) ? 'const ' : '';
    const source = ts.createSourceFile('markers.ts', prefix + text + (method ? '\n}' : ''), ts.ScriptTarget.ES2022, true);
    const offset = method ? 1 : 0;
    function visit(node: ts.Node) {
      const start = sourceLine(source, node.getStart(source)) - offset;
      const end = sourceLine(source, node.getEnd()) - offset;
      const touched = [...modified].some(line => line >= start && line <= end);
      if (touched) {
        if (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node) || ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) labels.add('Branch changed');
        if (ts.isReturnStatement(node) || ts.isThrowStatement(node) || ts.isCatchClause(node)) labels.add('Exit changed');
        if (ts.isAwaitExpression(node)) labels.add('Async boundary changed');
        if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) labels.add('Assignment changed');
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...labels].sort();
}

export function analyzeSnapshots(baseFiles: Record<string, string>, headFiles: Record<string, string>, options: { title?: string; repository?: Partial<Report['repository']> } = {}): Report {
  const base = parseSnapshot(baseFiles, 'base'), head = parseSnapshot(headFiles, 'head');
  const units: Unit[] = [];
  for (const id of new Set([...base.parsed.keys(), ...head.parsed.keys()])) {
    const old = base.parsed.get(id)?.unit, next = head.parsed.get(id)?.unit;
    const unit: Unit = { ...(next ?? old)!, ...(old?.base ? { base: old.base } : {}), ...(next?.head ? { head: next.head } : {}), changed: old?.base?.text !== next?.head?.text, hunkIds: [], markers: [], contract: { ...old?.contract, ...next?.contract } };
    if (unit.changed) unit.markers = markers(unit.base, unit.head);
    units.push(unit);
  }
  const files: ChangedFile[] = [];
  for (const file of [...new Set([...Object.keys(baseFiles), ...Object.keys(headFiles)])].sort()) {
    const before = baseFiles[file], after = headFiles[file];
    if (before === after) continue;
    const binary = (before ?? '').includes('\0') || (after ?? '').includes('\0');
    const hunks = binary ? [] : fileDiff(file, before ?? '', after ?? '');
    const related = units.filter(u => u.path === file && u.changed);
    for (const unit of related) unit.hunkIds = hunks.filter(h => h.lines.some(l => (l.kind === 'remove' && contains(unit.base, l.oldLine)) || (l.kind === 'add' && contains(unit.head, l.newLine)))).map(h => h.id);
    const residual = hunks.filter(h => h.lines.some(l => l.kind !== 'context' && !related.some(u => l.kind === 'remove' ? contains(u.base, l.oldLine) : contains(u.head, l.newLine))));
    const fileId = `f-${hash(file)}`;
    if (binary || residual.length || !related.length) {
      const code = (text: string | undefined): CodeSide | undefined => text === undefined || binary ? undefined : { path: file, startLine: 1, endLine: text.split('\n').length, text };
      const rest: Unit = { id: `u-file-${hash(file)}`, name: isSource(file) && related.length ? 'Other changes' : path.posix.basename(file), kind: 'file', path: file, changed: true, exported: false,
        ...(code(before) ? { base: code(before) } : {}), ...(code(after) ? { head: code(after) } : {}), hunkIds: (related.length ? residual : hunks).map(h => h.id), markers: binary ? ['Binary change'] : [isSource(file) ? 'File context' : 'Companion change'] };
      units.push(rest); related.push(rest);
    }
    files.push({ id: fileId, path: file, status: before === undefined ? 'added' : after === undefined ? 'deleted' : 'modified', additions: hunks.flatMap(h => h.lines).filter(l => l.kind === 'add').length,
      deletions: hunks.flatMap(h => h.lines).filter(l => l.kind === 'remove').length, binary, hunks, ...(!binary && before !== undefined ? { base: before } : {}), ...(!binary && after !== undefined ? { head: after } : {}), unitIds: related.map(u => u.id) });
  }
  const links = [...base.links, ...head.links];
  const key = (link: CallLink) => `${link.from}:${link.to ?? '?'}:${link.expression}:${link.evidence}`;
  // Match unchanged source lines first. Count-only matching mislabels old call sites
  // when an identical call is inserted earlier in a function or test helper.
  const lineMaps = new Map<string, Map<number, number>>();
  for (const file of Object.keys(baseFiles)) {
    const map = new Map<number, number>(); let oldLine = 1, newLine = 1;
    for (const part of diffLines(baseFiles[file], headFiles[file] ?? '')) {
      const count = part.count ?? 0;
      if (!part.added && !part.removed) { for (let i = 0; i < count; i++) map.set(oldLine + i, newLine + i); }
      if (!part.added) oldLine += count;
      if (!part.removed) newLine += count;
    }
    lineMaps.set(file, map);
  }
  const unmatchedHead = new Set(head.links), unmatchedBase = new Set(base.links);
  for (const oldLink of base.links) {
    const file = base.parsed.get(oldLink.from)!.unit.path;
    const mapped = lineMaps.get(file)?.get(oldLink.line);
    const next = mapped === undefined ? undefined : head.links.find(l => unmatchedHead.has(l) && key(l) === key(oldLink) && l.line === mapped);
    if (next) { unmatchedHead.delete(next); unmatchedBase.delete(oldLink); }
  }
  // On rewritten lines, preserve the relationship where both snapshots still
  // contain it. This is a relationship delta, not a claim of identical arguments.
  for (const oldLink of unmatchedBase) {
    const next = head.links.find(l => unmatchedHead.has(l) && key(l) === key(oldLink));
    if (next) { unmatchedHead.delete(next); unmatchedBase.delete(oldLink); }
  }
  for (const l of unmatchedBase) l.status = 'removed';
  for (const l of unmatchedHead) l.status = 'added';
  const changed = units.filter(u => u.changed && u.kind !== 'file');
  const incoming = new Set(links.filter(l => l.to && l.side === 'head').map(l => l.to));
  const roots = changed.filter(u => u.exported || !incoming.has(u.id));
  const edits = accountChangedLines(files, units);
  const covered = new Set(edits.map(e => e.hunkId));
  const repo = { name: 'Local repository', base: 'base', head: 'head', mergeBase: 'base', dirty: false, ...options.repository };
  const id = hash(JSON.stringify({ baseFiles, headFiles, repo, engine: `0.1.0:${ts.version}` }));
  return {
    schemaVersion: 1, id, title: options.title ?? 'Follow the change', generatedAt: new Date().toISOString(), repository: repo,
    analysis: { toolVersion: '0.1.0', typescriptVersion: ts.version, baseStrictNullChecks: base.strictNullChecks, headStrictNullChecks: head.strictNullChecks, scope: 'Direct TypeScript calls from acquired Git sources. External type libraries are not loaded. Root path and strictness options only; defaults use strict null checking.' },
    files, units: units.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name)), links, rootIds: (roots.length ? roots : changed).map(u => u.id), edits,
    diagnostics: [...base.diagnostics, ...head.diagnostics],
    coverage: { complete: true, changedFiles: files.length, totalHunks: files.reduce((n, f) => n + f.hunks.length, 0), mappedHunks: covered.size,
      unresolvedCalls: links.filter(l => l.evidence === 'unresolved').length, analyzedFiles: base.analyzedFiles + head.analyzedFiles,
      note: 'Every acquired changed file is listed. Navigation resolves supported TypeScript declarations, not all runtime paths. Files outside functions remain in the ledger.' },
  };
}

/** One owner per edited source line; original hunks remain the complete oracle. */
export function accountChangedLines(files: ChangedFile[], units: Unit[]): ChangedLine[] {
  const edits: ChangedLine[] = [];
  for (const file of files) {
    const related = units.filter(u => file.unitIds.includes(u.id));
    for (const hunk of file.hunks) for (const row of hunk.lines) {
      if (row.kind === 'context') continue;
      const side: Side = row.kind === 'remove' ? 'base' : 'head';
      const line = side === 'base' ? row.oldLine! : row.newLine!;
      const candidates = related.filter(u => u.kind !== 'file' && contains(u[side], line)).sort((a, b) =>
        ((a[side]!.endLine - a[side]!.startLine) - (b[side]!.endLine - b[side]!.startLine)) || a[side]!.text.length - b[side]!.text.length || a.id.localeCompare(b.id));
      const innermost = candidates[0];
      const sharedWithSibling = innermost && candidates.some(candidate => candidate.id !== innermost.id && !candidate[side]!.text.includes(innermost[side]!.text));
      let owner = (!sharedWithSibling ? innermost : undefined) ?? related.find(u => u.kind === 'file');
      if (!owner) {
        owner = { id: `u-file-${hash(file.path)}`, name: 'Other changes', kind: 'file', path: file.path, changed: true, exported: false, hunkIds: [], markers: ['File context'],
          ...(file.base !== undefined ? { base: { path: file.oldPath ?? file.path, startLine: 1, endLine: file.base.split('\n').length, text: file.base } } : {}),
          ...(file.head !== undefined ? { head: { path: file.path, startLine: 1, endLine: file.head.split('\n').length, text: file.head } } : {}) };
        units.push(owner); related.push(owner); file.unitIds.push(owner.id);
      }
      edits.push({ id: `e-${hash(`${file.id}:${side}:${line}`)}`, fileId: file.id, hunkId: hunk.id, side, line, unitId: owner.id, text: row.text });
    }
  }
  // Hunk navigation references are derived from canonical ownership, not overlap.
  for (const unit of units) unit.hunkIds = [...new Set(edits.filter(e => e.unitId === unit.id).map(e => e.hunkId))];
  return edits;
}

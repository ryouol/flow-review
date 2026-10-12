export type Side = 'base' | 'head';
export interface CodeSide { path: string; startLine: number; endLine: number; text: string }
export interface DiffLine { kind: 'context' | 'add' | 'remove'; text: string; oldLine?: number; newLine?: number }
export interface Hunk { id: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }
export interface ChangedFile {
  id: string; path: string; oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'type-changed';
  additions: number; deletions: number; binary: boolean; oldMode?: string; newMode?: string;
  hunks: Hunk[]; base?: string; head?: string; unitIds: string[];
}
export interface Unit {
  id: string; name: string; kind: 'function' | 'method' | 'file'; path: string;
  changed: boolean; exported: boolean; base?: CodeSide; head?: CodeSide;
  hunkIds: string[]; markers: string[];
  contract?: { base?: Contract; head?: Contract };
}
export interface Contract { signature: string; returnType: string; inferred: boolean; unknown: boolean }
export interface ChangedLine { id: string; fileId: string; hunkId: string; side: Side; line: number; unitId: string; text: string }
export interface CallLink {
  id: string; from: string; to?: string; side: Side; line: number;
  expression: string; evidence: 'resolved' | 'unresolved'; reason?: string;
  status: 'added' | 'removed' | 'retained';
}
export interface Diagnostic { side: Side; path?: string; message: string }
export interface Report {
  schemaVersion: 1; id: string; title: string; generatedAt: string;
  repository: { name: string; url?: string; base: string; head: string; mergeBase: string; dirty: boolean };
  analysis: { toolVersion: string; typescriptVersion: string; baseStrictNullChecks: boolean; headStrictNullChecks: boolean; scope: string };
  files: ChangedFile[]; units: Unit[]; links: CallLink[]; rootIds: string[]; edits: ChangedLine[];
  diagnostics: Diagnostic[];
  coverage: { complete: boolean; changedFiles: number; totalHunks: number; mappedHunks: number; unresolvedCalls: number; analyzedFiles: number; note: string };
}

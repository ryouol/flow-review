import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowSquareOut, CaretDown, CaretRight, Check, Circle, DotsThree, FileText, FolderSimple, GitBranch, List, MagnifyingGlass, UploadSimple, WarningCircle, X } from './icons.js';
import type { CallLink, ChangedFile, DiffLine, Report, Side, Unit } from '../model.js';
import { validateReport } from '../validate.js';
import { codeDiff } from './diff.js';
import './styles.css';

type Revision = 'both' | Side;
type Selection = { type: 'unit' | 'file'; id: string };
type Reading = { reviewed: string[]; notes: string };
type Panel = 'contracts' | 'analysis' | 'notes' | 'menu' | 'generate' | null;
type Peek = { link: CallLink; unitId: string };
type SourceScroll = { top: number; left: number };
type SourceHistory = { selection: Selection; revision: Revision; scrolls: SourceScroll[]; peek: Peek | null; peekHistory: Peek[]; originId?: string };
const sideName = (side: Side) => side === 'base' ? 'before' : 'after';
const emptyReading = (): Reading => ({ reviewed: [], notes: '' });
const shortHash = (hash: string) => hash.slice(0, 8);

function initialSelection(report: Report): Selection {
  if (!report.files.length) return { type: 'file', id: '' };
  const start = report.rootIds[0] ?? report.units.find(unit => unit.changed && unit.kind !== 'file')?.id;
  return start ? { type: 'unit', id: start } : { type: 'file', id: report.files[0].id };
}
function hasMetadataChange(file: ChangedFile): boolean {
  const noNewline = (text?: string) => !!text && !text.endsWith('\n');
  return file.status === 'renamed' || file.status === 'type-changed' || file.oldMode !== file.newMode || noNewline(file.base) !== noNewline(file.head);
}
function readState(id: string): Reading {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`flow-review:${id}`) ?? 'null');
    if (value && typeof value === 'object' && 'reviewed' in value && Array.isArray(value.reviewed) && value.reviewed.every(key => typeof key === 'string') && 'notes' in value && typeof value.notes === 'string') return { reviewed: value.reviewed, notes: value.notes };
  } catch { /* An offline report remains usable without browser storage. */ }
  return emptyReading();
}
function VisibleCharacters({ text }: { text: string }) {
  return <>{text.split(/([\r\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff])/g).map((part, index) => {
    if (index % 2 === 0) return part;
    const label = part === '\r' ? 'CR' : `U+${part.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    return <span key={index} className="source-control" title={`Visible source control: ${label}`}>[{label}]</span>;
  })}</>;
}
function CodeText({ text }: { text: string }) {
  const parts = text.split(/(\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:async|await|return|if|else|throw|new|const|let|function|export|import|from|class|interface|type|try|catch|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g);
  return <>{parts.map((part, index) => <span key={index} className={part.startsWith('//') ? 'syntax-comment' : /^['"]/.test(part) ? 'syntax-string' : /^(async|await|return|if|else|throw|new|const|let|function|export|import|from|class|interface|type|try|catch|true|false|null|undefined)$/.test(part) ? 'syntax-keyword' : /^\d/.test(part) ? 'syntax-number' : undefined}><VisibleCharacters text={part} /></span>)}</>;
}

interface ReviewModel { unitKeys: (unit: Unit) => string[]; fileKeys: (file: ChangedFile) => string[]; canonical: Set<string> }
function reviewModel(report: Report | null): ReviewModel {
  const units = report?.units ?? []; const files = report?.files ?? []; const edits = report?.edits ?? [];
  const editOwners = new Set(edits.map(edit => edit.unitId));
  const unitKeys = (unit: Unit) => editOwners.has(unit.id) || (unit.changed && unit.kind === 'file' && files.some(file => file.unitIds.includes(unit.id) && !file.hunks.length && !hasMetadataChange(file))) ? [`unit:${unit.id}`] : [];
  const fileKeys = (file: ChangedFile) => {
    const keys = [...new Set(edits.filter(edit => edit.fileId === file.id).map(edit => `unit:${edit.unitId}`))];
    if (!file.hunks.length) file.unitIds.forEach(id => { const unit = units.find(unit => unit.id === id); if (unit) keys.push(...unitKeys(unit)); });
    if (hasMetadataChange(file)) keys.push(`metadata:${file.id}`);
    if (!keys.length) keys.push(`file:${file.id}`);
    return [...new Set(keys)];
  };
  const canonical = new Set(files.flatMap(fileKeys));
  units.forEach(unit => unitKeys(unit).forEach(key => canonical.add(key)));
  return { unitKeys, fileKeys, canonical };
}

function alignRows(rows: DiffLine[]): { base?: DiffLine; head?: DiffLine }[] {
  const aligned: { base?: DiffLine; head?: DiffLine }[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].kind === 'context') { aligned.push({ base: rows[index], head: rows[index] }); index++; continue; }
    const removed: DiffLine[] = []; const added: DiffLine[] = [];
    while (index < rows.length && rows[index].kind !== 'context') { (rows[index].kind === 'remove' ? removed : added).push(rows[index]); index++; }
    for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) aligned.push({ base: removed[offset], head: added[offset] });
  }
  return aligned;
}
function snapshotRows(text: string, startLine: number, side: Side, changed = new Set<number>()): DiffLine[] {
  if (!text) return [];
  return text.replace(/\n$/, '').split('\n').map((text, index) => {
    const line = startLine + index;
    return { kind: changed.has(line) ? side === 'base' ? 'remove' : 'add' : 'context', text, ...(side === 'base' ? { oldLine: line } : { newLine: line }) };
  });
}

interface SourceProps { rows: DiffLine[]; revision: Revision; links?: CallLink[]; onPeek: (link: CallLink, origin: HTMLElement) => void; activePeek?: string; compact?: boolean }
function SourceLine({ row, side, links, onPeek, activePeek }: { row?: DiffLine; side: Side; links: CallLink[]; onPeek: SourceProps['onPeek']; activePeek?: string }) {
  if (!row) return <div className="source-line source-gap" aria-hidden="true" />;
  const line = side === 'base' ? row.oldLine : row.newLine;
  const calls = links.filter(link => link.side === side && link.line === line && link.evidence === 'resolved' && link.to);
  const chunks: React.ReactNode[] = [];
  const unmatched: CallLink[] = [];
  let offset = 0;
  calls.forEach(link => {
    const firstOccurrence = row.text.indexOf(link.expression);
    const uniqueExpression = calls.filter(call => call.expression === link.expression).length === 1;
    const uniqueSourceOccurrence = firstOccurrence >= 0 && row.text.indexOf(link.expression, firstOccurrence + link.expression.length) === -1;
    if (!uniqueExpression || !uniqueSourceOccurrence) { unmatched.push(link); return; }
    const match = row.text.indexOf(link.expression, offset);
    if (match < 0) { unmatched.push(link); return; }
    chunks.push(<CodeText key={`${link.id}-prefix`} text={row.text.slice(offset, match)} />);
    chunks.push(<button key={link.id} data-call-id={link.id} data-testid="call-link" data-placement="inline" data-side={side} data-line={line} aria-label={`Peek ${link.expression} from ${sideName(side)} line ${line}`} aria-pressed={activePeek === link.id} className={`source-call ${link.status === 'removed' ? 'removed-call' : ''} ${activePeek === link.id ? 'peeked-call' : ''}`} title={`${link.status === 'removed' ? 'Removed call · ' : ''}Static declaration · ${sideName(side)}:${line}`} onClick={event => onPeek(link, event.currentTarget)}><VisibleCharacters text={link.expression} /></button>);
    offset = match + link.expression.length;
  });
  chunks.push(<CodeText key="suffix" text={row.text.slice(offset) || (offset ? '' : ' ')} />);
  return <div className={`source-line ${row.kind}`} data-testid="code-line" data-side={side} data-old-line={side === 'base' ? row.oldLine : undefined} data-new-line={side === 'head' ? row.newLine : undefined}><span className="line-number">{line ?? ''}</span><code>{chunks}{unmatched.map(link => <button key={link.id} data-call-id={link.id} className="multiline-call" data-testid="call-link" data-placement="line" data-side={side} data-line={line} aria-label={`Peek ${link.expression} from ${sideName(side)} line ${line}`} title={`Static declaration · ${sideName(side)}:${line} · ${link.expression}`} onClick={event => onPeek(link, event.currentTarget)}><ArrowSquareOut size={13} /></button>)}</code></div>;
}
function SourceView({ rows, revision, links = [], onPeek, activePeek, compact = false }: SourceProps) {
  const aligned = useMemo(() => alignRows(rows), [rows]);
  const beforeRef = useRef<HTMLDivElement>(null); const afterRef = useRef<HTMLDivElement>(null);
  const sides: Side[] = revision === 'both' ? ['base', 'head'] : [revision];
  return <div className={`source-view ${revision === 'both' ? 'split-view' : 'single-view'} ${compact ? 'compact-source' : ''}`} data-testid="source-view" data-revision={revision}>
    {sides.map(side => <section className={`source-plane ${side}`} aria-label={`${sideName(side)} source`} key={side}><header>{side === 'base' ? 'Before' : 'After'}</header><div className="source-scroll" ref={side === 'base' ? beforeRef : afterRef} onScroll={event => { const opposite = side === 'base' ? afterRef.current : beforeRef.current; if (opposite && opposite.scrollTop !== event.currentTarget.scrollTop) opposite.scrollTop = event.currentTarget.scrollTop; }}>
      {aligned.filter(pair => revision === 'both' || pair[side]).map((pair, index) => <SourceLine key={index} row={pair[side]} side={side} links={links} onPeek={onPeek} activePeek={activePeek} />)}
      {!aligned.some(pair => pair[side]) && <p className="empty-source">No source on this revision.</p>}
    </div></section>)}
  </div>;
}

function Metadata({ file }: { file: ChangedFile }) {
  return <div className="file-metadata"><span className="status-label">{file.status}</span><span className="addition">+{file.additions}</span><span className="deletion">−{file.deletions}</span><span>{file.hunks.length} {file.hunks.length === 1 ? 'hunk' : 'hunks'}</span>{file.oldPath && file.oldPath !== file.path && <code className="metadata-line">{file.oldPath} → {file.path}</code>}{file.oldMode !== file.newMode && <code className="metadata-line">Mode {file.oldMode ?? 'absent'} → {file.newMode ?? 'absent'}</code>}{!file.binary && file.base && !file.base.endsWith('\n') && <span className="badge caution">No final newline before</span>}{!file.binary && file.head && !file.head.endsWith('\n') && <span className="badge caution">No final newline after</span>}</div>;
}
function FileReader({ file, revision, onPeek }: { file: ChangedFile; revision: Revision; onPeek: SourceProps['onPeek'] }) {
  const [snapshot, setSnapshot] = useState<Side | null>(null);
  const text = snapshot === 'base' ? file.base : file.head;
  return <article className="file-reader" aria-label={`${file.path} raw diff`}><div className="file-reader-header"><Metadata file={file} /><div className="snapshot-control" role="group" aria-label="File source"><button aria-pressed={!snapshot} onClick={() => setSnapshot(null)}>Raw hunks</button><button aria-pressed={snapshot === 'base'} disabled={file.base === undefined} onClick={() => setSnapshot('base')}>Full before</button><button aria-pressed={snapshot === 'head'} disabled={file.head === undefined} onClick={() => setSnapshot('head')}>Full after</button></div></div><div className="raw-file-scroll">
    {file.binary ? <div className="file-boundary"><FileText size={28} /><h2>Binary file</h2><p>This file is included in the review inventory. Binary content has no text diff.</p></div> : snapshot && text !== undefined ? <SourceView rows={snapshotRows(text, 1, snapshot, new Set(file.hunks.flatMap(hunk => hunk.lines.filter(line => line.kind === (snapshot === 'base' ? 'remove' : 'add')).map(line => (snapshot === 'base' ? line.oldLine : line.newLine)!))))} revision={snapshot} onPeek={onPeek} /> : file.hunks.length ? file.hunks.map(hunk => <section className="raw-hunk" key={hunk.id} data-testid="raw-hunk" data-hunk-id={hunk.id}><header><code>@@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</code><span>Original Git hunk</span></header><SourceView rows={hunk.lines} revision={revision} onPeek={onPeek} /></section>) : <div className="file-boundary"><FileText size={28} /><h2>No text hunks</h2><p>Review the filename, modes, and file metadata above. This change still requires an explicit review.</p></div>}
  </div></article>;
}

interface Directory { name: string; path: string; directories: Directory[]; files: ChangedFile[] }
function directoryTree(files: ChangedFile[]): Directory {
  const root: Directory = { name: '', path: '', directories: [], files: [] };
  files.forEach(file => { const parts = file.path.split('/'); let directory = root; parts.slice(0, -1).forEach(name => { let child = directory.directories.find(child => child.name === name); if (!child) { child = { name, path: directory.path ? `${directory.path}/${name}` : name, directories: [], files: [] }; directory.directories.push(child); } directory = child; }); directory.files.push(file); });
  return root;
}
interface NavProps { report: Report; selected: Selection; reviewed: Set<string>; model: ReviewModel; search: string; expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>; select: (selection: Selection) => void }
function FileBranch({ file, props }: { file: ChangedFile; props: NavProps }) {
  const functions = file.unitIds.map(id => props.report.units.find(unit => unit.id === id)).filter((unit): unit is Unit => !!unit && unit.kind !== 'file' && unit.changed);
  const query = props.search.toLowerCase();
  const fileMatches = `${file.path} ${file.oldPath ?? ''}`.toLowerCase().includes(query);
  const visible = functions.filter(unit => fileMatches || unit.name.toLowerCase().includes(query));
  if (!fileMatches && !visible.length) return null;
  const open = props.expanded.has(file.id) || !!props.search;
  const selected = props.selected.type === 'file' && props.selected.id === file.id;
  const done = props.model.fileKeys(file).every(key => props.reviewed.has(key));
  return <div className="file-branch"><div className={`file-nav-row ${selected ? 'selected' : ''}`}><button className="file-disclosure" aria-label={`Toggle file ${file.path}`} aria-expanded={open} disabled={!functions.length} onClick={() => props.setExpanded(previous => { const next = new Set(previous); next.has(file.id) ? next.delete(file.id) : next.add(file.id); return next; })}>{functions.length ? open ? <CaretDown size={14} /> : <CaretRight size={14} /> : <FileText size={14} />}</button><button className="file-nav-button" aria-label={`Open file ${file.path}`} aria-current={selected ? 'page' : undefined} onClick={() => { props.setExpanded(previous => new Set([...previous, file.id])); props.select({ type: 'file', id: file.id }); }}><FileText size={15} /><span>{file.path.split('/').at(-1)}</span><Circle size={6} weight="fill" className={done ? 'reviewed-dot' : 'unread-dot'} /><span className="sr-only">{done ? 'Reviewed' : 'Unread'}</span></button></div>{open && visible.map(unit => { const keys = props.model.unitKeys(unit); const unitDone = !!keys.length && keys.every(key => props.reviewed.has(key)); const active = props.selected.type === 'unit' && props.selected.id === unit.id; return <button key={unit.id} className={`unit-nav-button ${active ? 'selected' : ''}`} aria-label={`Open ${unit.name}`} aria-current={active ? 'page' : undefined} onClick={() => props.select({ type: 'unit', id: unit.id })}><Circle size={7} /><span>{unit.name}</span><Circle size={6} weight="fill" className={unitDone ? 'reviewed-dot' : active ? 'selected-dot' : 'unread-dot'} /><span className="sr-only">{unitDone ? 'Reviewed' : !keys.length ? 'Context only' : 'Unread'}</span></button>; })}</div>;
}
function DirectoryBranch({ directory, props, root = false }: { directory: Directory; props: NavProps; root?: boolean }) {
  const [open, setOpen] = useState(true);
  const hasMatch = (node: Directory): boolean => node.files.some(file => `${file.path} ${file.oldPath ?? ''}`.toLowerCase().includes(props.search.toLowerCase()) || file.unitIds.some(id => props.report.units.find(unit => unit.id === id)?.name.toLowerCase().includes(props.search.toLowerCase()))) || node.directories.some(hasMatch);
  if (props.search && !hasMatch(directory)) return null;
  return <div className={root ? 'navigation-root' : 'directory-branch'}>{!root && <button className="directory-button" aria-expanded={open || !!props.search} onClick={() => setOpen(!open)}>{open || props.search ? <CaretDown size={14} /> : <CaretRight size={14} />}<FolderSimple size={16} weight="duotone" /><span>{directory.name}</span></button>}{(root || open || props.search) && <div className={root ? '' : 'directory-content'}>{directory.files.map(file => <FileBranch file={file} key={file.id} props={props} />)}{directory.directories.map(child => <DirectoryBranch directory={child} key={child.path} props={props} />)}</div>}</div>;
}

function ContractPanel({ unit, report, select, revision, onPeek }: { unit: Unit; report: Report; select: (selection: Selection) => void; revision: Revision; onPeek: SourceProps['onPeek'] }) {
  const incoming = report.links.filter(link => link.evidence === 'resolved' && link.to === unit.id);
  const unresolved = report.links.filter(link => link.from === unit.id && link.evidence === 'unresolved' && (revision === 'both' || link.side === revision));
  const fileById = new Map(report.files.map(file => [file.id, file]));
  const editedSites = new Set(report.edits.map(edit => { const file = fileById.get(edit.fileId)!; return `${edit.side}\0${edit.side === 'base' ? file.oldPath ?? file.path : file.path}\0${edit.line}`; }));
  const groups = [{ label: 'Changed callers', links: [] as CallLink[] }, { label: 'Untouched callers', links: [] as CallLink[] }, { label: 'Removed callers', links: [] as CallLink[] }];
  incoming.forEach(link => { const caller = report.units.find(unit => unit.id === link.from)!; groups[link.status === 'removed' || !caller.head ? 2 : caller.changed ? 0 : 1].links.push(link); });
  return <><h2>Contract &amp; callers</h2><div className="contract-revisions">{(['base', 'head'] as Side[]).filter(side => revision === 'both' || revision === side).map(side => { const contract = unit.contract?.[side]; return <section key={side}><h3>{sideName(side)} contract</h3>{contract ? <><code><VisibleCharacters text={contract.signature} /></code><p>Returns <code>{contract.returnType}</code></p><span className="badge">{contract.inferred ? 'Inferred return type' : 'Declared return type'}</span>{contract.unknown && <><span className="badge caution">Contract unknown</span><p className="panel-note">Omitted or unresolved types limit this contract. No reliable equivalence claim can be made.</p></>}</> : <p className="panel-note">{unit[side] ? 'No contract extracted.' : `Absent ${sideName(side)}.`}</p>}</section>; })}</div>{unit.markers.length > 0 && <div className="change-markers">{unit.markers.map((marker, index) => <span className="badge" key={index}>{marker}</span>)}</div>}<p className="panel-note">Resolved calls within acquired snapshots; dynamic/external uses not included. Counts include before and after source locations.</p>{incoming.length ? groups.filter(group => group.links.length).map(group => <details className="caller-group" key={group.label} open={group.links.length <= 8}><summary>{group.label}<span>{group.links.length}</span></summary>{group.links.map(link => { const caller = report.units.find(unit => unit.id === link.from)!; const edited = editedSites.has(`${link.side}\0${caller[link.side]?.path ?? caller.path}\0${link.line}`); return <button className="caller-button" key={link.id} aria-label={`Open caller ${caller.name} from ${sideName(link.side)} line ${link.line}`} onClick={() => select({ type: 'unit', id: caller.id })}><span><strong>{caller.name}</strong><code>{caller[link.side]?.path ?? caller.path}:{link.line}</code><small>{edited ? 'Call-site line edited' : caller.changed ? 'Caller changed elsewhere' : 'Call-site line untouched'}</small></span><span className="badge">{sideName(link.side)}</span>{link.status === 'removed' && <span className="badge removed">Removed call</span>}<CaretRight size={14} /></button>; })}</details>) : <p className="panel-note">No incoming calls were resolved. This does not establish that the declaration has no users.</p>}<details className="uncertainty-list"><summary>{unresolved.length} unresolved call sites in this declaration</summary>{unresolved.map(link => <div key={link.id} data-testid="call-link" data-side={link.side} data-line={link.line}><code><VisibleCharacters text={link.expression} /></code><span className="badge">{sideName(link.side)}:{link.line}</span>{link.status === 'removed' && <span className="badge removed">Removed call</span>}<p>{link.reason ?? 'Target unavailable in the acquired snapshot.'}</p></div>)}</details><p className="panel-note">Source declarations provide static evidence, not guaranteed runtime dispatch.</p></>;
}

function App({ initialReport, demoReport = null, online = false, initialError = '', initialDemo = false }: { initialReport: Report | null; demoReport?: Report | null; online?: boolean; initialError?: string; initialDemo?: boolean }) {
  const [report, setReport] = useState(initialReport); const [demo, setDemo] = useState(initialDemo);
  const [reading, setReading] = useState<Reading>(() => initialReport ? readState(initialReport.id) : emptyReading());
  const [selection, setSelection] = useState<Selection>(() => initialReport ? initialSelection(initialReport) : { type: 'file', id: '' });
  const [revision, setRevision] = useState<Revision>('both'); const [panel, setPanel] = useState<Panel>(null);
  const [search, setSearch] = useState(''); const [error, setError] = useState(initialError); const [notice, setNotice] = useState('');
  const [filesOpen, setFilesOpen] = useState(false); const [dragging, setDragging] = useState(false); const [confirmReset, setConfirmReset] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialReport?.files.filter(file => file.unitIds.some(id => initialReport.rootIds.includes(id))).map(file => file.id) ?? []));
  const [peek, setPeek] = useState<Peek | null>(null); const [peekHistory, setPeekHistory] = useState<Peek[]>([]); const [selectionHistory, setSelectionHistory] = useState<SourceHistory[]>([]);
  const searchRef = useRef<HTMLInputElement>(null); const importRef = useRef<HTMLInputElement>(null); const mainRef = useRef<HTMLElement>(null); const panelRef = useRef<HTMLElement>(null); const peekOrigin = useRef<HTMLElement | null>(null); const panelOrigin = useRef<HTMLElement | null>(null); const dragDepth = useRef(0);
  const peekOriginId = useRef<string | undefined>(undefined);
  const pendingSourcePosition = useRef<SourceScroll[] | 'reset' | null>(null);
  const reviewed = useMemo(() => new Set(reading.reviewed), [reading.reviewed]); const model = useMemo(() => reviewModel(report), [report]);
  const reviewedCount = [...model.canonical].filter(key => reviewed.has(key)).length; const total = model.canonical.size;
  const edits = [...new Map((report?.edits ?? []).map(edit => [edit.id, edit])).values()]; const reviewedEdits = edits.filter(edit => reviewed.has(`unit:${edit.unitId}`)).length;
  const unit = selection.type === 'unit' ? report?.units.find(unit => unit.id === selection.id) : undefined;
  const file = selection.type === 'file' ? report?.files.find(file => file.id === selection.id) : unit?.kind === 'file' ? report?.files.find(file => file.unitIds.includes(unit.id)) : undefined;
  const sourceFile = file ?? report?.files.find(file => file.path === unit?.path || file.oldPath === unit?.path);
  const rows = useMemo(() => unit ? codeDiff(unit.base, unit.head) : [], [unit]);
  const links = report?.links.filter(link => link.from === unit?.id) ?? [];
  const peekUnit = report?.units.find(unit => unit.id === peek?.unitId);
  const peekSide = peek?.link.side ?? 'head';
  const peekRows = useMemo(() => {
    const code = peekUnit?.[peekSide];
    if (!code) return [];
    const paths = new Map(report?.files.map(file => [file.id, peekSide === 'base' ? file.oldPath ?? file.path : file.path]) ?? []);
    const changed = new Set(report?.edits.filter(edit => edit.side === peekSide && paths.get(edit.fileId) === code.path).map(edit => edit.line) ?? []);
    return snapshotRows(code.text, code.startLine, peekSide, changed);
  }, [peekUnit, peekSide, report]);
  const currentKeys = file ? model.fileKeys(file) : unit ? model.unitKeys(unit) : [];
  const currentReviewed = !!currentKeys.length && currentKeys.every(key => reviewed.has(key));
  const typesIncomplete = !!unit && (!!unit.contract?.base?.unknown || !!unit.contract?.head?.unknown || links.some(link => link.evidence === 'unresolved'));
  const callerCount = report?.links.filter(link => link.to === unit?.id && link.evidence === 'resolved').length ?? 0;
  const tree = useMemo(() => directoryTree(report?.files ?? []), [report]);
  const primaryScrollers = () => [...(mainRef.current?.querySelectorAll<HTMLElement>('.unit-reader .source-scroll, .file-reader .source-scroll, .file-reader .raw-file-scroll') ?? [])];

  const closePeek = (restore = true) => {
    setPeek(null); setPeekHistory([]);
    if (restore) requestAnimationFrame(() => {
      const origin = peekOrigin.current?.isConnected ? peekOrigin.current : [...(mainRef.current?.querySelectorAll<HTMLElement>('.unit-reader [data-call-id]') ?? [])].find(element => element.dataset.callId === peekOriginId.current);
      origin?.focus({ preventScroll: true });
    });
  };
  const select = (next: Selection, remember = false) => {
    if (remember) {
      const current: SourceHistory = { selection, revision, scrolls: primaryScrollers().map(element => ({ top: element.scrollTop, left: element.scrollLeft })), peek, peekHistory, originId: peekOriginId.current };
      setSelectionHistory(previous => [...previous, current]);
    } else setSelectionHistory([]);
    pendingSourcePosition.current = 'reset';
    setSelection(next); setPeek(null); setPeekHistory([]); setFilesOpen(false); setPanel(null); setNotice('');
    const nextUnit = next.type === 'unit' ? report?.units.find(unit => unit.id === next.id) : undefined;
    const owner = next.type === 'file' ? report?.files.find(file => file.id === next.id) : report?.files.find(file => file.path === nextUnit?.path || file.oldPath === nextUnit?.path);
    if (owner) setExpanded(previous => new Set([...previous, owner.id]));
  };
  const openPeek: SourceProps['onPeek'] = (link, origin) => {
    if (!link.to) return;
    if (!peek) { peekOrigin.current = origin; peekOriginId.current = link.id; setPeekHistory([]); } else if (peek.link.id !== link.id) setPeekHistory(previous => [...previous, peek]);
    setPeek({ link, unitId: link.to });
  };
  const openPanel = (next: Panel, origin?: HTMLElement) => { panelOrigin.current = origin ?? null; setPanel(panel === next ? null : next); };
  const closePanel = () => { setPanel(null); setConfirmReset(false); requestAnimationFrame(() => panelOrigin.current?.isConnected && panelOrigin.current.focus()); };
  const mark = (keys: string[], checked: boolean) => setReading(previous => ({ ...previous, reviewed: checked ? [...new Set([...previous.reviewed, ...keys])] : previous.reviewed.filter(key => !keys.includes(key)) }));
  const nextUnreviewed = () => {
    if (!report) return;
    const queue: { selection: Selection; keys: string[] }[] = [];
    report.files.forEach(file => model.fileKeys(file).forEach(key => {
      const owner = key.startsWith('unit:') ? report.units.find(unit => `unit:${unit.id}` === key) : undefined;
      const target: Selection = owner && owner.kind !== 'file' ? { type: 'unit', id: owner.id } : { type: 'file', id: file.id };
      const existing = queue.find(item => item.selection.type === target.type && item.selection.id === target.id);
      if (existing) existing.keys.push(key); else queue.push({ selection: target, keys: [key] });
    }));
    const index = queue.findIndex(item => item.selection.type === selection.type && item.selection.id === selection.id);
    const next = [...queue.slice(index + 1), ...queue.slice(0, index + 1)].find(item => item.keys.some(key => !reviewed.has(key)));
    if (next) { setSearch(''); select(next.selection); }
  };

  useEffect(() => { if (!report) return; try { localStorage.setItem(`flow-review:${report.id}`, JSON.stringify(reading)); } catch { setNotice('Browser storage is unavailable. Export your notes before closing.'); } }, [report?.id, reading]);
  useLayoutEffect(() => {
    const position = pendingSourcePosition.current;
    if (!position) return;
    primaryScrollers().forEach((element, index) => {
      const previous = position === 'reset' ? undefined : position[index];
      element.scrollTop = previous?.top ?? 0;
      element.scrollLeft = previous?.left ?? 0;
    });
    pendingSourcePosition.current = null;
    mainRef.current?.focus({ preventScroll: true });
  }, [selection, revision, report?.id]);
  useEffect(() => { if (panel) panelRef.current?.querySelector<HTMLElement>('button, input, textarea, a[href]')?.focus({ preventScroll: true }); }, [panel]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (panel && event.key === 'Tab') {
        const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, a[href], summary') ?? [])].filter(element => element.getClientRects().length);
        const first = controls[0]; const last = controls.at(-1);
        if (first && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      }
      if (event.key === '/' && !editing) { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === 'Escape') { if (panel) closePanel(); else if (peek) closePeek(); else { setFilesOpen(false); if (document.activeElement === searchRef.current) { setSearch(''); searchRef.current?.blur(); } } }
      if (event.key.toLowerCase() === 'n' && !editing && !event.metaKey && !event.ctrlKey && !panel) { event.preventDefault(); nextUnreviewed(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  function activateReport(next: Report, isDemo = false) {
    pendingSourcePosition.current = 'reset';
    setReport(next); setDemo(isDemo); setReading(readState(next.id)); setSelection(initialSelection(next)); setExpanded(new Set(next.files.filter(file => file.unitIds.some(id => next.rootIds.includes(id))).map(file => file.id)));
    setPeek(null); setPeekHistory([]); setSelectionHistory([]); setSearch(''); setRevision('both'); setPanel(null); setConfirmReset(false); setNotice(''); setError('');
  }
  async function loadFile(candidate: File) {
    setError('');
    try {
      if (candidate.size > 30 * 1024 * 1024) throw new Error('This JSON file exceeds the 30 MB import limit. Generate a smaller report.');
      const next = validateReport(JSON.parse(await candidate.text()));
      activateReport(next); setNotice(`Opened ${next.title}. Your report stays in this browser.`);
    } catch (error) { setError(`Could not import report. ${error instanceof Error ? error.message : 'Invalid JSON.'}`); }
  }
  async function importFile(event: React.ChangeEvent<HTMLInputElement>) { const input = event.currentTarget; const candidate = input.files?.[0]; if (candidate) await loadFile(candidate); input.value = ''; }
  function exportNotes() {
    if (!report) return;
    const note = { reportId: report.id, title: report.title, base: report.repository.base, head: report.repository.head, reviewed: [...model.canonical].filter(key => reviewed.has(key)), notes: reading.notes };
    const url = URL.createObjectURL(new Blob([JSON.stringify(note, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'flow-review-reading-notes.json'; anchor.click(); URL.revokeObjectURL(url); setNotice('Reading notes exported.');
  }

  return <div className="review-desk" onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); const candidates = [...event.dataTransfer.files]; if (candidates.length !== 1) setError('Drop one report JSON file at a time.'); else void loadFile(candidates[0]); }}>
    <a className="skip-link" href="#reading-workspace">Skip to code</a>
    <input className="sr-only" ref={importRef} type="file" accept="application/json,.json" aria-label="Import report JSON" onChange={importFile} />
    <header className="desk-topbar"><button className="icon-button mobile-files" aria-label="Toggle files" aria-expanded={filesOpen} onClick={() => setFilesOpen(!filesOpen)}><List size={20} /></button><a className="brand" href="#">flowreview</a><span className="topbar-divider" /><h1>{report?.title ?? 'Open a review report'}</h1>{demo && <span className="demo-tag">Demo</span>}<div className="topbar-end">{report && <span className="overall-progress" aria-label="Review progress"><strong>{reviewedCount}</strong> / {total} reviewed<progress className="sr-only" value={reviewedCount} max={Math.max(total, 1)} /></span>}<button className="topbar-import" onClick={() => importRef.current?.click()}><UploadSimple size={16} />Open JSON</button><button className="icon-button" aria-label="Review menu" aria-expanded={panel === 'menu'} onClick={event => openPanel('menu', event.currentTarget)}><DotsThree size={22} weight="bold" /></button></div></header>
    {error && <div className="desk-message error" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}{notice && <div className="desk-message notice" role="status">{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {!report ? <main className="import-workspace" id="reading-workspace"><UploadSimple size={32} /><h2>Open your review report</h2><p>Analyze the repository locally, then open the generated JSON here.</p><div className="entry-actions"><button className="primary-button" onClick={() => importRef.current?.click()}>Choose report JSON</button>{demoReport && <button className="secondary-button" onClick={() => activateReport(demoReport, true)}>Try demo</button>}</div><span>or drop one JSON file anywhere</span><p className="privacy-note">Your source stays in this browser. This reader does not fetch a pull request or upload your report.</p><div className="entry-setup">{online && <a className="secondary-button" href="/downloads/flow-review-cli.tgz" download><UploadSimple size={15} />Download analyzer</a>}<button onClick={event => openPanel('generate', event.currentTarget)}>How to generate a report</button></div></main> : <div className="desk-body">
      {filesOpen && <button className="mobile-nav-backdrop" aria-label="Close files" onClick={() => setFilesOpen(false)} />}
      <aside className={`files-sidebar ${filesOpen ? 'mobile-open' : ''}`}><div className="navigator-heading"><span>Files</span><span>{report.files.length}</span></div><div className="search-box"><MagnifyingGlass size={15} /><input ref={searchRef} aria-label="Search changes" placeholder="Find file or function" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={12} /></button> : <kbd>/</kbd>}</div><nav aria-label="Change navigation"><DirectoryBranch directory={tree} root props={{ report, selected: selection, reviewed, model, search, expanded, setExpanded, select: next => select(next) }} /></nav><div className="navigation-footnote">{report.coverage.complete ? 'All changed files included.' : 'Inventory incomplete.'}<br />Reading order is a suggestion, not importance.</div></aside>
      <main className="desk-main" id="reading-workspace" ref={mainRef} tabIndex={-1}><div className="code-toolbar"><div className="source-breadcrumb">{selectionHistory.length > 0 && <button className="icon-button" aria-label="Back to previous source" onClick={() => { const previous = selectionHistory.at(-1)!; pendingSourcePosition.current = previous.scrolls; setSelectionHistory(history => history.slice(0, -1)); setRevision(previous.revision); setSelection(previous.selection); setPeek(previous.peek); setPeekHistory(previous.peekHistory); peekOriginId.current = previous.originId; setPanel(null); }}><ArrowLeft size={16} /></button>}{(unit?.path ?? file?.path ?? '').split('/').map((part, index) => <React.Fragment key={index}>{index > 0 && <CaretRight size={12} />}<span>{part}</span></React.Fragment>)}{unit?.kind !== 'file' && unit && <><CaretRight size={12} /><strong>{unit.name}</strong></>}</div><div className="toolbar-actions">{unit?.kind !== 'file' && unit && <><button className={`context-button ${typesIncomplete ? 'types-incomplete' : ''}`} aria-label="Contract & callers" aria-expanded={panel === 'contracts'} onClick={event => openPanel('contracts', event.currentTarget)}>{typesIncomplete && <WarningCircle size={15} weight="fill" />}<span>{typesIncomplete ? 'Types incomplete' : 'Contract'}</span><CaretDown size={13} /></button><button className="caller-toggle" aria-label={`Callers ${callerCount}`} onClick={event => openPanel('contracts', event.currentTarget)}>Callers <span>{callerCount}</span></button></>}<div className="revision-control" role="group" aria-label="Code revision">{(['base', 'both', 'head'] as Revision[]).map(side => <button key={side} className={revision === side ? 'selected' : ''} aria-pressed={revision === side} onClick={() => setRevision(side)}>{side === 'base' ? 'Before' : side === 'head' ? 'After' : 'Both'}</button>)}</div>{currentKeys.length > 0 ? <button className={`primary-button review-button ${currentReviewed ? 'is-reviewed' : ''}`} aria-label={`${currentReviewed ? file ? 'Mark file unread' : 'Mark unread' : file ? 'Mark file reviewed' : 'Mark reviewed'}: ${file?.path ?? unit?.name ?? ''}`} aria-pressed={currentReviewed} onClick={() => mark(currentKeys, !currentReviewed)}>{currentReviewed && <Check size={15} />}{currentReviewed ? 'Reviewed' : 'Mark reviewed'}</button> : <span className="context-only">Context only</span>}<button className="next-button" aria-label="Next unreviewed" disabled={!total || reviewedCount === total} onClick={nextUnreviewed}>Next<CaretRight size={17} /></button></div></div>
        <div className="code-workspace">{file ? <FileReader key={`${report.id}:${file.id}`} file={file} revision={revision} onPeek={openPeek} /> : unit ? <article className="unit-reader" aria-label={`${unit.name} source`}><SourceView rows={rows} revision={revision} links={links} onPeek={openPeek} activePeek={peek?.link.id} />{sourceFile && <button className="raw-file-link" onClick={() => select({ type: 'file', id: sourceFile.id })}>Raw file diff<ArrowSquareOut size={13} /></button>}</article> : <div className="empty-report"><h2>{report.coverage.complete ? 'No changes in this report' : 'Inventory incomplete'}</h2><p>{report.coverage.complete ? 'Open another report to begin a review.' : 'No changes were acquired. Inspect analysis details before treating this snapshot as complete.'}</p><button onClick={() => importRef.current?.click()}>Open JSON</button></div>}
          {peek && peekUnit && <aside className="declaration-peek" aria-label="Declaration peek"><header><div><CaretDown size={15} /><strong>{sideName(peek.link.side)}</strong><span>·</span><code>{peekUnit[peek.link.side]?.path ?? peekUnit.path}</code><CaretRight size={12} /><strong>{peekUnit.name}</strong><span className="peek-status">{peek.link.status === 'removed' ? 'Removed call' : 'Static target'} · call {sideName(peek.link.side)}:{peek.link.line}</span>{!peekUnit.changed && <span className="badge">Unchanged context</span>}</div><div className="peek-controls">{peekHistory.length > 0 && <button aria-label="Back in peek" onClick={() => { setPeek(peekHistory.at(-1)!); setPeekHistory(history => history.slice(0, -1)); }}><ArrowLeft size={15} />Back</button>}<button aria-label={`Open target ${peekUnit.name}`} onClick={() => select({ type: 'unit', id: peekUnit.id }, true)}>Open<ArrowSquareOut size={15} /></button><button className="icon-button" aria-label="Close peek" onClick={() => closePeek()}><X size={18} /></button></div></header><SourceView rows={peekRows} revision={peek.link.side} links={report.links.filter(link => link.from === peekUnit.id && link.side === peek.link.side)} onPeek={openPeek} activePeek={peek.link.id} compact /></aside>}
        </div>
      </main>
    </div>}
    <footer className="desk-footer"><div><GitBranch size={15} /><span>{report ? demo ? 'Demo snapshot' : 'Local snapshot' : 'Local analysis · browser reader'}</span>{report && <code>{shortHash(report.repository.base)} → {shortHash(report.repository.head)}</code>}{report && <button onClick={event => openPanel('analysis', event.currentTarget)} aria-label="Analysis details">Analysis details</button>}</div><div>{report && <span aria-label="Changed line progress">{reviewedEdits} / {edits.length} changed lines reviewed</span>}<span className="keyboard-hints"><kbd>n</kbd> Next <kbd>esc</kbd> Close</span></div></footer>
    {panel && <div className="context-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closePanel(); }}><section ref={panelRef} className={`context-panel ${panel === 'menu' ? 'menu-panel' : ''}`} role="dialog" aria-modal="true" aria-label={panel === 'contracts' ? 'Contract & callers' : panel === 'analysis' ? 'Analysis evidence' : panel === 'notes' ? 'Reading notes' : panel === 'generate' ? 'Generate a report' : 'Review menu'}><button className="icon-button panel-close" aria-label="Close panel" onClick={closePanel}><X size={19} /></button>{panel === 'contracts' && unit && report ? <ContractPanel unit={unit} report={report} revision={revision} select={next => select(next, true)} onPeek={openPeek} /> : panel === 'analysis' && report ? <><h2>Analysis details</h2><p className="panel-note">{report.coverage.note}</p><dl className="analysis-facts"><dt>Snapshot</dt><dd><code>{report.repository.base} → {report.repository.head}</code></dd><dt>Merge base</dt><dd><code>{report.repository.mergeBase}</code></dd><dt>Versions</dt><dd>Flow Review {report.analysis.toolVersion} · TypeScript {report.analysis.typescriptVersion}</dd><dt>Strict null checks</dt><dd>Analysis before {report.analysis.baseStrictNullChecks ? 'on' : 'off'}, after {report.analysis.headStrictNullChecks ? 'on' : 'off'}</dd><dt>Inventory</dt><dd>{report.files.length} files · {report.coverage.mappedHunks}/{report.coverage.totalHunks} hunks accounted for · {report.coverage.complete ? 'Inventory complete' : 'Inventory incomplete'}</dd><dt>Unresolved calls</dt><dd>{report.coverage.unresolvedCalls} repository call sites, including unchanged code and both snapshots</dd></dl><p className="panel-note">{report.analysis.scope}</p><p className="panel-note">Resolved calls are static source declarations, not guaranteed runtime execution. No automated approval verdicts.</p>{report.repository.dirty && <p className="badge caution">Local changes excluded</p>}{report.diagnostics.length > 0 && <details><summary>{report.diagnostics.length} analysis diagnostics</summary>{report.diagnostics.map((diagnostic, index) => <p className="diagnostic" key={index}><span className="badge">{sideName(diagnostic.side)}</span> <code>{diagnostic.path}</code> {diagnostic.message}</p>)}</details>}</> : panel === 'notes' ? <><h2>Private reading notes</h2><p className="panel-note">Saved for this snapshot in your browser. Nothing is sent to a server.</p><label className="sr-only" htmlFor="reading-notes">Reading notes</label><textarea id="reading-notes" rows={10} value={reading.notes} placeholder="Questions, changed behavior, and follow-ups…" onChange={event => setReading(previous => ({ ...previous, notes: event.target.value }))} /><button className="secondary-button" onClick={exportNotes} disabled={!report}>Export reading notes</button></> : panel === 'generate' ? <><h2>Generate a review report</h2><p className="panel-note">Analysis runs on your computer. This online reader opens the generated JSON; it does not fetch or upload source.</p><ol className="generate-steps"><li>Install Node.js 22 or newer and Git 2.52 or newer. For GitHub pull requests, install the GitHub CLI and sign in with <code>gh auth login</code>.</li><li>{online ? <a href="/downloads/flow-review-cli.tgz" download>Download the analyzer</a> : 'Download the analyzer from the hosted Flow Review reader.'} and install it:<pre><code>npm install --global ./flow-review-cli.tgz</code></pre></li><li>Generate a report for a GitHub pull request:<pre><code>flow-review pr --url &lt;github-pr-url&gt; --out review.html</code></pre></li><li>Open <code>review.html</code> offline, or choose <code>review.json</code> in this reader.</li></ol><p className="panel-note">A private repository needs your existing GitHub access. Keep reports private when the source is private.</p></> : <><h2>Review menu</h2><button className="menu-item" onClick={() => { closePanel(); importRef.current?.click(); }}><UploadSimple size={17} />Open report JSON</button><button className="menu-item" onClick={() => setPanel('generate')}>How to generate a report</button><button className="menu-item" disabled={!report} onClick={() => setPanel('notes')}>Reading notes</button><button className="menu-item" disabled={!report} onClick={() => setPanel('analysis')}>Analysis details</button><button className="menu-item" disabled={!report} onClick={() => setConfirmReset(!confirmReset)}>Reset reading state</button>{confirmReset && <div className="reset-confirm"><p>Clear review marks and notes for this snapshot?</p><button className="secondary-button" onClick={() => { setReading(emptyReading()); closePanel(); setNotice('Reading state reset for this snapshot.'); }}>Clear marks and notes</button><button onClick={() => setConfirmReset(false)}>Cancel</button></div>}<p className="panel-note">Opening a file or a peek never marks it reviewed. Whole-file review includes text and metadata.</p></>}</section></div>}
    {dragging && <div className="drop-overlay"><UploadSimple size={34} /><strong>Drop report JSON to open</strong><span>One file · source stays in this browser</span></div>}
  </div>;
}

const root = document.getElementById('root');
if (root) {
  const script = document.getElementById('report-data');
  const demoScript = document.getElementById('demo-data');
  let report: Report | null = null; let demoReport: Report | null = null; let error = '';
  if (script) {
    try { report = validateReport(JSON.parse(script.textContent ?? '')); }
    catch (caught) { error = `This report could not be opened. ${caught instanceof Error ? caught.message : 'Invalid report data.'} Open a current report JSON to recover.`; }
  }
  if (demoScript) {
    try { demoReport = validateReport(JSON.parse(demoScript.textContent ?? '')); }
    catch { error = error || 'The demo could not be opened. Choose a current report JSON to begin.'; }
  }
  createRoot(root).render(<App initialReport={report} demoReport={demoReport} online={root.getAttribute('data-online') === 'true'} initialError={error} initialDemo={script?.getAttribute('data-demo') === 'true'} />);
}

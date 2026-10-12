import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CallLink, ChangedFile, DiffLine, Report, Side, Unit } from '../model.js';
import { validateReport } from '../validate.js';
import { codeDiff } from './diff.js';
import './styles.css';

type Revision = 'both' | Side;
type Selection = { type: 'unit' | 'file'; id: string };
type Reading = { reviewed: string[]; notes: string };
const emptyReading = (): Reading => ({ reviewed: [], notes: '' });
const sideName = (side: Side) => side === 'base' ? 'before' : 'after';
const shortHash = (hash: string) => hash.slice(0, 8);
function initialSelection(report: Report): Selection {
  if (!report.files.length) return { type: 'file', id: '' };
  const start = report.rootIds[0] ?? report.units.find(u => u.changed)?.id;
  return start ? { type: 'unit', id: start } : { type: 'file', id: report.files[0]?.id ?? '' };
}

function hasMetadataChange(file: ChangedFile): boolean {
  const noNewline = (text?: string) => !!text && !text.endsWith('\n');
  return file.status === 'renamed' || file.status === 'type-changed' ||
    file.oldMode !== file.newMode || noNewline(file.base) !== noNewline(file.head);
}

function readState(id: string): Reading {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`flow-review:${id}`) ?? 'null');
    if (value && typeof value === 'object' && 'reviewed' in value && Array.isArray(value.reviewed) && value.reviewed.every(x => typeof x === 'string')) {
      return { reviewed: value.reviewed, notes: 'notes' in value && typeof value.notes === 'string' ? value.notes : '' };
    }
  } catch { /* State is optional; a report must open with storage disabled. */ }
  return emptyReading();
}

function Icon({ name }: { name: 'arrow' | 'check' | 'file' | 'branch' | 'search' | 'close' }) {
  const paths = {
    arrow: <path d="m6 4 5 4-5 4" />,
    check: <path d="m3 8 3 3 7-7" />,
    file: <><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v4h3M6 9h4M6 11h4" /></>,
    branch: <><circle cx="4" cy="3" r="1.5" /><circle cx="12" cy="3" r="1.5" /><circle cx="4" cy="13" r="1.5" /><path d="M4 5v6M12 5c0 4-8 2-8 6" /></>,
    search: <><circle cx="7" cy="7" r="4" /><path d="m10 10 4 4" /></>,
    close: <path d="m4 4 8 8M12 4l-8 8" />,
  };
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function VisibleCharacters({ text }: { text: string }) {
  const parts = text.split(/([\r\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff])/g);
  return <>{parts.map((part, index) => {
    if (index % 2 === 0) return part;
    const label = part === '\r' ? 'CR' : `U+${part.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    return <span key={index} className="source-control" title={`Visible source control: ${label}`}>[{label}]</span>;
  })}</>;
}

function CodeText({ text }: { text: string }) {
  // Styling is presentation only. Source is always React text, never HTML.
  const parts = text.split(/(\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:async|await|return|if|else|throw|new|const|let|function|export|import|from|class|interface|type|try|catch|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g);
  return <>{parts.map((part, i) => <span key={i} className={part.startsWith('//') ? 'syntax-comment' : /^['"]/.test(part) ? 'syntax-string' : /^(async|await|return|if|else|throw|new|const|let|function|export|import|from|class|interface|type|try|catch|true|false|null|undefined)$/.test(part) ? 'syntax-keyword' : /^\d/.test(part) ? 'syntax-number' : undefined}><VisibleCharacters text={part} /></span>)}</>;
}

interface Shared {
  report: Report; revision: Revision; reviewed: Set<string>;
  mark: (keys: string[], checked: boolean) => void; select: (selection: Selection) => void;
  unitKeys: (unit: Unit) => string[]; fileKeys: (file: ChangedFile) => string[];
}

function ReviewButton({ keys, name, shared, file = false }: { keys: string[]; name: string; shared: Shared; file?: boolean }) {
  if (!keys.length) return <span className="unchanged-label">Context only</span>;
  const checked = keys.every(k => shared.reviewed.has(k));
  return <button className={`review-button ${checked ? 'is-reviewed' : ''}`} aria-pressed={checked} aria-label={`${checked ? (file ? 'Mark file unread' : 'Mark unread') : (file ? 'Mark file reviewed' : 'Mark reviewed')}: ${name}`} onClick={() => shared.mark(keys, !checked)}><Icon name="check" />{checked ? 'Reviewed' : 'Mark reviewed'}</button>;
}

function CallRow({ link, shared, ancestors, depth }: { link: CallLink; shared: Shared; ancestors: string[]; depth: number }) {
  const [open, setOpen] = useState(false);
  const target = shared.report.units.find(u => u.id === link.to);
  const cycle = target && ancestors.includes(target.id);
  const boundary = cycle || depth >= 6;
  const label = `${open ? 'Collapse' : 'Expand'} ${link.expression} from ${sideName(link.side)} line ${link.line}`;
  return <div className={`call-block ${link.status === 'removed' ? 'removed-call' : ''}`} data-testid="call-link" data-side={link.side} data-line={link.line}>
    <div className="call-row">
      <span className={`side-dot ${link.side}`} aria-hidden="true" />
      {target ? <button className="call-trigger" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}><span className={open ? 'chevron opened' : 'chevron'}><Icon name="arrow" /></span><code>{link.expression}</code></button> : <span className="unresolved-expression"><code>{link.expression}</code></span>}
      <span className="call-meta">{sideName(link.side)}:{link.line}</span>
      <span className={`badge ${link.status}`}>{link.status === 'removed' ? 'Removed call' : link.status === 'added' ? 'Added call' : 'Call'}</span>
      <span className={`evidence ${link.evidence}`}>{link.evidence === 'resolved' ? 'Static target' : 'Unresolved'}</span>
    </div>
    {!target && <p className="boundary-note">{link.reason || 'No declaration could be resolved. Inspect this call in the source.'}</p>}
    {open && target && <div className="inline-callee">
      {boundary ? <div className="boundary-box"><strong>{cycle ? 'Recursive path' : 'Depth limit reached'}</strong><p>{cycle ? `${target.name} is already on this reading path.` : 'Open the target as a new starting point to keep following it.'}</p><button onClick={() => shared.select({ type: 'unit', id: target.id })}>Start at {target.name}<Icon name="arrow" /></button></div> : <FunctionCard unit={target} shared={shared} ancestors={[...ancestors, target.id]} depth={depth + 1} />}
    </div>}
  </div>;
}

function CodeLines({ rows, links = [], shared, ancestors = [], depth = 0 }: { rows: DiffLine[]; links?: CallLink[]; shared: Shared; ancestors?: string[]; depth?: number }) {
  const visible = rows.filter(row => shared.revision === 'both' || (shared.revision === 'base' ? row.oldLine !== undefined : row.newLine !== undefined));
  const selectedLinks = links.filter(link => shared.revision === 'both' || shared.revision === link.side);
  const unresolved = selectedLinks.filter(link => link.evidence === 'unresolved');
  const compact = unresolved.length > 5;
  const inlineLinks = compact ? selectedLinks.filter(link => link.evidence === 'resolved') : selectedLinks;
  const displayed = new Set<string>();
  return <div className={`code-lines revision-${shared.revision}`}>
    <div className="line-column-labels"><span>Before</span><span>After</span><span>Source</span></div>
    {visible.map((row, i) => {
      const calls = inlineLinks.filter(link => (link.side === 'base' ? row.oldLine : row.newLine) === link.line);
      calls.forEach(link => displayed.add(link.id));
      return <React.Fragment key={`${row.oldLine ?? 'x'}-${row.newLine ?? 'x'}-${i}`}>
        <div className={`code-line ${row.kind}`} data-testid="code-line" data-old-line={row.oldLine} data-new-line={row.newLine}>
          <span className="line-number old-number" aria-label={row.oldLine ? `Before line ${row.oldLine}` : undefined}>{row.oldLine ?? ''}</span>
          <span className="line-number new-number" aria-label={row.newLine ? `After line ${row.newLine}` : undefined}>{row.newLine ?? ''}</span>
          <span className="diff-sign" aria-hidden="true">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</span>
          <code><CodeText text={row.text || ' '} /></code>
        </div>
        {calls.map(link => <CallRow key={link.id} link={link} shared={shared} ancestors={ancestors} depth={depth} />)}
      </React.Fragment>;
    })}
    {!visible.length && <p className="empty-code">No source on this revision.</p>}
    {inlineLinks.filter(l => !displayed.has(l.id)).map(link => <CallRow key={link.id} link={link} shared={shared} ancestors={ancestors} depth={depth} />)}
    {compact && <details className="unresolved-list"><summary>{unresolved.length} unresolved call sites in this declaration<span>Source shown above · targets unavailable</span></summary>{unresolved.map(link => <CallRow key={link.id} link={link} shared={shared} ancestors={ancestors} depth={depth} />)}</details>}
  </div>;
}

function ContractPanel({ unit, shared }: { unit: Unit; shared: Shared }) {
  const incoming = shared.report.links.filter(link => link.evidence === 'resolved' && link.to === unit.id);
  const editedSites = useMemo(() => {
    const files = new Map(shared.report.files.map(file => [file.id, file]));
    return new Set(shared.report.edits.map(edit => {
      const file = files.get(edit.fileId)!;
      return `${edit.side}\0${edit.side === 'base' ? file.oldPath ?? file.path : file.path}\0${edit.line}`;
    }));
  }, [shared.report]);
  const groups: { label: string; links: CallLink[] }[] = [
    { label: 'Changed callers', links: [] }, { label: 'Untouched callers', links: [] }, { label: 'Removed callers', links: [] },
  ];
  incoming.forEach(link => {
    const caller = shared.report.units.find(u => u.id === link.from);
    const index = link.status === 'removed' || !caller?.head ? 2 : caller.changed ? 0 : 1;
    groups[index].links.push(link);
  });
  return <details className="contract-panel"><summary><strong>Contract &amp; callers</strong><span>{incoming.length} resolved call sites</span></summary><div className="contract-content">
    <div className="contract-revisions">{(['base', 'head'] as Side[]).filter(side => shared.revision === 'both' || shared.revision === side).map(side => {
      const contract = unit.contract?.[side];
      return <section className="contract-revision" key={side}><span className="eyebrow">{sideName(side)} contract</span>{contract ? <><code>{contract.signature}</code><div className="return-contract"><span>Returns</span><code>{contract.returnType}</code><span className="badge">{contract.inferred ? 'Inferred return type' : 'Declared return type'}</span>{contract.unknown && <span className="badge caution">Contract unknown</span>}</div>{contract.unknown && <p className="contract-unknown-note">Omitted or unresolved types limit this contract. No reliable equivalence claim can be made.</p>}</> : <p>{unit[side] ? 'No contract extracted for this declaration.' : `Absent ${sideName(side)}.`}</p>}</section>;
    })}</div>
    <p className="caller-scope">Resolved calls within acquired snapshots; dynamic/external uses not included.</p>
    {incoming.length ? groups.filter(group => group.links.length).map(group => <details key={group.label} className="caller-group" open={group.links.length <= 8}><summary>{group.label}<span>{group.links.length} call sites</span></summary><div className="caller-list">{group.links.map(link => {
      const caller = shared.report.units.find(u => u.id === link.from)!;
      const siteEdited = editedSites.has(`${link.side}\0${caller[link.side]?.path ?? caller.path}\0${link.line}`);
      return <button key={link.id} aria-label={`Open caller ${caller.name} from ${sideName(link.side)} line ${link.line}`} onClick={() => shared.select({ type: 'unit', id: caller.id })}><span><strong>{caller.name}</strong><code>{caller[link.side]?.path ?? caller.path}:{link.line}</code><span className="caller-edit-evidence">{siteEdited ? 'Call-site line edited' : caller.changed ? 'Caller changed elsewhere' : 'Call-site line untouched'}</span></span><span className="badge">{sideName(link.side)}</span>{link.status === 'removed' && <span className="badge removed">Removed call</span>}<Icon name="arrow" /></button>;
    })}</div></details>) : <p className="no-callers">No incoming calls were resolved in these snapshots. This does not establish that the declaration has no users.</p>}
  </div></details>;
}

function FunctionCard({ unit, shared, ancestors, depth = 0 }: { unit: Unit; shared: Shared; ancestors: string[]; depth?: number }) {
  const rows = useMemo(() => codeDiff(unit.base, unit.head), [unit]);
  const links = shared.report.links.filter(l => l.from === unit.id);
  const file = shared.report.files.find(f => f.path === unit.path || f.oldPath === unit.path);
  return <article className={`function-card ${depth ? 'nested-card' : ''}`} aria-label={`${unit.name} source`}>
    {depth > 0 && <nav className="inline-breadcrumb" aria-label="Call path">{ancestors.map((id, index) => { const ancestor = shared.report.units.find(u => u.id === id); return <React.Fragment key={`${id}-${index}`}>{index > 0 && <Icon name="arrow" />}<button aria-label={`Start at ${ancestor?.name ?? id}`} onClick={() => shared.select({ type: 'unit', id })}>{ancestor?.name ?? id}</button></React.Fragment>; })}</nav>}
    <header className="function-header">
      <div className="function-identity"><span className="eyebrow">{depth ? 'Called declaration' : 'Reading'} · {unit.kind}{unit.exported ? ' · exported' : ''}</span><h2>{unit.name}<span className={`badge ${unit.changed ? 'modified' : ''}`}>{unit.changed ? !unit.base ? 'Added' : !unit.head ? 'Deleted' : 'Changed' : 'Unchanged context'}</span></h2><div className="source-path">{unit.path}<span>{unit.base ? `before ${unit.base.startLine}–${unit.base.endLine}` : 'absent before'} · {unit.head ? `after ${unit.head.startLine}–${unit.head.endLine}` : 'absent after'}</span></div></div>
      <ReviewButton keys={shared.unitKeys(unit)} name={unit.name} shared={shared} />
    </header>
    {unit.kind !== 'file' && <ContractPanel unit={unit} shared={shared} />}
    {unit.markers.length > 0 && <div className="markers">{unit.markers.map((marker, i) => <span key={i}>{marker}</span>)}</div>}
    <CodeLines rows={rows} links={links} shared={shared} ancestors={ancestors} depth={depth} />
    <footer className="function-footer"><span>{links.length ? `${links.filter(l => shared.revision === 'both' || l.side === shared.revision).length} call sites on selected revisions` : 'No outgoing call sites recorded'}</span>{file && <button onClick={() => shared.select({ type: 'file', id: file.id })}>Raw file diff<Icon name="arrow" /></button>}</footer>
  </article>;
}

function FileCard({ file, shared }: { file: ChangedFile; shared: Shared }) {
  const [fullSide, setFullSide] = useState<Side | null>(null);
  const units = file.unitIds.map(id => shared.report.units.find(u => u.id === id)).filter((u): u is Unit => !!u);
  const text = fullSide === 'base' ? file.base : file.head;
  return <article className="file-card" aria-label={`${file.path} raw diff`}>
    <header className="file-header"><div><span className="eyebrow">Complete file inventory · {file.status}</span><h2>{file.path}</h2>{file.oldPath && file.oldPath !== file.path && <p className="rename-path">{file.oldPath} → {file.path}</p>}<div className="file-summary"><span className="addition">+{file.additions}</span><span className="deletion">−{file.deletions}</span><span>{file.hunks.length} {file.hunks.length === 1 ? 'hunk' : 'hunks'}</span>{file.oldMode !== file.newMode && <span className="file-mode-change">Mode {file.oldMode ?? 'absent'} → {file.newMode ?? 'absent'}</span>}</div>{!file.binary && <div className="newline-metadata" aria-label="Final newline metadata">{file.base && !file.base.endsWith('\n') && <span className="badge caution">No final newline before</span>}{file.head && !file.head.endsWith('\n') && <span className="badge caution">No final newline after</span>}</div>}</div><ReviewButton keys={shared.fileKeys(file)} name={file.path} shared={shared} file /></header>
    {units.some(u => u.kind !== 'file') && <div className="file-symbols"><span>Declarations in this file</span>{units.filter(u => u.kind !== 'file').map(u => <button key={u.id} onClick={() => shared.select({ type: 'unit', id: u.id })}>{u.name}<Icon name="arrow" /></button>)}</div>}
    <div className="snapshot-tools"><button className={!fullSide ? 'selected' : ''} onClick={() => setFullSide(null)}>Raw hunks</button><button disabled={file.base === undefined} className={fullSide === 'base' ? 'selected' : ''} onClick={() => setFullSide('base')}>Full before</button><button disabled={file.head === undefined} className={fullSide === 'head' ? 'selected' : ''} onClick={() => setFullSide('head')}>Full after</button></div>
    {file.binary ? <div className="file-boundary"><Icon name="file" /><h3>Binary file</h3><p>The file is included in the inventory. Binary content cannot be displayed as a text diff.</p></div> : fullSide && text !== undefined ? <CodeLines rows={codeDiff(fullSide === 'base' ? { path: file.oldPath ?? file.path, startLine: 1, endLine: Math.max(1, text.split('\n').length), text } : undefined, fullSide === 'head' ? { path: file.path, startLine: 1, endLine: Math.max(1, text.split('\n').length), text } : undefined)} shared={{ ...shared, revision: fullSide }} /> : file.hunks.length ? file.hunks.map(h => <section key={h.id} className="raw-hunk" data-testid="raw-hunk" data-hunk-id={h.id}><header><code>@@ −{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@</code><span>Original Git hunk</span></header><CodeLines rows={h.lines} shared={shared} /></section>) : <div className="file-boundary"><Icon name="file" /><h3>No text hunks</h3><p>This change may affect the filename, permissions, type, or an empty file. It still needs an explicit review.</p></div>}
  </article>;
}

function App({ initialReport }: { initialReport: Report }) {
  const [report, setReport] = useState(initialReport);
  const [reading, setReading] = useState(() => readState(initialReport.id));
  const [selection, setSelection] = useState<Selection>(() => initialSelection(initialReport));
  const [revision, setRevision] = useState<Revision>('both');
  const [search, setSearch] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [showNotes, setShowNotes] = useState(false); const [showEvidence, setShowEvidence] = useState(false); const [confirmReset, setConfirmReset] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null); const contentRef = useRef<HTMLElement>(null);
  const reviewed = useMemo(() => new Set(reading.reviewed), [reading.reviewed]);
  const changed = report.units.filter(u => u.changed);
  const editOwners = new Set(report.edits.map(edit => edit.unitId));
  const unitKeys = (u: Unit) => editOwners.has(u.id) || (u.changed && u.kind === 'file' && report.files.some(f => f.unitIds.includes(u.id) && !f.hunks.length && !hasMetadataChange(f))) ? [`unit:${u.id}`] : [];
  const fileKeys = (f: ChangedFile) => {
    const keys = [...new Set(report.edits.filter(edit => edit.fileId === f.id).map(edit => `unit:${edit.unitId}`))];
    f.unitIds.forEach(id => { const u = report.units.find(u => u.id === id); if (u && !f.hunks.length) keys.push(...unitKeys(u)); });
    if (hasMetadataChange(f)) keys.push(`metadata:${f.id}`);
    if (!keys.length) keys.push(`file:${f.id}`);
    return [...new Set(keys)];
  };
  const canonical = new Set(report.files.flatMap(fileKeys));
  changed.forEach(u => unitKeys(u).forEach(key => canonical.add(key)));
  const reviewedCount = [...canonical].filter(key => reviewed.has(key)).length;
  const total = canonical.size;
  const uniqueEdits = [...new Map(report.edits.map(edit => [edit.id, edit])).values()];
  const reviewedEdits = uniqueEdits.filter(edit => reviewed.has(`unit:${edit.unitId}`)).length;
  const filteredUnits = changed.filter(u => u.kind !== 'file').filter(u => `${u.name} ${u.path}`.toLowerCase().includes(search.toLowerCase()));
  const filteredFiles = report.files.filter(f => `${f.path} ${f.oldPath ?? ''} ${f.status}`.toLowerCase().includes(search.toLowerCase()));
  const roots = report.rootIds.map(id => report.units.find(u => u.id === id)).filter((u): u is Unit => !!u).filter(u => `${u.name} ${u.path}`.toLowerCase().includes(search.toLowerCase()));
  const unit = selection.type === 'unit' ? report.units.find(u => u.id === selection.id) : undefined;
  const file = selection.type === 'file' ? report.files.find(f => f.id === selection.id) : unit?.kind === 'file' ? report.files.find(f => f.unitIds.includes(unit.id)) : undefined;
  const select = (next: Selection) => { setSelection(next); setNotice(''); requestAnimationFrame(() => contentRef.current?.focus({ preventScroll: true })); };
  const nextUnreviewed = () => {
    const queue: { selection: Selection; keys: string[] }[] = [];
    report.files.forEach(currentFile => {
      fileKeys(currentFile).forEach(key => {
        const owner = key.startsWith('unit:') ? report.units.find(u => `unit:${u.id}` === key) : undefined;
        const target: Selection = owner && owner.kind !== 'file' ? { type: 'unit', id: owner.id } : { type: 'file', id: currentFile.id };
        const existing = queue.find(item => item.selection.type === target.type && item.selection.id === target.id);
        if (existing) existing.keys.push(key); else queue.push({ selection: target, keys: [key] });
      });
    });
    const index = queue.findIndex(item => item.selection.type === selection.type && item.selection.id === selection.id);
    const next = [...queue.slice(index + 1), ...queue.slice(0, index + 1)].find(item => item.keys.some(key => !reviewed.has(key)));
    if (next) { setSearch(''); select(next.selection); }
  };
  const mark = (keys: string[], checked: boolean) => setReading(prev => ({ ...prev, reviewed: checked ? [...new Set([...prev.reviewed, ...keys])] : prev.reviewed.filter(k => !keys.includes(k)) }));
  const shared: Shared = { report, revision, reviewed, mark, select, unitKeys, fileKeys };

  useEffect(() => {
    try { localStorage.setItem(`flow-review:${report.id}`, JSON.stringify(reading)); }
    catch { setNotice('Reading state could not be saved in this browser. Export your notes before closing.'); }
  }, [report.id, reading]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === 'Escape') { setConfirmReset(false); if (document.activeElement === searchRef.current) { setSearch(''); searchRef.current?.blur(); } }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget; const candidate = input.files?.[0]; if (!candidate) return;
    setError('');
    try {
      if (candidate.size > 30 * 1024 * 1024) throw new Error('This JSON file exceeds the 30 MB import limit. Generate a smaller report.');
      const next = validateReport(JSON.parse(await candidate.text()));
      // Set state and report together so reading state cannot leak between snapshots.
      setReport(next); setReading(readState(next.id)); setSelection(initialSelection(next));
      setSearch(''); setRevision('both'); setShowEvidence(false); setConfirmReset(false); setNotice(`Imported ${next.title}. All data stays in this browser.`);
    } catch (e) { setError(`Could not import report. ${e instanceof Error ? e.message : 'Invalid JSON.'}`); }
    input.value = '';
  }

  function exportNotes() {
    const note = { reportId: report.id, title: report.title, base: report.repository.base, head: report.repository.head, reviewed: [...canonical].filter(k => reviewed.has(k)), notes: reading.notes };
    const blob = new Blob([JSON.stringify(note, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'flow-review-reading-notes.json'; anchor.click(); URL.revokeObjectURL(url);
    setNotice('Reading notes exported.');
  }

  return <>
    <a className="skip-link" href="#reading-workspace">Skip to code</a>
    <header className="app-header"><a className="brand" href="#"><span className="brand-mark"><Icon name="branch" /></span><span>flow<span className="brand-light">review</span></span></a><div className="repository-title"><span className="eyebrow">{report.repository.name}</span><h1>{report.title}</h1></div><div className="header-tools"><label className="import-button">Import JSON<input type="file" accept="application/json,.json" aria-label="Import report JSON" onChange={importFile} /></label><button onClick={() => setShowNotes(!showNotes)} aria-expanded={showNotes}>Reading notes</button></div></header>
    <div className="report-strip"><span className="snapshot-label">Snapshot</span><code title={report.repository.base}>{shortHash(report.repository.base)}</code><span aria-hidden="true">→</span><code title={report.repository.head}>{shortHash(report.repository.head)}</code><span className="strip-divider" /><span>{report.files.length} changed files</span><span>{report.coverage.totalHunks} original hunks</span><button className="evidence-button" aria-expanded={showEvidence} onClick={() => setShowEvidence(!showEvidence)}>{report.coverage.unresolvedCalls} unresolved repository call sites<Icon name="arrow" /></button>{report.repository.dirty && <span className="badge caution">Local changes excluded</span>}<span className="offline-label">Offline reader</span></div>
    {error && <div className="message error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" /></button></div>}
    {notice && <div className="message notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><Icon name="close" /></button></div>}
    {showEvidence && <section className="evidence-panel" aria-label="Analysis evidence"><div><span className="eyebrow">What this report knows</span><h2>Static navigation, complete change inventory</h2><p>{report.coverage.note}</p><p>The repository call-site count includes unchanged code in both snapshots. Resolved calls point to declarations found by static analysis. Runtime dispatch, external behavior, and omitted callbacks can differ. The full file ledger remains the review boundary.</p></div><div className="analysis-provenance"><span>Flow Review {report.analysis.toolVersion} · TypeScript {report.analysis.typescriptVersion}</span><span>Merge base <code>{report.repository.mergeBase}</code></span><span>Analysis strict null checks: before {report.analysis.baseStrictNullChecks ? 'on' : 'off'}, after {report.analysis.headStrictNullChecks ? 'on' : 'off'}</span><span>{report.analysis.scope}</span></div><div className="evidence-counts"><span><strong>{report.coverage.analyzedFiles}</strong> analyzed files</span><span><strong>{report.coverage.mappedHunks}/{report.coverage.totalHunks}</strong> hunks accounted for</span><span className={report.coverage.complete ? '' : 'deletion'}>{report.coverage.complete ? 'Inventory complete' : 'Inventory incomplete'}</span></div>{report.diagnostics.length > 0 && <details><summary>{report.diagnostics.length} analysis diagnostics</summary><ul>{report.diagnostics.map((d, i) => <li key={i}><span className="badge">{sideName(d.side)}</span> {d.path && <code>{d.path}</code>} {d.message}</li>)}</ul></details>}</section>}
    {showNotes && <section className="notes-panel" aria-label="Reading notes"><div><label htmlFor="reading-notes">Private reading notes</label><p>Saved with this exact snapshot in your browser.</p></div><textarea id="reading-notes" value={reading.notes} onChange={e => setReading(prev => ({ ...prev, notes: e.target.value }))} placeholder="Questions, behavior changes, and follow-ups…" rows={3} /><button onClick={exportNotes}>Export reading notes</button></section>}
    <div className="workspace">
      <aside className="flow-sidebar"><div className="search-box"><Icon name="search" /><input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a symbol or file" aria-label="Search changes" /><kbd>/</kbd>{search && <button aria-label="Clear search" onClick={() => setSearch('')}><Icon name="close" /></button>}</div><nav aria-label="Flow navigation"><div className="nav-section-label"><span>Suggested starts</span><span>{roots.length}</span></div><p className="sidebar-help">Choose an entry point, then follow calls. This order is a reading suggestion, not importance.</p>{roots.map(u => <button key={u.id} className={`flow-item root-item ${selection.type === 'unit' && selection.id === u.id ? 'active' : ''}`} aria-label={`Start at ${u.name}`} aria-current={selection.type === 'unit' && selection.id === u.id ? 'true' : undefined} onClick={() => select({ type: 'unit', id: u.id })}><span className="flow-icon"><Icon name="branch" /></span><span><strong>{u.name}</strong><small>{u.path}</small></span><Icon name="arrow" /></button>)}{!roots.length && <p className="sidebar-empty">No suggested entry points{search ? ' match your search' : ' in this snapshot'}.</p>}<div className="nav-section-label all-symbols"><span>Changed declarations</span><span>{filteredUnits.length}</span></div>{filteredUnits.map(u => <button key={u.id} className={`flow-item ${selection.type === 'unit' && selection.id === u.id ? 'active' : ''}`} aria-label={`Open ${u.name}`} aria-current={selection.type === 'unit' && selection.id === u.id ? 'true' : undefined} onClick={() => select({ type: 'unit', id: u.id })}><span className={`read-dot ${unitKeys(u).length && unitKeys(u).every(k => reviewed.has(k)) ? 'done' : ''}`} aria-label={!unitKeys(u).length ? 'Context only' : unitKeys(u).every(k => reviewed.has(k)) ? 'Reviewed' : 'Unread'} /><span><strong>{u.name}</strong><small>{u.path}</small></span><span className="kind-tag">{u.kind === 'file' ? 'file' : u.kind === 'method' ? 'm' : 'ƒ'}</span></button>)}{!filteredUnits.length && <p className="sidebar-empty">No changed declarations{search ? ' match your search' : ''}.</p>}</nav><div className="sidebar-footnote">Opening code does not mark it reviewed.<br />Reading paths never replace the file inventory.</div></aside>
      <main id="reading-workspace" className="reading-workspace" ref={contentRef} tabIndex={-1}><div className="reader-toolbar"><div className="breadcrumb"><span>{report.repository.name}</span><Icon name="arrow" /><strong>{unit?.name ?? file?.path ?? 'Changes'}</strong></div><div className="reader-actions"><button className="next-unreviewed" disabled={!total || reviewedCount === total} onClick={nextUnreviewed}>Next unreviewed<Icon name="arrow" /></button><div className="revision-control" role="group" aria-label="Code revision">{(['base', 'both', 'head'] as Revision[]).map(side => <button key={side} aria-pressed={revision === side} className={revision === side ? 'selected' : ''} onClick={() => setRevision(side)}>{side === 'base' ? 'Before' : side === 'head' ? 'After' : 'Both'}</button>)}</div></div></div><div className="reading-intro"><span className="eyebrow">{file ? 'Inventory view' : 'Follow the change'}</span><p>{file ? 'Original hunks are the authoritative record. Review every edit, including changes outside the flow.' : 'Read the source. Expand a call to keep its declaration and the caller in view.'}</p></div>{file ? <FileCard key={`${report.id}:${file.id}`} file={file} shared={shared} /> : unit ? <FunctionCard key={`${report.id}:${unit.id}`} unit={unit} shared={shared} ancestors={[unit.id]} /> : <div className="empty-workspace"><h2>No changes in this report</h2><p>Import another report to start reading.</p></div>}<div className="reader-bottom"><span className="side-dot base" /> Before <span className="side-dot head" /> After <span>Static links show source declarations, not guaranteed runtime execution.</span></div></main>
      <aside className="ledger-sidebar"><header className="ledger-header"><span className="eyebrow">Complete change ledger</span><h2>Every file. Every edit.</h2><div className="review-progress"><span><strong>{reviewedCount}</strong> / {total} review units</span><span>{total ? Math.round(reviewedCount / total * 100) : 0}%</span></div><progress aria-label="Review progress" value={reviewedCount} max={Math.max(total, 1)} /><div className="line-review-progress" aria-label="Changed line progress"><strong>{reviewedEdits}</strong> / {uniqueEdits.length} changed lines reviewed</div><p>Mark a declaration or whole file when reviewed. Changed lines count once. File metadata needs explicit file review.</p></header><nav aria-label="Change ledger">{filteredFiles.map(f => { const keys = fileKeys(f); const done = keys.every(k => reviewed.has(k)); const partial = keys.some(k => reviewed.has(k)); return <div className={`ledger-file ${selection.type === 'file' && selection.id === f.id ? 'active' : ''}`} key={f.id}><button className="ledger-file-open" aria-label={`Open file ${f.path}`} aria-current={selection.type === 'file' && selection.id === f.id ? 'true' : undefined} onClick={() => select({ type: 'file', id: f.id })}><Icon name="file" /><span><strong>{f.path}</strong><small><span className="file-status">{f.status}</span><span className="addition">+{f.additions}</span><span className="deletion">−{f.deletions}</span></small></span></button><div className="ledger-file-bottom"><span>{f.binary ? 'Binary · raw inventory' : `${f.hunks.length} hunks · ${keys.length} review ${keys.length === 1 ? 'unit' : 'units'}`}{partial && !done ? ' · partly read' : ''}</span><button className={`ledger-review ${done ? 'is-reviewed' : ''}`} aria-label={`${done ? 'Mark file unread' : 'Mark file reviewed'}: ${f.path}`} aria-pressed={done} onClick={() => mark(keys, !done)}><Icon name="check" /><span>{done ? 'Reviewed' : 'Review'}</span></button></div></div>; })}{!filteredFiles.length && <p className="sidebar-empty">No files match your search.</p>}</nav><div className="ledger-footer"><button className="reset-button" onClick={() => setConfirmReset(!confirmReset)} aria-expanded={confirmReset}>Reset reading state</button>{confirmReset && <div className="reset-confirm"><p>Clear review marks and notes for this snapshot?</p><button onClick={() => { setReading(emptyReading()); setConfirmReset(false); setNotice('Reading state reset for this snapshot.'); }}>Clear marks and notes</button><button onClick={() => setConfirmReset(false)}>Cancel</button></div>}<small>Snapshot generated {new Date(report.generatedAt).toLocaleString()}</small></div></aside>
    </div>
    <footer className="app-footer"><span>Flow Review · A human code reader</span><span>Data stays local · No automated approval verdicts</span></footer>
  </>;
}

const root = document.getElementById('root');
if (root) {
  try {
    const script = document.getElementById('report-data');
    if (!script) throw new Error('The report-data payload is missing. Regenerate this report.');
    const report = validateReport(JSON.parse(script.textContent ?? ''));
    createRoot(root).render(<App initialReport={report} />);
  } catch (error) {
    createRoot(root).render(<div className="startup-error" role="alert"><span className="eyebrow">Flow Review</span><h1>This report could not be opened</h1><p>{error instanceof Error ? error.message : 'Invalid report data.'}</p><p>Generate a new report with the current Flow Review CLI.</p></div>);
  }
}

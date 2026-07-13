import { encode } from 'gpt-tokenizer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { walk, loadIgnore, loadGitignore, DEFAULT_MAX_BYTES } from './core.js';

// ── language support ───────────────────────────────────────────────────────────

const JS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);

const FENCE = {
  '.js': 'js', '.jsx': 'jsx', '.ts': 'ts', '.tsx': 'tsx',
  '.mjs': 'js', '.cjs': 'js', '.mts': 'ts', '.cts': 'ts',
  '.py': 'python', '.go': 'go', '.java': 'java', '.rb': 'ruby',
  '.rs': 'rust', '.php': 'php', '.cs': 'csharp', '.kt': 'kotlin',
  '.swift': 'swift', '.c': 'c', '.cpp': 'cpp', '.h': 'c',
};

function fenceFor(ext) { return FENCE[ext] || ''; }
function countTokens(text) { return encode(text).length; }

// ── JS/TS API-skeleton extractor ────────────────────────────────────────────────
// Lossy by design: keeps the public API surface (doc comments, exports, signatures,
// type/interface/enum bodies, class member signatures) and drops implementation.

const TOP_DECL = /^(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+)?(function|class|interface|type|enum|namespace|const|let|var)\b/;
const REEXPORT = /^export\s*(\*|\{)/;
const KEEP_KIND = /\b(class|interface|enum|namespace)\b/;

function headUpToBrace(line) {
  const i = line.indexOf('{');
  return (i < 0 ? line : line.slice(0, i)).replace(/\s+$/, '');
}

function memberSig(t) {
  if (!/^[\w$#@*]/.test(t)) return null;          // not an identifier-ish start
  if (/^(private|protected|#)/.test(t)) return null; // skip non-public members
  const bi = t.indexOf('{');
  const si = t.indexOf(';');
  if (bi >= 0 && (si < 0 || bi < si)) return headUpToBrace(t) + ' { … }'; // method body
  if (si >= 0) return t.slice(0, si + 1);          // property / abstract / overload
  if (/[(:=]/.test(t)) return t;                   // signature continued on next line
  return null;
}

function braceDelta(line) {
  const code = line.replace(/\/\/.*$/, '');
  let d = 0;
  for (const c of code) { if (c === '{') d++; else if (c === '}') d--; }
  return d;
}

function extractJsTs(text) {
  const lines = text.split('\n');
  const out = [];
  let pending = [];          // doc/comment lines awaiting a declaration
  let depth = 0;
  let keepOpen = false;      // inside a class/interface/enum/namespace body
  let inBlockComment = false;
  let blockBuf = [];

  const flush = () => { if (pending.length) out.push(...pending); pending = []; };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();

    if (inBlockComment) {
      blockBuf.push(raw);
      if (t.includes('*/')) { inBlockComment = false; if (blockBuf[0].trim().startsWith('/**')) pending = blockBuf; blockBuf = []; }
      continue;
    }
    if (t.startsWith('/*')) {
      if (t.includes('*/')) { if (t.startsWith('/**')) pending = [raw]; }
      else { inBlockComment = true; blockBuf = [raw]; }
      continue;
    }
    if (t.startsWith('//')) { pending.push(raw); continue; }
    if (t === '') { pending = []; continue; }

    const before = depth;

    if (before === 0 && (TOP_DECL.test(t) || REEXPORT.test(t) || t.startsWith('module.exports'))) {
      flush();
      if (!raw.includes('{') || braceDelta(raw) === 0) {
        out.push(raw.replace(/\s+$/, ''));         // one-liner / re-export / self-contained block
      } else if (KEEP_KIND.test(t)) {
        out.push(headUpToBrace(raw) + ' {');        // keep structure; members emitted below
      } else {
        out.push(headUpToBrace(raw) + ' { … }');    // function/object: drop body
      }
      pending = [];
    } else if (before === 1 && keepOpen && t === '}') {
      out.push('}');
    } else if (before === 1 && keepOpen) {
      const sig = memberSig(t);
      if (sig) { flush(); out.push('  ' + sig); } else { pending = []; }
    } else {
      if (!out.length && pending.length) out.push(...pending); // keep leading file banner
      pending = [];
    }

    depth += braceDelta(raw);
    if (depth < 0) depth = 0;
    if (before === 0 && depth === 1) keepOpen = KEEP_KIND.test(t) && raw.includes('{');
    else if (depth === 0) keepOpen = false;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── generic fallback (non-JS/TS) ────────────────────────────────────────────────

const GENERIC_DECL = /^(export\s+|public\s+|pub\s+|private\s+|protected\s+)?(default\s+)?(abstract\s+|static\s+|async\s+|final\s+)?(def|func|fn|function|class|interface|type|struct|impl|enum|trait|module|package|public|protected|construct|sub|val|var|const|let|namespace|template)\b/;

function extractGeneric(text) {
  const lines = text.split('\n');
  const out = [];
  let banner = true;
  for (const raw of lines) {
    const t = raw.trim();
    // keep the leading comment banner
    if (banner && (t.startsWith('#') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('"""') || t.startsWith("'''"))) {
      out.push(raw); continue;
    }
    if (t === '') { continue; }
    banner = false;
    if (GENERIC_DECL.test(t)) out.push(headUpToBrace(raw).replace(/\s+$/, '') + (raw.includes('{') ? ' { … }' : ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Python skeleton extractor ────────────────────────────────────────────────
// Indentation-based (Python has no braces): keeps decorators, class/def
// signatures, and any docstring immediately inside a def; drops everything
// else in a function body by skipping lines more indented than the def.
// Class bodies are NOT skipped, so nested method defs are found in turn.

function pyIndent(raw) { return raw.match(/^[ \t]*/)[0].length; }

// Emits a (possibly multi-line) triple-quoted string starting at lines[i].
// Returns the index of its last line.
function consumePyDocstring(lines, out, i) {
  const first = lines[i].trim();
  const quote = first.startsWith('"""') ? '"""' : "'''";
  out.push(lines[i]);
  if (first.length > 3 && first.slice(3).includes(quote)) return i; // closes on the same line
  let k = i + 1;
  while (k < lines.length && !lines[k].includes(quote)) { out.push(lines[k]); k++; }
  if (k < lines.length) out.push(lines[k]);
  return k;
}

function extractPython(text) {
  const lines = text.split('\n');
  const out = [];
  let pending = [];
  let skipIndent = null; // while set, drop lines more indented than this (inside a dropped def body)

  const flush = () => { if (pending.length) out.push(...pending); pending = []; };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    const indent = pyIndent(raw);

    if (skipIndent !== null) {
      if (t !== '' && indent <= skipIndent) skipIndent = null; // body ended — reprocess this line below
      else continue;
    }

    if (!out.length && !pending.length && (t.startsWith('"""') || t.startsWith("'''"))) {
      i = consumePyDocstring(lines, out, i); // leading module docstring
      continue;
    }
    if (t === '') { pending = []; continue; }
    if (t.startsWith('#') || t.startsWith('@')) { pending.push(raw); continue; }

    const isDef   = /^(async\s+)?def\s+\w/.test(t);
    const isClass = /^class\s+\w/.test(t);

    if (isDef || isClass) {
      flush();
      out.push(raw.replace(/\s+$/, ''));
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const next = lines[j] ? lines[j].trim() : '';
      if (next.startsWith('"""') || next.startsWith("'''")) i = consumePyDocstring(lines, out, j);
      if (isDef) skipIndent = indent; // class bodies stay open for nested defs
    }
    // any other statement (plain assignment, control flow, ...) is dropped
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Go skeleton extractor ────────────────────────────────────────────────────
// Brace-based like JS/TS: keeps doc comments, func/type/struct/interface
// signatures; struct/interface bodies are kept (field/method lists are the
// API), func bodies are dropped.

const GO_TOP_DECL = /^(func\b|type\s+\w+\s+(struct|interface)\b)/;
const GO_KEEP_KIND = /\btype\s+\w+\s+(struct|interface)\b/;

function extractGo(text) {
  const lines = text.split('\n');
  const out = [];
  let pending = [];
  let depth = 0;
  let keepOpen = false;

  const flush = () => { if (pending.length) out.push(...pending); pending = []; };

  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith('//')) { pending.push(raw); continue; }
    if (t === '') { pending = []; continue; }

    const before = depth;

    if (before === 0 && GO_TOP_DECL.test(t)) {
      flush();
      if (!raw.includes('{') || braceDelta(raw) === 0) {
        out.push(raw.replace(/\s+$/, ''));
      } else if (GO_KEEP_KIND.test(t)) {
        out.push(headUpToBrace(raw) + ' {');
      } else {
        out.push(headUpToBrace(raw) + ' { … }');
      }
      pending = [];
    } else if (before === 1 && keepOpen && t === '}') {
      out.push('}');
    } else if (before === 1 && keepOpen) {
      out.push('  ' + t); // struct field / interface method line — Go bodies at this depth are just declarations
    } else {
      pending = [];
    }

    depth += braceDelta(raw);
    if (depth < 0) depth = 0;
    if (before === 0 && depth === 1) keepOpen = GO_KEEP_KIND.test(t) && raw.includes('{');
    else if (depth === 0) keepOpen = false;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Java/Kotlin skeleton extractor ───────────────────────────────────────────
// Brace-based: keeps doc comments/annotations and class/interface/enum/method
// signatures (public API only — skips private members like extractJsTs does);
// class/interface bodies stay open so member signatures are found, method
// bodies are dropped.

const JAVA_KT_TOP_DECL = /^(@\w|(public|private|protected|internal|abstract|final|static|open|sealed|data|)\s*)*(class|interface|enum|object|fun|record)\b/;
const JAVA_KT_KEEP_KIND = /\b(class|interface|enum|object)\b/;

function javaKtMemberSig(t) {
  if (!/^[\w$@]/.test(t)) return null;
  if (/^private\b/.test(t)) return null; // skip non-public members
  const bi = t.indexOf('{');
  const si = t.indexOf(';');
  if (bi >= 0 && (si < 0 || bi < si)) return headUpToBrace(t) + ' { … }';
  if (si >= 0) return t.slice(0, si + 1);
  return null;
}

function extractJavaKotlin(text) {
  const lines = text.split('\n');
  const out = [];
  let pending = [];
  let depth = 0;
  let keepOpen = false;
  let inBlockComment = false;
  let blockBuf = [];

  const flush = () => { if (pending.length) out.push(...pending); pending = []; };

  for (const raw of lines) {
    const t = raw.trim();

    if (inBlockComment) {
      blockBuf.push(raw);
      if (t.includes('*/')) { inBlockComment = false; if (blockBuf[0].trim().startsWith('/**')) pending = blockBuf; blockBuf = []; }
      continue;
    }
    if (t.startsWith('/*')) {
      if (t.includes('*/')) { if (t.startsWith('/**')) pending = [raw]; }
      else { inBlockComment = true; blockBuf = [raw]; }
      continue;
    }
    if (t.startsWith('//') || t.startsWith('@')) { pending.push(raw); continue; }
    if (t === '') { pending = []; continue; }

    const before = depth;

    if (before === 0 && JAVA_KT_TOP_DECL.test(t)) {
      flush();
      if (!raw.includes('{') || braceDelta(raw) === 0) {
        out.push(raw.replace(/\s+$/, ''));
      } else if (JAVA_KT_KEEP_KIND.test(t)) {
        out.push(headUpToBrace(raw) + ' {');
      } else {
        out.push(headUpToBrace(raw) + ' { … }');
      }
      pending = [];
    } else if (before === 1 && keepOpen && t === '}') {
      out.push('}');
    } else if (before === 1 && keepOpen) {
      const sig = javaKtMemberSig(t);
      if (sig) { flush(); out.push('  ' + sig); } else { pending = []; }
    } else {
      pending = [];
    }

    depth += braceDelta(raw);
    if (depth < 0) depth = 0;
    if (before === 0 && depth === 1) keepOpen = JAVA_KT_KEEP_KIND.test(t) && raw.includes('{');
    else if (depth === 0) keepOpen = false;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const PY_EXT = new Set(['.py', '.pyi']);
const GO_EXT = new Set(['.go']);
const JAVA_KT_EXT = new Set(['.java', '.kt', '.kts']);

export function extractSkeleton(text, ext) {
  if (JS_EXT.has(ext)) return extractJsTs(text);
  if (PY_EXT.has(ext)) return extractPython(text);
  if (GO_EXT.has(ext)) return extractGo(text);
  if (JAVA_KT_EXT.has(ext)) return extractJavaKotlin(text);
  return extractGeneric(text);
}

// ── import graph (fan-in) ────────────────────────────────────────────────────────

const SPEC_RES = [
  /import\s+[^'"`]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /export\s+[^'"`]*?from\s*['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const RES_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

function resolveSpec(fromRel, spec, known) {
  if (!spec.startsWith('.')) return null;          // external / bare import
  const baseDir = path.posix.dirname(fromRel.replace(/\\/g, '/'));
  const joined = path.posix.normalize(path.posix.join(baseDir, spec));
  for (const e of RES_EXT) { if (known.has(joined + e)) return joined + e; }
  for (const e of RES_EXT.slice(1)) { if (known.has(joined + '/index' + e)) return joined + '/index' + e; }
  return null;
}

// Returns Map<relPath, fanInCount> — how many files import each file.
export function buildImportGraph(infos) {
  const known = new Set(infos.map(f => f.rel.replace(/\\/g, '/')));
  const fanIn = new Map();
  for (const f of infos) {
    if (!JS_EXT.has(f.ext)) continue;
    const seen = new Set();
    for (const re of SPEC_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(f.text))) {
        const target = resolveSpec(f.rel, m[1], known);
        if (target && target !== f.rel.replace(/\\/g, '/') && !seen.has(target)) {
          seen.add(target);
          fanIn.set(target, (fanIn.get(target) || 0) + 1);
        }
      }
    }
  }
  return fanIn;
}

// ── distill ──────────────────────────────────────────────────────────────────────

// Build one summary candidate from a file's content + its import fan-in.
// Shared by distillRepo and single-file refresh (regenerate-on-save).
export function makeCandidate(file, text, ext, fanIn = 0) {
  const tokens = countTokens(text);
  const skeleton = extractSkeleton(text, ext);
  const summaryTokens = countTokens(skeleton);
  const savedTokens = tokens - summaryTokens;
  return {
    file, ext, fanIn,
    tokens, summaryTokens, savedTokens,
    savedPct: tokens ? Math.round(savedTokens / tokens * 100) : 0,
    leverage: fanIn * tokens,
    skeleton,
    hash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 12),
  };
}

export function distillRepo(dir, {
  minFanIn = 2, minTokens = 150, top = Infinity,
  ignorePatterns = [], respectGitignore = false, maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const ignore = [
    ...loadIgnore(dir),
    ...(respectGitignore ? loadGitignore(dir) : []),
    ...ignorePatterns,
  ];
  const files = walk(dir, ignore, [], undefined, maxBytes);

  const infos = files.map(abs => {
    const rel = path.relative(dir, abs).replace(/\\/g, '/');
    const text = fs.readFileSync(abs, 'utf8');
    return { abs, rel, ext: path.extname(abs).toLowerCase(), text, tokens: countTokens(text) };
  });

  const fanIn = buildImportGraph(infos);

  const candidates = [];
  for (const f of infos) {
    const fi = fanIn.get(f.rel) || 0;
    if (fi < minFanIn || f.tokens < minTokens) continue;
    const c = makeCandidate(f.rel, f.text, f.ext, fi);
    if (!c.skeleton || c.savedTokens <= 0) continue; // summary empty or not smaller — skip
    candidates.push(c);
  }

  candidates.sort((a, b) => b.leverage - a.leverage);
  const top_ = candidates.slice(0, top);

  const totalOriginal = top_.reduce((a, c) => a + c.tokens, 0);
  const totalSummary = top_.reduce((a, c) => a + c.summaryTokens, 0);

  return {
    root: dir,
    scannedAt: new Date().toISOString(),
    candidates: top_,
    totals: {
      files: top_.length,
      originalTokens: totalOriginal,
      summaryTokens: totalSummary,
      savedTokens: totalOriginal - totalSummary,
      savedPct: totalOriginal ? Math.round((totalOriginal - totalSummary) / totalOriginal * 100) : 0,
    },
  };
}

// ── summary writer ────────────────────────────────────────────────────────────────

const SUMMARY_DIR = path.join('.ai', 'summaries');

// Renders the .md body for one summary candidate (single source of truth for
// the format, so single-file refresh stays byte-compatible with full writes).
export function renderSummary(c) {
  return [
    '# ' + c.file,
    '',
    '> Auto-generated context summary · imported by ' + c.fanIn + ' file(s) · ' +
      '~' + c.savedTokens.toLocaleString() + ' tokens saved (' + c.savedPct + '%)',
    '> source-hash: `' + c.hash + '` · generated: ' + new Date().toISOString().slice(0, 10),
    '> ⚠ May be stale if the source changed — regenerate with `ai-readability distill --write`.',
    '',
    'Open the full file at `' + c.file + '` when you need implementation detail.',
    '',
    '```' + fenceFor(c.ext),
    c.skeleton,
    '```',
    '',
  ].join('\n');
}

// Writes one .md per candidate under <dir>/.ai/summaries/ plus a CONTEXT_MAP.md index.
// Returns { written, dir, indexPath }.
export function writeSummaries(dir, candidates) {
  const baseDir = path.join(dir, SUMMARY_DIR);
  fs.mkdirSync(baseDir, { recursive: true });

  for (const c of candidates) {
    const dest = path.join(baseDir, c.file + '.md');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, renderSummary(c));
  }

  const index = [
    '# Context Map',
    '',
    'Compact API summaries of the most-referenced files in this repo. Point your AI',
    'tool here for cheap context; open the linked source file for full detail.',
    '',
    'Generated: ' + new Date().toISOString().slice(0, 10) +
      ' · ' + candidates.length + ' file(s)',
    '',
    '| File | Imported by | Original | Summary | Saved |',
    '|---|---:|---:|---:|---:|',
    ...candidates.map(c =>
      '| [`' + c.file + '`](' + encodeURI(c.file.replace(/\\/g, '/') + '.md') + ') | ' +
      c.fanIn + ' | ' + c.tokens.toLocaleString() + ' | ' +
      c.summaryTokens.toLocaleString() + ' | ' + c.savedPct + '% |'),
    '',
  ].join('\n');
  const indexPath = path.join(baseDir, 'CONTEXT_MAP.md');
  fs.writeFileSync(indexPath, index);

  return { written: candidates.length, dir: baseDir, indexPath };
}

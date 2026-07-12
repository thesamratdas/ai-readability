import { encode } from 'gpt-tokenizer';
import fs from 'node:fs';
import path from 'node:path';

export function scoreText(text) {
  const tokens = encode(text).length;
  const lines  = text.split('\n');

  let noiseChars = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const longNoSpace = t.length > 200 && !t.includes(' ');
    const fewSpaces   = t.length > 80 && (t.split(' ').length - 1) / t.length < 0.02;
    if (longNoSpace || fewSpaces) noiseChars += line.length;
  }
  const signal = 1 - (text.length ? noiseChars / text.length : 0);

  const blank   = lines.filter(l => !l.trim()).length / Math.max(lines.length, 1);
  const bounds  = (text.match(/^(#{1,6}\s|(function|class|def|public|private|func|fn|sub)\b)/gm) || []).length;
  const avgLen  = text.length / Math.max(lines.length, 1);
  let structure = 0.5 + Math.min(blank * 2, 0.25) + Math.min(bounds / 50, 0.25);
  if (avgLen > 300) structure -= 0.3;
  structure = Math.max(0, Math.min(1, structure));

  const ne = lines.filter(l => l.trim());
  const redundancy = ne.length ? 1 - new Set(ne).size / ne.length : 0;

  const value = Math.round((0.60 * signal + 0.25 * structure + 0.15 * (1 - redundancy)) * 100);
  return {
    grade: gradeOf(value), value, tokens,
    signal: +signal.toFixed(2),
    structure: +structure.toFixed(2),
    redundancy: +redundancy.toFixed(2),
  };
}

export function gradeOf(v) {
  return v >= 90 ? 'A' : v >= 75 ? 'B' : v >= 60 ? 'C' : v >= 45 ? 'D' : 'F';
}

export const GEN_DIRS = new Set([
  'dist', 'build', 'out', 'coverage', '.next', '.nuxt', 'target', 'bin', 'obj',
  'test-results', 'playwright-report', '__pycache__', '.pytest_cache', 'vendor',
]);

const GEN_FILE = [
  /^package-lock\.json$/, /^yarn\.lock$/, /^pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/, /\.bundle\.js$/, /\.map$/, /\.lock$/, /\.generated\./,
];

export function isGenerated(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts.slice(0, -1).some(s => GEN_DIRS.has(s))) return true;
  return GEN_FILE.some(re => re.test(parts[parts.length - 1]));
}

function readPatternFile(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(l => l.trim())
    // Skip comments, blanks, and negations (`!` re-include is unsupported —
    // ignoring it errs toward scanning more, never less).
    .filter(l => l && !l.startsWith('#') && !l.startsWith('!'));
}

export function loadIgnore(root) {
  return readPatternFile(path.join(root, '.aiignore'));
}

// Root-level .gitignore patterns. Opt-in: most generated junk is already
// gitignored, so honoring it models what a .gitignore-aware AI tool ingests.
export function loadGitignore(root) {
  return readPatternFile(path.join(root, '.gitignore'));
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          // **/ → zero-or-more directory prefix (matches root-level files too)
          re += '(?:.*/)?';
          i++;
        } else {
          re += '.*';
        }
      } else re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return re;
}

// Compiled-regex cache keyed by the raw pattern string — avoids re-compiling
// the same RegExp thousands of times across a 500-file scan.
const _globReCache = new Map();
function cachedGlobRe(p, dirOnly) {
  const key = p + (dirOnly ? '/' : '');
  if (_globReCache.has(key)) return _globReCache.get(key);
  const re = new RegExp('^' + globToRegex(p) + (dirOnly ? '(?:/.*)?$' : '$'));
  _globReCache.set(key, re);
  return re;
}

// Minimal .gitignore-style matcher: handles dir (`build/`), root-anchored
// (`/dist`), basename (`*.log`, `package-lock.json`) and nested-path patterns.
function matchIgnore(rel, patterns) {
  const norm = rel.replace(/\\/g, '/');
  const base = norm.slice(norm.lastIndexOf('/') + 1);
  const segs = norm.split('/');
  for (let pat of patterns) {
    let p = pat.replace(/\\/g, '/');
    const dirOnly = p.endsWith('/');
    if (dirOnly) p = p.slice(0, -1);
    const anchored = p.startsWith('/');
    if (anchored) p = p.slice(1);
    if (!p) continue;

    const isGlob = p.includes('*') || p.includes('?');
    const hasSlash = p.includes('/');

    if (!isGlob) {
      if (dirOnly) {
        if (norm === p || norm.startsWith(p + '/')) return true;
        if (!anchored && segs.slice(0, -1).includes(p)) return true;
      } else {
        if (norm === p) return true;
        if (!anchored && !hasSlash && base === p) return true;
        if (!anchored && hasSlash && norm.endsWith('/' + p)) return true;
      }
      continue;
    }

    const re = cachedGlobRe(p, dirOnly);
    if (anchored || hasSlash) {
      if (re.test(norm)) return true;
    } else {
      if (re.test(base)) return true;
      if (dirOnly && segs.some(s => re.test(s))) return true;
    }
  }
  return false;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.claude', '.cursor', '.ai']);

const TEXT = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
  '.json', '.jsonc', '.json5',
  '.md', '.mdx', '.txt', '.rst', '.adoc',
  '.py', '.pyi', '.java', '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.yml', '.yaml', '.toml', '.ini', '.env', '.cfg', '.conf', '.properties',
  '.go', '.rs', '.rb', '.php', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.cs', '.swift', '.kt', '.kts', '.m', '.mm',
  '.scala', '.clj', '.cljs', '.cljc', '.ex', '.exs', '.erl', '.hs', '.ml', '.fs', '.fsx',
  '.dart', '.lua', '.pl', '.pm', '.r', '.jl', '.groovy', '.gradle',
  '.sql', '.graphql', '.gql', '.prisma', '.proto',
  '.vue', '.svelte', '.astro',
  '.xml', '.csv', '.tsv', '.tf', '.tfvars', '.hcl', '.dockerfile', '.makefile',
]);

// Extension-less files that are still source/config worth scoring.
const TEXT_NAMES = new Set([
  'Dockerfile', 'Makefile', 'Rakefile', 'Gemfile', 'Procfile', 'Brewfile',
  'Jenkinsfile', 'Vagrantfile', 'LICENSE', 'CODEOWNERS', '.gitignore',
  '.gitattributes', '.dockerignore', '.editorconfig', '.npmrc', '.nvmrc',
  '.babelrc', '.prettierrc', '.eslintrc',
]);

// Files larger than this are skipped to avoid OOM/UI freezes on data dumps.
// Real-world source files are virtually always well under 2 MB.
export const DEFAULT_MAX_BYTES = 2_000_000;

export function isTextFile(name) {
  return TEXT.has(path.extname(name).toLowerCase()) || TEXT_NAMES.has(name);
}

export function walk(dir, ignore = [], out = [], _root, maxBytes = DEFAULT_MAX_BYTES, skipped = []) {
  const root = _root ?? dir;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p   = path.join(dir, e.name);
    const rel = path.relative(root, p);
    if (matchIgnore(rel, ignore)) continue;
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(p, ignore, out, root, maxBytes, skipped);
    } else if (isTextFile(e.name)) {
      try {
        if (fs.statSync(p).size <= maxBytes) out.push(p);
        else skipped.push(rel);
      } catch { /* unreadable / vanished file — skip */ }
    }
  }
  return out;
}

// ── fix helpers (exported so CLI, extension, and tests share one implementation) ─

// Classifies a file as needing exclusion.
// A/B-grade files (value >= 75) are intentionally good — never flag as token-hogs.
export function reasonFor(r, total) {
  if (isGenerated(r.file))                      return 'generated';
  if (r.value < 45)                             return 'low-signal (F)';
  if (r.value < 60)                             return 'low-signal (D)';
  if (r.tokens / total > 0.10 && r.value < 75) return 'token-hog (' + Math.round(r.tokens / total * 100) + '%)';
  return null;
}

// Returns deduplicated .aiignore patterns derived from the flagged subset only.
export function computePatterns(files, total) {
  const flagged = files.filter(f => reasonFor(f, total) !== null);
  return [...new Set(flagged.map(r => {
    const dir = r.file.replace(/\\/g, '/').split('/').find(s => GEN_DIRS.has(s));
    return dir ? dir + '/' : r.file.replace(/\\/g, '/');
  }))];
}

// Appends new patterns to dest, skipping any already present.
// Never adds blank lines between existing and new entries.
// Returns the count of newly written patterns (0 = already up to date).
export function writeAiignore(dest, patterns) {
  const raw = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  const existing = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const toAdd = patterns.filter(p => !existing.includes(p));
  if (!toAdd.length) return 0;
  const sep = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(dest, sep + toAdd.join('\n') + '\n');
  return toAdd.length;
}

// No AI tool reads .aiignore natively, so this is where --fix delivers value
// beyond .aiignore itself. A tool is "detected" if its config dir exists, or
// its ignore file already exists (the user is already maintaining one) — we
// never create a tool's ignore file out of nowhere for a tool that isn't in use.
export const SUPPORTED_TOOLS = ['cursor', 'codeium'];
const TOOL_IGNORE = {
  cursor:  { configDir: '.cursor',  file: '.cursorignore' },
  codeium: { configDir: '.codeium', file: '.codeiumignore' },
};

// Writes patterns into a detected tool's ignore file. Returns 0 without
// writing anything if the tool isn't detected in `root`. Reuses
// writeAiignore's append-dedup logic, so already-present patterns are
// never duplicated.
export function writeToolIgnore(root, tool, patterns) {
  const cfg = TOOL_IGNORE[tool];
  if (!cfg) return 0;
  const dest = path.join(root, cfg.file);
  const detected = fs.existsSync(path.join(root, cfg.configDir)) || fs.existsSync(dest);
  if (!detected) return 0;
  return writeAiignore(dest, patterns);
}

export function scoreRepo(dir, { ignorePatterns = [], respectGitignore = false, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const ignore = [
    ...loadIgnore(dir),
    ...(respectGitignore ? loadGitignore(dir) : []),
    ...ignorePatterns,
  ];
  const skipped = [];
  const files  = walk(dir, ignore, [], undefined, maxBytes, skipped);
  if (!files.length) {
    return { root: dir, scannedAt: new Date().toISOString(), total: 0, score: 0, grade: 'N/A', files: [], skippedFiles: skipped.length };
  }
  const rows = files.map(f => {
    const rel = path.relative(dir, f);
    const s   = scoreText(fs.readFileSync(f, 'utf8'));
    return { file: rel, ...s, waste: s.tokens * (1 - s.value / 100) };
  });
  const total = rows.reduce((a, r) => a + r.tokens, 0);
  const score = total
    ? Math.round(rows.reduce((a, r) => a + r.value * r.tokens, 0) / total)
    : 0;
  return {
    root: dir,
    scannedAt: new Date().toISOString(),
    total,
    score,
    grade: gradeOf(score),
    files: rows.sort((a, b) => b.waste - a.waste),
    skippedFiles: skipped.length,
  };
}

// Files between cooperative yields. encode() is synchronous and CPU-bound, so
// fs.promises alone would not stop it from blocking the event loop — this
// forces a setImmediate tick every N files so a host (e.g. the VS Code
// extension) stays responsive and signal.aborted can actually be observed.
const ASYNC_YIELD_EVERY = 10;

// Async twin of scoreRepo with the exact same return shape. Directory walking
// (fs.readdirSync/statSync in `walk`) stays synchronous — it's fast even on
// large trees; the actual freeze is repeated encode() calls, which this
// yields around. Not a drop-in replacement for scoreRepo: callers that need
// progress/cancellation (host UIs) use this; the CLI keeps using sync
// scoreRepo since it always runs to completion anyway.
export async function scoreRepoAsync(dir, { ignorePatterns = [], respectGitignore = false, maxBytes = DEFAULT_MAX_BYTES, onProgress, signal } = {}) {
  const ignore = [
    ...loadIgnore(dir),
    ...(respectGitignore ? loadGitignore(dir) : []),
    ...ignorePatterns,
  ];
  const skipped = [];
  const files  = walk(dir, ignore, [], undefined, maxBytes, skipped);
  if (!files.length) {
    return { root: dir, scannedAt: new Date().toISOString(), total: 0, score: 0, grade: 'N/A', files: [], skippedFiles: skipped.length };
  }
  const rows = [];
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) break;
    const f   = files[i];
    const rel = path.relative(dir, f);
    const text = await fs.promises.readFile(f, 'utf8');
    const s    = scoreText(text);
    rows.push({ file: rel, ...s, waste: s.tokens * (1 - s.value / 100) });
    onProgress?.(i + 1, files.length);
    if ((i + 1) % ASYNC_YIELD_EVERY === 0) await new Promise(setImmediate);
  }
  const total = rows.reduce((a, r) => a + r.tokens, 0);
  const score = total
    ? Math.round(rows.reduce((a, r) => a + r.value * r.tokens, 0) / total)
    : 0;
  return {
    root: dir,
    scannedAt: new Date().toISOString(),
    total,
    score,
    grade: rows.length ? gradeOf(score) : 'N/A',
    files: rows.sort((a, b) => b.waste - a.waste),
    skippedFiles: skipped.length,
  };
}

function ignoreConfigSignature(dir) {
  const aiM = fs.existsSync(path.join(dir, '.aiignore'))  ? fs.statSync(path.join(dir, '.aiignore')).mtimeMs  : 0;
  const giM = fs.existsSync(path.join(dir, '.gitignore')) ? fs.statSync(path.join(dir, '.gitignore')).mtimeMs : 0;
  return `${dir}|${aiM}|${giM}`;
}

// Repeated-scan cache keyed by absolute file path, for hosts that rescan the
// same directory over and over (e.g. --watch, which otherwise retokenizes
// every file on every save). A file is only rescored when its mtime changes.
// The whole cache self-invalidates whenever .aiignore's or .gitignore's own
// mtime changes, since editing either can change which files are in scope —
// simpler and safer than reasoning about which entries are still valid.
// invalidate() clears it manually; stale entries for files walk() no longer
// sees are pruned each scan so long watch sessions don't leak memory.
export function createScanCache() {
  const cache = new Map(); // absPath -> { mtimeMs, row }
  let ignoreSig = null;
  return {
    scan(dir, ignore = [], maxBytes = DEFAULT_MAX_BYTES) {
      const sig = ignoreConfigSignature(dir);
      if (sig !== ignoreSig) {
        cache.clear();
        ignoreSig = sig;
      }
      const files = walk(dir, ignore, [], undefined, maxBytes);
      const seen  = new Set(files);
      const rows  = files.map(f => {
        const mtimeMs = fs.statSync(f).mtimeMs;
        const cached  = cache.get(f);
        if (cached && cached.mtimeMs === mtimeMs) return cached.row;
        const rel = path.relative(dir, f);
        const s   = scoreText(fs.readFileSync(f, 'utf8'));
        const row = { file: rel, ...s, waste: s.tokens * (1 - s.value / 100) };
        cache.set(f, { mtimeMs, row });
        return row;
      });
      for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
      return rows;
    },
    invalidate() { cache.clear(); ignoreSig = null; },
    size() { return cache.size; },
  };
}

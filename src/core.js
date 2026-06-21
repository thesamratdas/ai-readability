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

export function loadIgnore(root) {
  const p = path.join(root, '.aiignore');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function matchIgnore(rel, patterns) {
  const norm = rel.replace(/\\/g, '/');
  for (const pat of patterns) {
    if (pat.endsWith('/')) {
      const d = pat.slice(0, -1);
      if (norm === d || norm.startsWith(d + '/')) return true;
    } else if (norm === pat || path.basename(norm) === pat) {
      return true;
    }
  }
  return false;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.claude', '.cursor']);

const TEXT = new Set([
  '.js', '.ts', '.jsx', '.tsx',
  '.json', '.jsonc',
  '.md', '.mdx', '.txt',
  '.py', '.java', '.html', '.css', '.scss', '.sass',
  '.yml', '.yaml', '.toml', '.ini', '.env',
  '.go', '.rs', '.rb', '.php', '.sh', '.bash', '.zsh',
  '.c', '.cpp', '.h', '.cs', '.swift', '.kt',
  '.sql', '.graphql', '.prisma',
  '.vue', '.svelte',
]);

export function walk(dir, ignore = [], out = [], _root) {
  const root = _root ?? dir;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p   = path.join(dir, e.name);
    const rel = path.relative(root, p);
    if (matchIgnore(rel, ignore)) continue;
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(p, ignore, out, root);
    } else if (TEXT.has(path.extname(e.name).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

export function scoreRepo(dir, { ignorePatterns = [] } = {}) {
  const ignore = [...loadIgnore(dir), ...ignorePatterns];
  const files  = walk(dir, ignore);
  if (!files.length) {
    return { root: dir, scannedAt: new Date().toISOString(), total: 0, score: 0, grade: 'F', files: [] };
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
  };
}

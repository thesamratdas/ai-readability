import fs from 'node:fs';
import path from 'node:path';
import { scoreRepo } from '../core.js';

const SUMMARY_DIR = path.join('.ai', 'summaries');

// Resolves `filePath` under `root`, throwing if it would escape root (path
// traversal guard) — covers `../` segments and absolute/other-drive paths,
// since path.relative() returns an unmodified absolute path in that case
// rather than a string starting with '..'.
function resolveContained(root, filePath) {
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes repository root: ${filePath}`);
  }
  return abs;
}

export function repoMap({ root = '.' } = {}) {
  const absRoot = path.resolve(root);
  const mapPath = path.join(absRoot, SUMMARY_DIR, 'CONTEXT_MAP.md');
  if (!fs.existsSync(mapPath)) {
    return {
      root: absRoot, found: false, contextMap: null,
      message: 'No CONTEXT_MAP.md found — run `ai-readability distill --write` first.',
    };
  }
  return { root: absRoot, found: true, contextMap: fs.readFileSync(mapPath, 'utf8') };
}

// Throws if `path` escapes `root`. Caller (server.js) turns that into an
// MCP `isError` result rather than crashing the server.
export function getFile({ root = '.', path: filePath, mode = 'full' }) {
  const absRoot = path.resolve(root);
  const abs = resolveContained(absRoot, filePath);

  if (mode === 'summary') {
    const summaryPath = path.join(absRoot, SUMMARY_DIR, filePath + '.md');
    if (fs.existsSync(summaryPath)) {
      return { path: filePath, mode: 'summary', found: true, content: fs.readFileSync(summaryPath, 'utf8') };
    }
    // No summary yet — fall through to full source. The returned `mode`
    // reports what was actually returned, so callers can tell.
  }

  if (!fs.existsSync(abs)) {
    return { path: filePath, mode: 'full', found: false, content: null };
  }
  return { path: filePath, mode: 'full', found: true, content: fs.readFileSync(abs, 'utf8') };
}

export function contextReport({ root = '.', respectGitignore = false } = {}) {
  return scoreRepo(path.resolve(root), { respectGitignore });
}

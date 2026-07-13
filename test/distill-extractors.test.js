import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { extractSkeleton } from '../src/distill.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const read = (...p) => fs.readFileSync(path.join(fixturesDir, ...p), 'utf8');

// ── Python ──────────────────────────────────────────────────────────────────

test('extractSkeleton (Python): keeps module/class/def docstrings, decorators, and signatures', () => {
  const skeleton = extractSkeleton(read('python', 'service.py'), '.py');

  assert.match(skeleton, /"""User account service/, 'module docstring kept');
  assert.match(skeleton, /@dataclass/, 'decorator kept');
  assert.match(skeleton, /class Account:/, 'class signature kept');
  assert.match(skeleton, /"""A user account record\."""/, 'class docstring kept');
  assert.match(skeleton, /class AccountService:/);
  assert.match(skeleton, /def __init__\(self, db\):/, 'method signature kept');
  assert.match(skeleton, /def create_account\(self, email, password\):/);
  assert.match(skeleton, /"""Create a new account, hashing the password before storage\."""/, 'method docstring kept');
  assert.match(skeleton, /@staticmethod/);
  assert.match(skeleton, /def validate_email\(email\):/);
  assert.match(skeleton, /@property/);
  assert.match(skeleton, /def upgrade_plan\(account, plan\):/, 'module-level function kept');
});

test('extractSkeleton (Python): drops function/method bodies', () => {
  const skeleton = extractSkeleton(read('python', 'service.py'), '.py');

  assert.doesNotMatch(skeleton, /hashlib\.sha256/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /self\.db\.insert/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /"@" in email/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /raise ValueError/, 'body statement dropped');
});

test('extractSkeleton (Python): handles async def and keeps its docstring', () => {
  const skeleton = extractSkeleton(read('python', 'utils.py'), '.py');

  assert.match(skeleton, /def slugify\(text\):/);
  assert.match(skeleton, /"""Convert text to a lowercase, hyphen-separated slug\."""/);
  assert.match(skeleton, /async def fetch_with_retry\(client, url, attempts=3\):/);
  assert.match(skeleton, /"""Fetch a URL, retrying on failure up to `attempts` times\."""/);
  assert.doesNotMatch(skeleton, /last_error/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /for _ in range/, 'body statement dropped');
});

// ── Go ──────────────────────────────────────────────────────────────────────

test('extractSkeleton (Go): keeps doc comments, struct fields, interface methods, and func signatures', () => {
  const skeleton = extractSkeleton(read('go', 'server.go'), '.go');

  assert.match(skeleton, /\/\/ Widget represents a single item in the catalog\./);
  assert.match(skeleton, /type Widget struct \{/);
  assert.match(skeleton, /ID\s+string/, 'struct field kept');
  assert.match(skeleton, /type Store interface \{/);
  assert.match(skeleton, /Get\(id string\) \(\*Widget, error\)/, 'interface method kept');
  assert.match(skeleton, /func NewServer\(store Store\) \*Server \{ … \}/, 'func signature kept, body dropped');
  assert.match(skeleton, /func \(s \*Server\) ServeHTTP\(w http\.ResponseWriter, r \*http\.Request\) \{ … \}/, 'method with receiver kept');
});

test('extractSkeleton (Go): drops func bodies', () => {
  const skeleton = extractSkeleton(read('go', 'server.go'), '.go');

  assert.doesNotMatch(skeleton, /http\.Error/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /json\.NewEncoder/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /price \* 0\.9/, 'body statement dropped');
});

test('extractSkeleton (Go): handles multiple funcs and a plain (non-receiver) struct type', () => {
  const skeleton = extractSkeleton(read('go', 'util.go'), '.go');

  assert.match(skeleton, /func Slugify\(text string\) string \{ … \}/);
  assert.match(skeleton, /type RetryConfig struct \{/);
  assert.match(skeleton, /Attempts int/);
  assert.match(skeleton, /func FetchWithRetry\(url string, cfg RetryConfig\) \(string, error\) \{ … \}/);
  assert.doesNotMatch(skeleton, /lastErr/, 'body statement dropped');
});

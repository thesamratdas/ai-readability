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

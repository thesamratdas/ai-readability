import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function makeFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-cli-'));
  fs.writeFileSync(path.join(tmpDir, 'index.js'), "export function greet() {\n  return 'hello';\n}\n");
  return tmpDir;
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

// A real repo's score is always in [0, 100], so these thresholds make the
// pass/fail outcome deterministic without depending on the scoring algorithm.

test('--fail-under: exits 1 when the threshold cannot possibly be met', () => {
  const tmpDir = makeFixture();
  try {
    const r = runCli([tmpDir, '--fail-under', '101', '--no-color']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /AI-Ready/, 'normal output still printed before the exit code is set');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--fail-under: exits 0 when the threshold is trivially met', () => {
  const tmpDir = makeFixture();
  try {
    const r = runCli([tmpDir, '--fail-under', '0', '--no-color']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /AI-Ready/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--fail-under combined with --json: exit code reflects the gate, stdout stays valid JSON', () => {
  const tmpDir = makeFixture();
  try {
    const fail = runCli([tmpDir, '--fail-under', '101', '--json', '--no-color']);
    assert.strictEqual(fail.status, 1);
    const parsedFail = JSON.parse(fail.stdout);
    assert.ok(typeof parsedFail.score === 'number');

    const pass = runCli([tmpDir, '--fail-under', '0', '--json', '--no-color']);
    assert.strictEqual(pass.status, 0);
    const parsedPass = JSON.parse(pass.stdout);
    assert.ok(typeof parsedPass.score === 'number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--fail-under: no gate applied when the repo has no scannable files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-cli-empty-'));
  try {
    const r = runCli([tmpDir, '--fail-under', '101', '--no-color']);
    assert.strictEqual(r.status, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

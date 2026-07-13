import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoMap, getFile, contextReport } from '../src/mcp/tools.js';

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

// ── tools.js (pure logic, no SDK/stdio needed) ─────────────────────────────────

test('repoMap: reports found: false with a helpful message when CONTEXT_MAP.md is missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-map-'));
  try {
    const result = repoMap({ root: tmpDir });
    assert.equal(result.found, false);
    assert.equal(result.contextMap, null);
    assert.match(result.message, /distill --write/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('repoMap: returns the CONTEXT_MAP.md content when present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-map-'));
  try {
    const mapDir = path.join(tmpDir, '.ai', 'summaries');
    fs.mkdirSync(mapDir, { recursive: true });
    fs.writeFileSync(path.join(mapDir, 'CONTEXT_MAP.md'), '# Context Map\n');
    const result = repoMap({ root: tmpDir });
    assert.equal(result.found, true);
    assert.equal(result.contextMap, '# Context Map\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getFile: returns full source for a plain path', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-file-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'export const a = 1;\n');
    const result = getFile({ root: tmpDir, path: 'a.js' });
    assert.equal(result.found, true);
    assert.equal(result.mode, 'full');
    assert.equal(result.content, 'export const a = 1;\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getFile: mode "summary" falls back to full source when no summary exists, and reports the fallback', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-file-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'export const a = 1;\n');
    const result = getFile({ root: tmpDir, path: 'a.js', mode: 'summary' });
    assert.equal(result.mode, 'full', 'reports what was actually returned, not what was requested');
    assert.equal(result.content, 'export const a = 1;\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getFile: mode "summary" returns the distilled summary when one exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-file-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'export const a = 1;\n');
    const summaryDir = path.join(tmpDir, '.ai', 'summaries');
    fs.mkdirSync(summaryDir, { recursive: true });
    fs.writeFileSync(path.join(summaryDir, 'a.js.md'), '# a.js\n\nsummary body\n');
    const result = getFile({ root: tmpDir, path: 'a.js', mode: 'summary' });
    assert.equal(result.mode, 'summary');
    assert.equal(result.content, '# a.js\n\nsummary body\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getFile: found: false for a path that does not exist (but stays within root)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-file-'));
  try {
    const result = getFile({ root: tmpDir, path: 'missing.js' });
    assert.equal(result.found, false);
    assert.equal(result.content, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getFile: throws when the path escapes the repo root (path-containment check)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-file-'));
  try {
    assert.throws(
      () => getFile({ root: tmpDir, path: '../../../etc/passwd' }),
      /escapes repository root/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getFile: throws for an absolute path outside root', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-file-'));
  try {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-outside-'));
    try {
      assert.throws(
        () => getFile({ root: tmpDir, path: path.join(outside, 'secret.txt') }),
        /escapes repository root/,
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('contextReport: returns the same shape as scoreRepo', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-report-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'export const a = 1;\n');
    const result = contextReport({ root: tmpDir });
    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.score, 'number');
    assert.equal(typeof result.grade, 'string');
    assert.ok(Array.isArray(result.files));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── stdio integration (spawns the real `ai-readability mcp` process) ──────────
// Uses the MCP SDK's own Client/StdioClientTransport (devDependency — this is
// test-only; the CLI's runtime use of the SDK is an optionalDependency).

test('mcp server: tools/list and tools/call work over a real stdio connection', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-mcp-stdio-'));
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'export const a = 1;\n');

    const transport = new StdioClientTransport({ command: process.execPath, args: [cliPath, 'mcp'] });
    await client.connect(transport);

    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map(t => t.name).sort(),
      ['context_report', 'get_file', 'repo_map'],
    );

    const report = await client.callTool({ name: 'context_report', arguments: { root: tmpDir } });
    const reportPayload = JSON.parse(report.content[0].text);
    assert.equal(typeof reportPayload.score, 'number');

    const escape = await client.callTool({
      name: 'get_file',
      arguments: { root: tmpDir, path: '../../../etc/passwd' },
    });
    assert.equal(escape.isError, true);
  } finally {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

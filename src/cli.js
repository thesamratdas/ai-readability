#!/usr/bin/env node
import { scoreText, isGenerated, walk, gradeOf, loadIgnore, GEN_DIRS } from './core.js';
import { MODELS } from './models.js';
import fs   from 'node:fs';
import path from 'node:path';
import kleur from 'kleur';

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has  = f => argv.includes(f);
const opt  = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const pos  = argv.filter(a => !a.startsWith('-'));

const root     = pos[0] || '.';
const showCost = has('--cost');
const doFix    = has('--fix');
const jsonOut  = has('--json');
const doWatch  = has('--watch');
const noColor  = has('--no-color') || !process.stdout.isTTY;
const topN     = Math.max(1, parseInt(opt('--top') ?? '10') || 10);

if (noColor) kleur.enabled = false;

// ── help ──────────────────────────────────────────────────────────────────────
if (has('--help') || has('-h')) {
  console.log(`
  ${kleur.bold('ai-readability')}  ·  score how AI-readable your codebase is

  ${kleur.bold('Usage')}
    ai-readability [path] [options]

  ${kleur.bold('Options')}
    --cost        Show per-model cost and context window usage table
    --fix         Auto-write suggested patterns to .aiignore
    --json        Machine-readable JSON output  (pipe to jq, CI scripts)
    --watch       Re-scan automatically on file changes
    --top <N>     Show top N files by waste  [default: 10]
    --no-color    Disable color output

  ${kleur.bold('Examples')}
    ai-readability .
    ai-readability ./src --cost
    ai-readability . --fix
    ai-readability . --cost --fix
    ai-readability . --json
    ai-readability . --watch
`);
  process.exit(0);
}

// ── color helpers ─────────────────────────────────────────────────────────────
const GCOL = { A: kleur.green, B: kleur.cyan, C: kleur.yellow, D: kleur.magenta, F: kleur.red };
const gc = (grade, text) => (GCOL[grade] ?? (x => x))(text ?? grade);

// ── bar chart ─────────────────────────────────────────────────────────────────
const BAR_W = 24;
function bar(frac) {
  const n = Math.max(0, Math.min(BAR_W, Math.round(frac * BAR_W)));
  return kleur.blue('█'.repeat(n)) + kleur.dim('░'.repeat(BAR_W - n));
}

// ── formatting ────────────────────────────────────────────────────────────────
const fmt    = n => n.toLocaleString();
const pct    = (n, t) => t ? ((n / t) * 100).toFixed(0).padStart(3) + '%' : '  0%';
const dollar = n => ('$' + Math.abs(n).toFixed(3)).padStart(7);

// ── reason classifier ─────────────────────────────────────────────────────────
function reasonFor(r, total) {
  if (isGenerated(r.file))         return 'generated';
  if (r.value < 45)                return 'low-signal (F)';
  if (r.value < 60)                return 'low-signal (D)';
  if (r.tokens / total > 0.10)     return `token-hog (${Math.round(r.tokens / total * 100)}%)`;
  return null;
}

// ── scan ──────────────────────────────────────────────────────────────────────
function scan() {
  const ignore = loadIgnore(root);
  return walk(root, ignore).map(f => {
    const rel = path.relative(root, f);
    const s   = scoreText(fs.readFileSync(f, 'utf8'));
    return { file: rel, ...s, waste: s.tokens * (1 - s.value / 100) };
  });
}

// ── cost table ────────────────────────────────────────────────────────────────
function costTable(tokens, heading) {
  const rule = kleur.dim('─'.repeat(70));
  console.log('\n  ' + kleur.bold(heading) + kleur.dim('  (input tokens only)'));
  console.log('  ' + rule);
  console.log(kleur.dim('  Model                   $/MTok   Context       Usage    $/run    Fits?'));
  console.log('  ' + rule);
  for (const m of MODELS) {
    const cost     = tokens / 1e6 * m.usdPerMTok;
    const usagePct = ((tokens / m.ctx) * 100).toFixed(0);
    const fits     = tokens <= m.ctx;
    const ctxStr   = m.ctx >= 1_000_000
      ? `${(m.ctx / 1e6).toFixed(1)}M tok`
      : `${(m.ctx / 1000).toFixed(0)}K tok`;
    const fitsStr  = fits ? kleur.green('✓') : kleur.red('✗ over');
    console.log(
      `  ${m.name.padEnd(22)}  ${dollar(m.usdPerMTok)}   ${ctxStr.padEnd(9)}   ` +
      `${usagePct.padStart(4)}%   ${dollar(cost)}   ${fitsStr}`
    );
  }
}

// ── main render ───────────────────────────────────────────────────────────────
function render() {
  const rows = scan();

  if (!rows.length) {
    console.log(kleur.yellow(`\n  No supported files found in "${root}"\n`));
    return;
  }

  const total     = rows.reduce((a, r) => a + r.tokens, 0);
  const repoVal   = total ? Math.round(rows.reduce((a, r) => a + r.value * r.tokens, 0) / total) : 0;
  const repoGrade = gradeOf(repoVal);

  // ── json mode ──────────────────────────────────────────────────────────────
  if (jsonOut) {
    const flagged   = rows.map(r => ({ ...r, reason: reasonFor(r, total) })).filter(r => r.reason);
    const keptTok   = rows.filter(r => !flagged.some(f => f.file === r.file)).reduce((a, r) => a + r.tokens, 0);
    process.stdout.write(JSON.stringify({
      root,
      scannedAt: new Date().toISOString(),
      total, grade: repoGrade, score: repoVal,
      files: [...rows].sort((a, b) => b.waste - a.waste),
      flagged,
      savings: { tokensSaved: total - keptTok, tokensAfter: keptTok, pctSaved: Math.round((total - keptTok) / total * 100) },
      models: MODELS.map(m => ({
        name: m.name, ctxTokens: m.ctx, fits: total <= m.ctx,
        usagePct: +((total / m.ctx) * 100).toFixed(1),
        costUsd: +(total / 1e6 * m.usdPerMTok).toFixed(6),
        costAfterExclusionUsd: +(keptTok / 1e6 * m.usdPerMTok).toFixed(6),
      })),
    }, null, 2) + '\n');
    return;
  }

  const rule = kleur.dim('─'.repeat(70));

  // ── header ─────────────────────────────────────────────────────────────────
  console.log('\n' + kleur.bold(`  📦 ${root}`));
  console.log('  ' + rule);
  console.log(
    `\n  Grade ${gc(repoGrade, kleur.bold(repoGrade))}  ·  ` +
    `${kleur.bold(fmt(total))} tokens  ·  Score ${repoVal}/100  ·  ${rows.length} files\n`
  );

  // ── bar chart ──────────────────────────────────────────────────────────────
  console.log(kleur.bold('  Token breakdown') + kleur.dim(`  top ${topN} by waste`));
  console.log('  ' + rule);
  [...rows]
    .sort((a, b) => b.waste - a.waste)
    .slice(0, topN)
    .forEach(r => {
      const frac = total ? r.tokens / total : 0;
      console.log(
        `  ${gc(r.grade)}  ${bar(frac)}  ${pct(r.tokens, total)}  ` +
        `${String(r.tokens).padStart(7)} tok  ${kleur.dim(r.file)}`
      );
    });

  // ── flagged files ──────────────────────────────────────────────────────────
  const flagged = rows.map(r => ({ ...r, reason: reasonFor(r, total) })).filter(r => r.reason);

  if (!flagged.length) {
    console.log('\n  ' + kleur.green('✅  No noise detected — this repo is clean for AI context.'));
    if (showCost) costTable(total, '💰 Cost to send this repo to an AI');
    console.log();
    return;
  }

  const kept      = rows.filter(r => !flagged.some(f => f.file === r.file));
  const keptTotal = kept.reduce((a, r) => a + r.tokens, 0) || 1;
  const keptVal   = Math.round(kept.reduce((a, r) => a + r.value * r.tokens, 0) / keptTotal);
  const saved     = total - keptTotal;

  console.log();
  console.log(
    `  💡 Exclude ${kleur.bold(flagged.length)} file(s)  ` +
    `${gc(repoGrade)} → ${gc(gradeOf(keptVal))}  ·  ` +
    `save ${kleur.bold(fmt(saved))} tokens (${Math.round(saved / total * 100)}%)`
  );
  console.log();

  flagged.sort((a, b) => b.tokens - a.tokens).forEach(r => {
    const tag = `[${r.reason}]`.padEnd(20);
    console.log(`    ${kleur.dim(tag)}  ${String(r.tokens).padStart(7)} tok  ${r.file}`);
  });

  const patterns = [...new Set(flagged.map(r => {
    const dir = r.file.replace(/\\/g, '/').split('/').find(s => GEN_DIRS.has(s));
    return dir ? dir + '/' : r.file.replace(/\\/g, '/');
  }))];

  console.log('\n  ' + kleur.bold('📋 Paste into .aiignore / .cursorignore:'));
  patterns.forEach(p => console.log('    ' + kleur.green(p)));

  if (doFix) {
    const dest     = path.join(root, '.aiignore');
    const existing = fs.existsSync(dest)
      ? fs.readFileSync(dest, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
      : [];
    const toAdd = patterns.filter(p => !existing.includes(p));
    if (toAdd.length) {
      fs.appendFileSync(dest, (existing.length ? '\n' : '') + toAdd.join('\n') + '\n');
      console.log('\n  ' + kleur.green(`✅  Wrote ${toAdd.length} pattern(s) to .aiignore`));
    } else {
      console.log('\n  ' + kleur.dim('Already up to date — .aiignore unchanged.'));
    }
  } else {
    console.log('\n  ' + kleur.dim('Tip: run with --fix to write .aiignore automatically.'));
  }

  // ── cost table ─────────────────────────────────────────────────────────────
  if (showCost) {
    costTable(total, '💰 Cost to send this repo to an AI');
    if (keptTotal !== total) {
      costTable(keptTotal, `💰 After applying exclusions  (${fmt(keptTotal)} tokens)`);
    }
  }

  console.log();
}

// ── entry ─────────────────────────────────────────────────────────────────────
if (doWatch) {
  console.log(kleur.dim(`\n  👁  Watching ${root} for changes  (Ctrl+C to stop)\n`));
  render();
  let debounce;
  fs.watch(root, { recursive: true }, (_, filename) => {
    if (!filename || filename.includes('node_modules') || filename.includes('.git')) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => { console.clear(); render(); }, 400);
  });
} else {
  render();
}

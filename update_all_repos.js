#!/usr/bin/env node
/*
 * update_all_repos.js — SQA homework cross-repo updater
 * ------------------------------------------------------
 *
 * Reads classes.json from this folder. For each repo listed under each level:
 *   1. Fetches index.html from the repo via the GitHub API.
 *   2. Replaces the class <select> dropdown with the level's current classes.
 *   3. For A1 files (legacy "studentClass" pattern), also:
 *        - Adds <input type="hidden" id="teacherName" value=""> above the select
 *        - Renames id="studentClass" -> id="className"
 *        - Adds onchange="setTeacher(this)" handler
 *        - Injects a setTeacher() function definition if missing
 *        - Updates any getElementById('studentClass') references to className
 *   4. Commits the change back to the repo (only if content actually changed).
 *
 * Safety:
 *   - If a repo has no index.html, no <select id=...>, or already matches the
 *     desired output, it's logged and skipped — never errors out the batch.
 *   - Dry-run mode (set DRY_RUN=1 in env) shows changes without writing.
 *   - Form-submission code, speech recognition, scoring, and curriculum
 *     content are never touched.
 *
 * Auth:
 *   Reads GITHUB_TOKEN from the environment (provided by GitHub Actions or
 *   by you locally). The token must have repo write access for the org.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ------------------------- config -------------------------
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'classes.json'), 'utf8'));
const ORG = cfg.organization || 'SQA-Education';
const TOKEN = process.env.GITHUB_TOKEN;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!TOKEN) {
  console.error('ERROR: GITHUB_TOKEN environment variable not set.');
  console.error('In GitHub Actions, expose it via "env: GITHUB_TOKEN: ${{ secrets.SQA_PAT }}".');
  process.exit(1);
}

console.log(`SQA homework updater — term: ${cfg.term || '(unspecified)'}`);
console.log(`Organization: ${ORG}`);
if (DRY_RUN) console.log(`*** DRY RUN — no commits will be made ***`);
console.log('');

// ------------------------- GitHub API helper -------------------------
function gh(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'sqa-homework-updater',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };
    let payload = null;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        const status = res.statusCode;
        let parsed = null;
        if (data) { try { parsed = JSON.parse(data); } catch (_) { parsed = data; } }
        resolve({ status, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ------------------------- HTML transformation helpers -------------------------
function firstName(full) {
  return (full || '').trim().split(/\s+/)[0] || '';
}

// Build B2-style options grouped by teacher.
function buildClassNameOptions(classes) {
  const order = [];
  const groups = {};
  for (const c of classes) {
    if (!(c.teacher in groups)) { groups[c.teacher] = []; order.push(c.teacher); }
    groups[c.teacher].push(c);
  }
  const lines = ['<option value="">-- Select your class --</option>'];
  for (const teacher of order) {
    lines.push(`<optgroup label="${teacher}">`);
    for (const c of groups[teacher]) {
      const label = `${c.section} - ${c.schedule} (${firstName(teacher)})`;
      lines.push(`<option value="${c.section}" data-teacher="${teacher}">${label}</option>`);
    }
    lines.push(`</optgroup>`);
  }
  return lines.join('\n');
}

function replaceSelectBody(html, selectId, newInnerHTML) {
  const re = new RegExp(
    `(<select\\b[^>]*\\bid=["']${selectId}["'][^>]*>)([\\s\\S]*?)(<\\/select>)`,
    'i'
  );
  if (!re.test(html)) return null;
  return html.replace(re, (_m, open, _body, close) => `${open}\n${newInnerHTML}\n${close}`);
}

// A1 structural conversion: studentClass -> className pattern.
function convertA1Structure(html) {
  // 1) Hidden teacherName input above the select.
  if (!/id=["']teacherName["']/.test(html) && /<select\b[^>]*\bid=["']studentClass["']/i.test(html)) {
    html = html.replace(
      /(<select\b[^>]*\bid=["'])studentClass(["'][^>]*>)/i,
      '<input type="hidden" id="teacherName" value="">\n$1studentClass$2'
    );
  }
  // 2) Rename id and add onchange.
  if (/<select\b[^>]*\bid=["']studentClass["']/i.test(html)) {
    html = html.replace(
      /(<select\b[^>]*?)\bid=["']studentClass["']([^>]*?)>/i,
      (_m, before, after) => {
        const cleaned = (before + after).replace(/\s+onchange=["'][^"']*["']/i, '');
        return `${cleaned} id="className" onchange="setTeacher(this)">`;
      }
    );
  }
  // 3) Update JS references.
  if (/getElementById\(['"]studentClass['"]\)/.test(html)) {
    html = html.replace(/getElementById\((['"])studentClass\1\)/g, "getElementById('className')");
  }
  // 4) Inject setTeacher() if missing.
  if (!/function\s+setTeacher\s*\(/.test(html)) {
    const scriptOpens = [...html.matchAll(/<script\b[^>]*>/gi)];
    let target = null;
    for (let i = scriptOpens.length - 1; i >= 0; i--) {
      if (!/\bsrc=/i.test(scriptOpens[i][0])) { target = scriptOpens[i]; break; }
    }
    if (target) {
      const insertAt = target.index + target[0].length;
      const fn = '\nfunction setTeacher(sel){var opt=sel.options[sel.selectedIndex];var t=document.getElementById("teacherName");if(t)t.value=opt?(opt.getAttribute("data-teacher")||""):"";}\n';
      html = html.slice(0, insertAt) + fn + html.slice(insertAt);
    }
  }
  return html;
}

// Apply the full transformation for a given level.
function transformHtml(original, level, classes) {
  let html = original;
  if (level === 'A1') html = convertA1Structure(html);

  const next = replaceSelectBody(html, 'className', buildClassNameOptions(classes));
  if (next !== null) return next;

  // Fallback in case A1 conversion didn't happen but studentClass is still there.
  const fallback = replaceSelectBody(html, 'studentClass', buildClassNameOptions(classes));
  return fallback;
}

// ------------------------- per-repo work -------------------------
async function updateRepo(repo, level, classes) {
  const prefix = `[${level}] ${repo}`;

  // 1. Fetch index.html metadata (need SHA for the commit).
  const meta = await gh('GET', `/repos/${ORG}/${repo}/contents/index.html`);
  if (meta.status === 404) {
    console.log(`  · ${prefix} — no index.html, skipped`);
    return { skipped: true };
  }
  if (meta.status !== 200 || !meta.body || !meta.body.content) {
    console.log(`  ! ${prefix} — fetch failed (HTTP ${meta.status})`);
    return { failed: true, reason: `HTTP ${meta.status}` };
  }
  const sha = meta.body.sha;
  const original = Buffer.from(meta.body.content, 'base64').toString('utf8');

  // 2. Transform.
  const next = transformHtml(original, level, classes);
  if (next === null) {
    console.log(`  · ${prefix} — no class dropdown found in index.html, skipped`);
    return { skipped: true };
  }
  if (next === original) {
    console.log(`  = ${prefix} — already up to date`);
    return { unchanged: true };
  }

  if (DRY_RUN) {
    console.log(`  ~ ${prefix} — WOULD update`);
    return { wouldUpdate: true };
  }

  // 3. Commit the change.
  const commitMsg = `Update class dropdown for ${cfg.term || 'current term'}`;
  const put = await gh('PUT', `/repos/${ORG}/${repo}/contents/index.html`, {
    message: commitMsg,
    content: Buffer.from(next, 'utf8').toString('base64'),
    sha
  });
  if (put.status === 200 || put.status === 201) {
    console.log(`  ✓ ${prefix} — updated`);
    return { updated: true };
  }
  console.log(`  ! ${prefix} — commit failed (HTTP ${put.status}): ${put.body && put.body.message}`);
  return { failed: true, reason: `commit HTTP ${put.status}` };
}

// ------------------------- main loop -------------------------
(async () => {
  const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'CONV'];
  const stats = { updated: 0, unchanged: 0, skipped: 0, failed: 0, wouldUpdate: 0 };
  const failures = [];

  for (const level of levels) {
    const section = cfg[level];
    if (!section || !section.repos || !section.classes) {
      console.log(`Skipping level ${level} — not configured in classes.json\n`);
      continue;
    }
    console.log(`--- Level ${level} (${section.repos.length} repos) ---`);
    for (const repo of section.repos) {
      try {
        const r = await updateRepo(repo, level, section.classes);
        if (r.updated)     stats.updated++;
        if (r.unchanged)   stats.unchanged++;
        if (r.skipped)     stats.skipped++;
        if (r.wouldUpdate) stats.wouldUpdate++;
        if (r.failed)    { stats.failed++; failures.push(`${level}/${repo}: ${r.reason}`); }
      } catch (err) {
        console.log(`  ! [${level}] ${repo} — error: ${err.message}`);
        stats.failed++;
        failures.push(`${level}/${repo}: ${err.message}`);
      }
    }
    console.log('');
  }

  console.log('============================================================');
  console.log(`Summary: ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.skipped} skipped, ${stats.failed} failed${DRY_RUN ? `, ${stats.wouldUpdate} would update` : ''}`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    // Exit non-zero so the workflow shows red on real failures.
    process.exit(1);
  }
})();

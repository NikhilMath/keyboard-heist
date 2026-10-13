// Rebuilds BRANCHES.md (a Mermaid flowchart with every choice on its arrow, a scene index, and the full story text) from STORY in index.html.
// Run from the repo root after any change to the story graph:
//   node tools/branches.js
//   osascript -l JavaScript tools/branches.js   (macOS without node)

const isJXA = typeof ObjC !== 'undefined';
if (isJXA) ObjC.import('Foundation');

function read(file) {
  if (isJXA) return $.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, null).js;
  return require('fs').readFileSync(file, 'utf8');
}
function write(file, text) {
  if (isJXA) return $(text).writeToFileAtomicallyEncodingError(file, true, $.NSUTF8StringEncoding, null);
  require('fs').writeFileSync(file, text);
}

const root = isJXA ? $.NSFileManager.defaultManager.currentDirectoryPath.js : process.cwd();
const html = read(root + '/index.html');

// Cut the STORY object literal out of the script by matching braces (skipping strings).
const start = html.indexOf('const STORY = ') + 'const STORY = '.length;
let depth = 0, i = start;
for (;; i++) {
  const c = html[i];
  if (c === '"') { i++; while (html[i] !== '"') { if (html[i] === '\\') i++; i++; } continue; }
  if (c === '{') depth++;
  else if (c === '}' && --depth === 0) break;
}
const STORY = JSON.parse(html.slice(start, i + 1));
const ids = Object.keys(STORY);

// Line number of each scene in index.html, for clickable links.
const lines = html.split('\n');
const lineOf = {};
lines.forEach((line, n) => {
  const m = line.match(/^  "([a-z0-9_]+)": \{$/);
  if (m && STORY[m[1]]) lineOf[m[1]] = n + 1;
});

const kind = id => {
  const s = STORY[id];
  if (s.finale) return 'Real ending';
  if (s.ending) return 'Dead end';
  if (s.checkpoint) return 'To be continued';
  return 'Scene';
};
const label = id => {
  const s = STORY[id];
  const text = s.ending ? (s.name || s.title) : s.title;
  return text.replace(/"/g, '#quot;');
};
const cls = id => {
  const s = STORY[id];
  const base = s.finale ? 'finale' : s.ending ? 'dead' : 'scene';
  return s.hell ? 'hell' + base[0].toUpperCase() + base.slice(1) : base;
};

const mer = ['```mermaid', 'flowchart TD'];
const earth = ids.filter(id => !STORY[id].hell);
const hell = ids.filter(id => STORY[id].hell);
// Dead ends are diamonds (user's request); everything else is a box.
const shape = id => {
  const s = STORY[id];
  return s.ending && !s.finale ? `{"${label(id)}"}` : `["${label(id)}"]`;
};
for (const id of earth) mer.push(`  ${id}${shape(id)}:::${cls(id)}`);
if (hell.length) {
  mer.push('  subgraph HELL["Hell"]');
  for (const id of hell) mer.push(`    ${id}${shape(id)}:::${cls(id)}`);
  mer.push('  end');
}
const hellEdges = [];
let edge = 0;
for (const id of ids) for (const c of STORY[id].choices || []) {
  // Each arrow carries the choice you click, with its stamp, so the chart reads as the story.
  const choiceText = (c.stamp ? c.stamp.toUpperCase() + ': ' : '') + c.label;
  mer.push(`  ${id} -->|"${choiceText.replace(/"/g, '#quot;')}"| ${c.next}`);
  if (STORY[id].hell) hellEdges.push(edge);
  edge++;
}
// Gray arrows vanish on Hell's dark background, so draw those red.
if (hellEdges.length) mer.push(`  linkStyle ${hellEdges.join(',')} stroke:#ff5a3c`);
mer.push(
  '  classDef scene fill:#f6f1e3,stroke:#193b37,color:#193b37',
  '  classDef finale fill:#d8eeaa,stroke:#193b37,stroke-width:3px,color:#193b37',
  '  classDef dead fill:#f6f1e3,stroke:#193b37,stroke-dasharray:4 3,color:#193b37',
  '  classDef hellScene fill:#3a1410,stroke:#ff5a3c,color:#f5e6e2',
  '  classDef hellFinale fill:#ff5a3c,stroke:#3a1410,stroke-width:3px,color:#1c0c0b',
  '  classDef hellDead fill:#3a1410,stroke:#ff5a3c,stroke-dasharray:4 3,color:#f5e6e2',
  '  style HELL fill:#1c0c0b,stroke:#ff5a3c,color:#ff5a3c',
  '```'
);

const cell = text => text.replace(/\|/g, '\\|');
const table = ['| Scene | Kind | Leads to | Code |', '| --- | --- | --- | --- |'];
for (const id of ids) {
  const s = STORY[id];
  const name = s.ending ? (s.name || s.title) : s.title;
  const next = (s.choices || []).map(c => `[\`${c.next}\`](#${c.next})`).join(', ') || '(end)';
  table.push(`| [${cell(name)}](#${id}) \`${id}\`${s.hell ? ' (Hell)' : ''} | ${kind(id)} | ${next} | [code](index.html#L${lineOf[id]}) |`);
}

// The full story: every scene's text and choices, each with an anchor the table and choices link to.
const story = [];
for (const id of ids) {
  const s = STORY[id];
  story.push(`<a name="${id}"></a>`, '', `### ${s.title}`, '');
  story.push(`\`${id}\` · ${kind(id)}${s.ending ? ': ' + (s.name || s.title) : ''}${s.hell ? ' · Hell' : ''}`, '');
  for (const p of s.text) story.push(p, '');
  if (s.ticket) story.push(`> **From:** ${s.ticket.from}<br>`, `> **Subject:** ${s.ticket.subject}<br>`, `> ${s.ticket.body}`, '');
  for (const p of s.afterTicket || []) story.push(p, '');
  for (const c of s.choices || []) story.push(`- ${c.stamp ? '**' + c.stamp.toUpperCase() + '** ' : ''}[${c.label}](#${c.next}) *${c.hint}*`);
  if (s.choices) story.push('');
  if (s.finale) story.push('*The end.*', '');
}

const real = ids.filter(id => STORY[id].finale).length;
const dead = ids.filter(id => STORY[id].ending && !STORY[id].finale).length;

const doc = [
  '# Keyboard Heist: branch map',
  '',
  '<!-- Generated by tools/branches.js from STORY in index.html. Do not edit by hand; rerun the script. -->',
  '',
  `${ids.length} scenes, ${real} real endings (solid green, or solid red in Hell), ${dead} dead ends (dashed diamonds). Red boxes are Hell.`,
  '',
  ...mer,
  '',
  '## Every scene',
  '',
  'Each scene name jumps to its full text below; “code” opens it in `index.html`.',
  '',
  ...table,
  '',
  '## The full story',
  '',
  'Every scene in story order, with its choices. Click a choice to jump to the scene it leads to.',
  '',
  ...story
].join('\n');

write(root + '/BRANCHES.md', doc);
console.log(`Updated BRANCHES.md: ${ids.length} scenes, ${real} real endings, ${dead} dead ends.`);

// Rebuilds BRANCHES.md (a Mermaid flowchart with every choice on its arrow, a scene index, and the full story text) from STORY in index.html,
// and branches.html, the same chart as a page on the site where every box jumps to its scene and every scene links back to its box.
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
  const zone = s.hell ? 'hell' : s.space ? 'space' : '';
  return zone ? zone + base[0].toUpperCase() + base.slice(1) : base;
};

const mer = ['```mermaid', 'flowchart TD'];
const earth = ids.filter(id => !STORY[id].hell && !STORY[id].space);
const hell = ids.filter(id => STORY[id].hell);
const space = ids.filter(id => STORY[id].space);
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
if (space.length) {
  mer.push('  subgraph SPACE["The mission"]');
  for (const id of space) mer.push(`    ${id}${shape(id)}:::${cls(id)}`);
  mer.push('  end');
}
const hellEdges = [], spaceEdges = [];
let edge = 0;
for (const id of ids) for (const c of STORY[id].choices || []) {
  // Each arrow carries the choice you click, with its stamp, so the chart reads as the story.
  const choiceText = (c.stamp ? c.stamp.toUpperCase() + ': ' : '') + c.label;
  mer.push(`  ${id} -->|"${choiceText.replace(/"/g, '#quot;')}"| ${c.next}`);
  if (STORY[id].hell) hellEdges.push(edge);
  if (STORY[id].space) spaceEdges.push(edge);
  edge++;
}
// Gray arrows vanish on Hell's dark background, so draw those red.
if (hellEdges.length) mer.push(`  linkStyle ${hellEdges.join(',')} stroke:#ff5a3c`);
// The same for the space branch's navy box: draw its arrows blue.
if (spaceEdges.length) mer.push(`  linkStyle ${spaceEdges.join(',')} stroke:#7cc4ff`);
mer.push(
  '  classDef scene fill:#f6f1e3,stroke:#193b37,color:#193b37',
  '  classDef finale fill:#d8eeaa,stroke:#193b37,stroke-width:3px,color:#193b37',
  '  classDef dead fill:#f6f1e3,stroke:#193b37,stroke-dasharray:4 3,color:#193b37',
  '  classDef hellScene fill:#3a1410,stroke:#ff5a3c,color:#f5e6e2',
  '  classDef hellFinale fill:#ff5a3c,stroke:#3a1410,stroke-width:3px,color:#1c0c0b',
  '  classDef hellDead fill:#3a1410,stroke:#ff5a3c,stroke-dasharray:4 3,color:#f5e6e2',
  '  style HELL fill:#1c0c0b,stroke:#ff5a3c,color:#ff5a3c',
  '  classDef spaceScene fill:#16305c,stroke:#7cc4ff,color:#e8eef8',
  '  classDef spaceFinale fill:#7cc4ff,stroke:#16305c,stroke-width:3px,color:#0a1630',
  '  classDef spaceDead fill:#16305c,stroke:#7cc4ff,stroke-dasharray:4 3,color:#e8eef8',
  '  style SPACE fill:#0a1630,stroke:#7cc4ff,color:#7cc4ff',
  '```'
);

const cell = text => text.replace(/\|/g, '\\|');
const table = ['| Scene | Kind | Leads to | Code |', '| --- | --- | --- | --- |'];
for (const id of ids) {
  const s = STORY[id];
  const name = s.ending ? (s.name || s.title) : s.title;
  const next = (s.choices || []).map(c => `[\`${c.next}\`](#${c.next})`).join(', ') || '(end)';
  table.push(`| [${cell(name)}](#${id}) \`${id}\`${s.hell ? ' (Hell)' : s.space ? ' (space)' : ''} | ${kind(id)} | ${next} | [code](index.html#L${lineOf[id]}) |`);
}

// The full story: every scene's text and choices, each with an anchor the table and choices link to.
const story = [];
for (const id of ids) {
  const s = STORY[id];
  story.push(`<a name="${id}"></a>`, '', `### ${s.title}`, '');
  story.push(`\`${id}\` · ${kind(id)}${s.ending ? ': ' + (s.name || s.title) : ''}${s.hell ? ' · Hell' : s.space ? ' · Space' : ''}`, '');
  for (const p of s.text) story.push(p, '');
  if (s.ticket) story.push(`> **From:** ${s.ticket.from}<br>`, `> **Subject:** ${s.ticket.subject}<br>`, `> ${s.ticket.body}`, '');
  for (const p of s.afterTicket || []) story.push(p, '');
  for (const c of s.choices || []) story.push(`- ${c.stamp ? '**' + c.stamp.toUpperCase() + '** ' : ''}[${c.label}](#${c.next}) *${c.hint}*`);
  if (s.choices) story.push('');
  if (s.finale) story.push('*The end.*', '');
  story.push('[↑ Back to the map](#map)', '');
}

const real = ids.filter(id => STORY[id].finale).length;
const dead = ids.filter(id => STORY[id].ending && !STORY[id].finale).length;

const doc = [
  '# Keyboard Heist: branch map',
  '',
  '<!-- Generated by tools/branches.js from STORY in index.html. Do not edit by hand; rerun the script. -->',
  '',
  `${ids.length} scenes, ${real} real endings (solid green, solid red in Hell, or solid blue in space), ${dead} dead ends (dashed diamonds). Red boxes are Hell; blue boxes are the space mission.`,
  '',
  'GitHub won’t let you click the boxes. For a map where every box opens its scene, use [keyboardheist.com/branches.html](https://keyboardheist.com/branches.html).',
  '',
  '<a name="map"></a>',
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
  'Every scene in story order, with its choices. Click a choice to jump to the scene it leads to, or “Back to the map” to return to the chart.',
  '',
  ...story
].join('\n');

write(root + '/BRANCHES.md', doc);

// branches.html (user's request): GitHub ignores clicks inside Mermaid charts, so the clickable map lives on the site.
// It is not linked from the game and asks search engines not to index it, since it spoils the whole story.
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sections = ids.map(id => {
  const s = STORY[id];
  const out = [`<section class="scene${s.hell ? ' hell' : s.space ? ' space' : ''}" id="${id}">`];
  out.push(`<p class="meta">${kind(id)}${s.ending ? ': ' + esc(s.name || s.title) : ''}${s.hell ? ' · Hell' : s.space ? ' · Space' : ''} · <code>${id}</code></p>`);
  out.push(`<h2>${esc(s.title)}</h2>`);
  for (const p of s.text) out.push(`<p>${esc(p)}</p>`);
  if (s.ticket) out.push(`<blockquote class="ticket"><p><b>From:</b> ${esc(s.ticket.from)}<br><b>Subject:</b> ${esc(s.ticket.subject)}</p><p>${esc(s.ticket.body)}</p></blockquote>`);
  for (const p of s.afterTicket || []) out.push(`<p>${esc(p)}</p>`);
  if (s.choices) {
    out.push('<ul class="choices">');
    for (const c of s.choices) out.push(`<li>${c.stamp ? `<span class="stamp">${c.stamp.toUpperCase()}</span> ` : ''}<a href="#${c.next}">${esc(c.label)}</a> <i>${esc(c.hint)}</i></li>`);
    out.push('</ul>');
  }
  if (s.finale) out.push('<p class="the-end">The end.</p>');
  out.push(`<a class="back" href="#map-${id}">↑ Back to this box on the map</a>`, '</section>');
  return out.join('\n');
});
const chart = mer.slice(1, -1).join('\n');
const page = `<!doctype html>
<!-- Generated by tools/branches.js from STORY in index.html. Do not edit by hand; rerun the script. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Keyboard Heist: story map</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<style>
  :root { --paper: #f4f3ed; --ink: #182e2b; --muted: #69756e; --line: #d8ddd3; --accent: #d8eeaa; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: Georgia, serif; }
  a { color: var(--ink); }
  header, main { max-width: 760px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 32px; }
  .play { font: 700 13px Arial, Helvetica, sans-serif; letter-spacing: 1px; text-decoration: none; }
  h1 { font-size: clamp(38px, 7vw, 60px); font-weight: 400; letter-spacing: -2px; line-height: 1.05; margin: 18px 0 14px; }
  h1 em { color: #718264; }
  .intro { font-size: 17px; line-height: 1.6; color: #46554d; margin: 0 0 10px; }
  .spoilers { font: 700 12px Arial, Helvetica, sans-serif; letter-spacing: 2px; color: #a3442d; margin: 0 0 22px; }
  .map-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-width: 760px; margin: 0 auto 10px; padding: 0 16px; font: 13px Arial, Helvetica, sans-serif; color: var(--muted); }
  .map-tools span { margin-right: auto; }
  @media (max-width: 560px) { .map-tools span { flex-basis: 100%; } }
  .map-tools button { font: 700 13px Arial, Helvetica, sans-serif; color: var(--ink); background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 6px 11px; cursor: pointer; }
  .map-tools button:hover { border-color: var(--ink); }
  .map-tools button:disabled { opacity: .4; cursor: default; }
  .map-frame { overflow: auto; height: min(78vh, 900px); background: #fff; border-block: 1px solid var(--line); margin: 0 0 40px; }
  #chart { width: max-content; min-width: 100%; padding: 28px; font: 15px Arial, Helvetica, sans-serif; color: var(--muted); }
  #chart svg { display: block; margin: 0 auto; }
  #chart g.node { cursor: pointer; }
  #chart g.node:focus { outline: none; }
  #chart g.node:focus-visible .halo, #chart g.node.here .halo { stroke-opacity: 1; }
  #chart .halo { stroke-opacity: 0; pointer-events: none; }
  #chart g.node.here .halo { animation: pulse 1.2s ease-in-out 3; }
  @keyframes pulse { 50% { stroke-opacity: .25; } }
  .scene { border-top: 1px solid var(--line); padding: 26px 0 22px; scroll-margin-top: 12px; }
  .scene:target { background: #fbfaf5; box-shadow: -16px 0 0 #fbfaf5, 16px 0 0 #fbfaf5, inset 6px 0 0 var(--accent); padding-left: 22px; }
  .scene.hell { border-left: 4px solid #ff5a3c; padding-left: 16px; }
  .scene.space { border-left: 4px solid #7cc4ff; padding-left: 16px; }
  .meta { font: 700 11px Arial, Helvetica, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted); margin: 0; }
  .meta code { text-transform: none; letter-spacing: 0; font-weight: 400; }
  h2 { font-size: 30px; font-weight: 400; letter-spacing: -.6px; line-height: 1.2; margin: 8px 0 16px; }
  .scene p { font-size: 17px; line-height: 1.8; color: #46554d; margin: 0 0 14px; }
  .scene .meta { color: var(--muted); line-height: 1.5; }
  .ticket { margin: 0 0 16px; padding: 14px 18px; background: #fff; border: 1px solid var(--line); border-radius: 6px; }
  .ticket p { font: 15px/1.6 Arial, Helvetica, sans-serif; margin: 0 0 6px; }
  .ticket p:last-child { margin: 0; }
  .choices { list-style: none; padding: 0; margin: 4px 0 14px; font: 15px/1.5 Arial, Helvetica, sans-serif; }
  .choices li { margin: 0 0 10px; }
  .choices a { font-weight: 700; }
  .choices i { display: block; color: var(--muted); }
  .stamp { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; border: 1.5px solid currentColor; border-radius: 3px; padding: 1px 5px; color: #a3442d; }
  .the-end { font-size: 26px !important; color: var(--ink) !important; }
  .back { font: 700 12px Arial, Helvetica, sans-serif; letter-spacing: 1px; color: var(--muted); }
  footer { height: 60vh; }
  @media (prefers-reduced-motion: reduce) {
    #chart g.node.here .halo { animation: none; }
  }
</style>
</head>
<body>
<header>
  <a class="play" href="./">← Play the game</a>
  <h1>Keyboard <em>Heist.</em><br>The story map</h1>
  <p class="spoilers">SPOILERS: THIS PAGE HOLDS THE WHOLE STORY</p>
  <p class="intro">${ids.length} scenes, ${real} real endings (solid green, red in Hell, blue in space) and ${dead} dead ends (dashed diamonds). Click any box to read that scene. Under each scene, “Back to this box on the map” brings you back to it.</p>
</header>
<div class="map-tools"><span>Scroll or drag inside the map to move around.</span><button type="button" data-zoom="out" aria-label="Zoom out" disabled>−</button><button type="button" data-zoom="in" aria-label="Zoom in" disabled>+</button><button type="button" data-zoom="fit" disabled>Whole map</button><button type="button" data-zoom="1" disabled>Actual size</button></div>
<div class="map-frame" id="map"><div id="chart">Drawing the map…</div></div>
<main>
${sections.join('\n')}
</main>
<footer></footer>
<script type="module">
const CHART = ${JSON.stringify(chart).replace(/</g, '\\u003c')};
const frame = document.getElementById('chart');
const port = document.getElementById('map');
const box = {};
const SVG = 'http://www.w3.org/2000/svg';

// Center a scene's box in the map window, bring the whole window into view, and ring the box.
function showBox(id) {
  const g = box[id];
  if (!g) return;
  for (const old of frame.querySelectorAll('g.node.here')) old.classList.remove('here');
  g.classList.add('here');
  const r = g.getBoundingClientRect(), v = port.getBoundingClientRect();
  port.scrollLeft += r.left + r.width / 2 - (v.left + port.clientWidth / 2);
  port.scrollTop += r.top + r.height / 2 - (v.top + port.clientHeight / 2);
  document.querySelector('.map-tools').scrollIntoView({ block: 'start' });
  g.focus({ preventScroll: true });
}
function onHash() {
  const m = location.hash.match(/^#map-([a-z0-9_]+)$/);
  if (m) showBox(m[1]);
}
function openScene(id) {
  if (location.hash === '#' + id) document.getElementById(id).scrollIntoView();
  else location.hash = id;
}
addEventListener('hashchange', onHash);

// Zoom by resizing the drawing itself, so the text stays sharp, and keep the middle of the view where it was.
let svgEl, natW, natH, zoom = 1;
function setZoom(z) {
  const pad = 28;
  const cx = (port.scrollLeft + port.clientWidth / 2 - pad) / zoom;
  const cy = (port.scrollTop + port.clientHeight / 2 - pad) / zoom;
  zoom = Math.min(2, Math.max(fitZoom(), z));
  svgEl.style.width = natW * zoom + 'px';
  svgEl.style.height = natH * zoom + 'px';
  port.scrollLeft = cx * zoom + pad - port.clientWidth / 2;
  port.scrollTop = cy * zoom + pad - port.clientHeight / 2;
}
function fitZoom() { return Math.min(1, (port.clientWidth - 56) / natW, (port.clientHeight - 56) / natH); }
for (const b of document.querySelectorAll('[data-zoom]')) b.addEventListener('click', () => {
  const z = b.dataset.zoom;
  setZoom(z === 'in' ? zoom * 1.25 : z === 'out' ? zoom / 1.25 : z === 'fit' ? 0 : 1);
});
// The same back link twice in a row does not change the hash, so handle that click directly.
document.addEventListener('click', e => {
  const a = e.target.closest('a.back');
  if (a && location.hash === a.getAttribute('href')) { e.preventDefault(); onHash(); }
});

try {
  const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', flowchart: { useMaxWidth: false } });
  const { svg } = await mermaid.render('storymap', CHART);
  frame.innerHTML = svg;
  svgEl = frame.querySelector('svg');
  const vb = svgEl.viewBox.baseVal;
  natW = vb.width; natH = vb.height;
  svgEl.removeAttribute('width'); svgEl.removeAttribute('height');
  svgEl.style.maxWidth = 'none';
  svgEl.style.width = natW + 'px';
  svgEl.style.height = natH + 'px';
  for (const b of document.querySelectorAll('[data-zoom]')) b.disabled = false;
  for (const g of frame.querySelectorAll('g.node')) {
    const m = g.id.match(/flowchart-([a-z0-9_]+)-\\d+$/);
    const scene = m && document.getElementById(m[1]);
    if (!scene || !scene.classList.contains('scene')) continue;
    const id = m[1];
    box[id] = g;
    // A ring drawn just outside the box marks it when you come back to it.
    const b = g.getBBox();
    const halo = document.createElementNS(SVG, 'rect');
    halo.setAttribute('class', 'halo');
    halo.setAttribute('x', b.x - 7); halo.setAttribute('y', b.y - 7);
    halo.setAttribute('width', b.width + 14); halo.setAttribute('height', b.height + 14);
    halo.setAttribute('rx', 10);
    // Inline !important, because Mermaid's own box styles reach every rect inside a box.
    halo.setAttribute('style', 'fill: none !important; stroke: #e0662d !important; stroke-width: 5px !important; stroke-dasharray: none !important');
    g.prepend(halo);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'link');
    g.setAttribute('aria-label', 'Read the scene: ' + scene.querySelector('h2').textContent);
    g.addEventListener('click', () => openScene(id));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openScene(id); } });
  }
  // Open on the first scene, at the top of the map.
  const first = box.${ids[0]}.getBoundingClientRect(), view = port.getBoundingClientRect();
  port.scrollLeft += first.left + first.width / 2 - view.left - port.clientWidth / 2;
  onHash();
} catch (err) {
  frame.textContent = 'The map couldn’t load (it needs an internet connection). Every scene is still below.';
}
</script>
</body>
</html>
`;
write(root + '/branches.html', page);
console.log(`Updated BRANCHES.md and branches.html: ${ids.length} scenes, ${real} real endings, ${dead} dead ends.`);

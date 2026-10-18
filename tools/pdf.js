// Builds a PDF of the whole story from STORY and VIGNETTES in index.html, to email, read on a screen or print.
// Run from the repo root (needs node, and Google Chrome or Microsoft Edge to lay out the pages):
//   node tools/pdf.js             (writes book/keyboard-heist.pdf; only when the user asks, since 2026-10-17)
// It is the same gamebook as tools/epub.js, on 6x9 inch pages behind the Kindle cover (book/kindle-cover.jpg):
// one numbered section per page (a scene plus any scenes joined onto it), each starting on its own page, every choice a link that also says
// "Turn to N", so it works on paper too. The numbering is copied from tools/epub.js (same seed, same
// shuffle), so Section N is the same scene in both books; change the two together.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const out = path.resolve(process.argv[2] || 'book/keyboard-heist.pdf');
const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const TITLE = 'Keyboard Heist';
const AUTHOR = 'Nikhil Math';
const KICKER = 'A pick-your-path comedy';
const SEED = 'keyboard-heist';

// STORY is JSON inside the script; cut it out by matching braces (skipping strings), like tools/branches.js.
const start = html.indexOf('const STORY = ') + 'const STORY = '.length;
let depth = 0, end = start;
for (;; end++) {
  const c = html[end];
  if (c === '"') { end++; while (html[end] !== '"') { if (html[end] === '\\') end++; end++; } continue; }
  if (c === '{') depth++;
  else if (c === '}' && --depth === 0) break;
}
const STORY = JSON.parse(html.slice(start, end + 1));
const ids = Object.keys(STORY);

// VIGNETTES is a plain object literal of strings, so evaluate it on its own.
const vStart = html.indexOf('const VIGNETTES=') + 'const VIGNETTES='.length;
const VIGNETTES = vm.runInNewContext('(' + html.slice(vStart, html.indexOf('\n};', vStart) + 2) + ')');
// The opening has no vignette; the game shows the cover keyboard there instead.
const cover = html.match(/id="cover-art"[^>]*aria-label="([^"]*)"[^>]*>(<svg[\s\S]*?<\/svg>)/);
const art = id => VIGNETTES[id] || (id === 'arrival' ? { alt: cover[1], svg: cover[2] } : null);

// Joined pages, exactly as in tools/epub.js and the game: a one-button scene whose next scene has no other
// way in shares a section with it, the old button's words becoming an italic line between them.
const waysIn = {};
for (const id of ids) for (const c of STORY[id].choices || []) waysIn[c.next] = (waysIn[c.next] || 0) + 1;
const joinsNext = id => { const ch = STORY[id].choices; return ch && ch.length === 1 && waysIn[ch[0].next] === 1 ? ch[0].next : null; };
const chain = id => { const out = [id]; for (let n; (n = joinsNext(out.at(-1)));) out.push(n); return out; };
const joined = new Set(ids.map(joinsNext).filter(Boolean));
const heads = ids.filter(id => !joined.has(id));
const last = id => chain(id).at(-1);

// Section numbers, exactly as in tools/epub.js: 1 is the opening, the rest are shuffled, and no
// section leads to the very next number, so the next page never looks like the next part of your story.
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (const ch of seed) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = h << 13 | h >>> 19; }
  return () => {
    h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const order = ['arrival', ...heads.filter(id => id !== 'arrival')];
for (let i = order.length - 1; i > 1; i--) { const j = 1 + Math.floor(rand() * i); [order[i], order[j]] = [order[j], order[i]]; }
const leadsNext = o => o.findIndex((id, i) => i + 1 < o.length && (STORY[last(id)].choices || []).some(c => c.next === o[i + 1]));
for (let tries = 0, bad; (bad = leadsNext(order)) >= 0; tries++) {
  if (tries > 10000) throw new Error('Could not shuffle the sections');
  const a = bad + 1, b = 1 + Math.floor(rand() * (order.length - 1));
  [order[a], order[b]] = [order[b], order[a]];
}
const num = Object.fromEntries(order.map((id, i) => [id, i + 1]));
const parents = id => order.filter(p => (STORY[last(p)].choices || []).some(c => c.next === id));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const paras = list => (list || []).map(t => `<p>${esc(t)}</p>`).join('\n');
const stamp = c => c.stamp ? `<span class="stamp ${c.stamp}">${esc(c.stamp.toUpperCase())}</span>` : '';
// Choices show the label only; the hints stay in STORY but are not shown (user's request, 2026-10-14).
const link = (id, label, turn = 'Turn to') => `<a class="choice" href="#s${num[id]}"><span class="label">${label}</span><span class="turn">${turn} ${num[id]}</span></a>`;

function section(id) {
  const parts = chain(id), s = STORY[parts.at(-1)], n = num[id];
  const body = [`<section class="scene${s.hell ? ' hell' : s.space ? ' space' : ''}" id="s${n}">`, `<h1 class="number">Section ${n}</h1>`];
  parts.forEach((part, k) => {
    const p = STORY[part], pic = art(part);
    if (k) body.push(`<p class="join">${esc(STORY[parts[k - 1]].choices[0].label)}</p>`);
    if (pic) body.push(`<div class="art" role="img" aria-label="${esc(pic.alt)}">${pic.svg}</div>`);
    if (!k) body.push(`<p class="title">${esc(p.title)}</p>`);
    body.push(paras(p.text));
    if (p.ticket) body.push(`<div class="ticket">
<p><b>From:</b> ${esc(p.ticket.from)}</p>
<p><b>Subject:</b> ${esc(p.ticket.subject)}</p>
<p>${esc(p.ticket.body)}</p>
</div>`);
    body.push(paras(p.afterTicket));
  });
  if (s.finale) {
    body.push(`<p class="the-end">${esc(s.prompt || 'The end.')}</p>`,
      `<p class="ending-name">Ending: ${esc(s.name || s.title)}</p>`,
      `<p class="again"><a href="#s1">Start over at Section 1.</a></p>`);
  } else if (s.ending) {
    // A dead end sends you back to the choice you just made, like the game's "Try a different choice".
    body.push(`<p class="decision">${esc(s.prompt || 'Every ending is another beginning.')}</p>`,
      `<p class="ending-name">Dead end: ${esc(s.name || s.title)}</p>`,
      ...parents(id).map(p => link(p, 'Try a different choice.', 'Turn back to')));
  } else {
    body.push(`<p class="decision">${esc(s.prompt || 'What will you do?')}</p>`,
      ...s.choices.map(c => link(c.next, stamp(c) + esc(c.label))));
  }
  body.push('</section>');
  return body.join('\n');
}

const finales = ids.filter(id => STORY[id].finale);
const deadEnds = ids.filter(id => STORY[id].ending && !STORY[id].finale);
const words = n => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] || String(n);

const css = `@page { size: 6in 9in; margin: 0.6in 0.62in 0.6in; }
@page cover { margin: 0; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #182e2b; font: 10.5pt/1.42 Georgia, serif; }
a { color: inherit; }
p { margin: 0 0 0.6em; orphans: 2; widows: 2; }
section { break-before: page; }
.cover { page: cover; height: 9in; background: #193b37; display: flex; justify-content: center; }
.cover img { display: block; height: 9in; }
/* line-height 1 here made Chrome repeat every section's name in the PDF bookmarks ("Section 1Section 1"). */
.number { margin: 0 0 0.12in; text-align: center; font: bold 17pt/1.2 Georgia, serif; }
.hell .number { color: #a3291b; }
.space .number { color: #2b4b7a; }
.tight { font-size: 10pt; line-height: 1.36; }
.art { margin: 0 auto 0.16in; width: 66%; break-inside: avoid; }
.art svg { display: block; width: 100%; height: auto; border-radius: 10px; }
.title { margin: 0 0 0.4em; font-size: 15pt; line-height: 1.2; break-after: avoid; }
.ticket { margin: 0.9em 0; padding: 0.55em 0.85em 0.1em; border: 1px solid #d8ddd3; border-radius: 8px; background: #f4f3ed; font: 9.5pt/1.45 Arial, Helvetica, sans-serif; break-inside: avoid; }
.ticket p { margin: 0 0 0.45em; }
.decision { margin: 0.9em 0 0.45em; font-style: italic; color: #4c5a53; break-after: avoid; }
.join { margin: 1em 0; text-align: center; font-style: italic; color: #4c5a53; break-after: avoid; }
.choice { display: flex; justify-content: space-between; align-items: baseline; gap: 0.8em; margin: 0 0 0.35em; padding: 0.38em 0.7em; border: 1px solid #c3cbbf; border-radius: 8px; text-decoration: none; break-inside: avoid; }
.choice .label { font-weight: bold; }
.choice .turn { white-space: nowrap; font: bold 7.5pt Arial, Helvetica, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: #4f6b58; }
.stamp { display: inline-block; padding: 0 0.3em; border: 1.5px solid; border-radius: 3px; font: bold 7pt/1.5 Arial, Helvetica, sans-serif; letter-spacing: 0.12em; vertical-align: 1.5px; }
.choice .stamp { margin-right: 0.45em; }
.stamp.sin { color: #b3261e; }
.stamp.virtue { color: #2e7d4f; }
.the-end { margin: 1.4em 0 0.2em; text-align: center; font-size: 15pt; font-style: italic; }
.ending-name { margin: 0.6em 0 0.9em; text-align: center; font: bold 8pt Arial, Helvetica, sans-serif; letter-spacing: 0.15em; text-transform: uppercase; color: #69756e; }
.again { margin-top: 1.2em; text-align: center; }
.again a { display: inline-block; padding: 0.4em 1em; border: 1px solid #c3cbbf; border-radius: 8px; text-decoration: none; font-weight: bold; }
.title-page { display: flex; flex-direction: column; align-items: center; height: 7.75in; text-align: center; }
.kicker { margin-top: 1.1in; font: bold 8pt Arial, Helvetica, sans-serif; letter-spacing: 0.3em; text-transform: uppercase; color: #69756e; }
.book-title { margin: 0.15in 0 0.2in; font-size: 40pt; line-height: 1; letter-spacing: -0.02em; }
.book-title span { display: block; }
.book-title i { display: block; color: #557a34; }
.tagline { font-style: italic; }
.author { margin-top: 0.7in; font-size: 14pt; }
.copyright { margin-top: auto; margin-bottom: 0; font-size: 8.5pt; color: #69756e; }
.front h1 { margin: 0 0 0.3in; text-align: center; font: bold 10pt Arial, Helvetica, sans-serif; letter-spacing: 0.2em; font-variant-caps: all-small-caps; color: #69756e; }
.contents ul, .endings ul { margin: 0 0 1.4em; padding: 0; list-style: none; }
.contents li { margin: 0 0 0.5em; }
.numbers { display: grid; grid-template-columns: repeat(8, 1fr); gap: 0.32em; }
.numbers a { padding: 0.2em 0; border: 1px solid #d8ddd3; border-radius: 5px; text-align: center; text-decoration: none; font: 9pt/1.4 Arial, Helvetica, sans-serif; }
.endings li { margin: 0 0 0.55em; padding-left: 1.6em; position: relative; }
@media screen { body { width: 4.76in; } }
.endings li::before { content: ""; position: absolute; left: 0; top: 0.25em; width: 0.85em; height: 0.85em; border: 1.5px solid #69756e; border-radius: 2px; }
`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${TITLE}</title>
<style>
${css}</style>
</head>
<body>
<div class="cover"><img src="cover.jpg" alt="The cover: Keyboard Heist, a pick-your-path comedy by ${esc(AUTHOR)}."></div>

<section class="front title-page">
<p class="kicker">${esc(KICKER)}</p>
<p class="book-title"><span>Keyboard</span><i>Heist.</i></p>
<p class="tagline">Steal a keyboard just to feel something.</p>
<p class="author">${esc(AUTHOR)}</p>
<p class="copyright">Copyright © ${new Date().getFullYear()} ${esc(AUTHOR)}</p>
</section>

<section class="front how-to" id="how-to-read">
<h1>How to read this book</h1>
<p>Don’t read this book front to back. Start at Section 1.</p>
<p>At the end of each section, pick what you’ll do next. On a screen, click or tap your choice. On paper, turn to the section number it gives: every section starts on a new page with its number at the top.</p>
<p>The sections are shuffled on purpose. The page after a section is never the next part of your story, so follow your choice instead of turning the page. To undo a click, use your PDF reader’s Back button.</p>
<p>Some choices are stamped <span class="stamp sin">SIN</span> or <span class="stamp virtue">VIRTUE</span>. Pay attention to them.</p>
<p>Some paths reach a real ending: “The end.” Others hit a dead end, which sends you back to try a different choice. There are ${words(finales.length)} real endings and ${words(deadEnds.length)} dead ends.</p>
<p class="again"><a href="#s1">Begin at Section 1.</a></p>
</section>

<section class="front contents" id="contents">
<h1>Contents</h1>
<ul>
<li><a href="#how-to-read">How to read this book</a></li>
<li><a href="#s1">Section 1: start here</a></li>
<li><a href="#endings">The endings</a></li>
</ul>
<p>Every section, by number:</p>
<div class="numbers">${order.map(id => `<a href="#s${num[id]}">${num[id]}</a>`).join('')}</div>
</section>

${order.map(section).join('\n\n')}

<section class="front endings" id="endings">
<h1>The endings</h1>
<p>There are ${words(finales.length)} real endings. How many have you found?</p>
<ul>
${finales.map(id => `<li>${esc(STORY[id].name || STORY[id].title)}</li>`).join('\n')}
</ul>
<p class="again"><a href="#s1">Start over at Section 1.</a></p>
</section>
<script>
// A section too long for one page gets a smaller drawing, so few sections spill onto a second page.
// The screen width above matches the printed text width, so this measures the printed layout.
const PAGE = 7.7 * 96;
for (const s of document.querySelectorAll('.scene')) {
  const pics = [...s.querySelectorAll('.art')];
  for (let w = 60; pics.length && s.offsetHeight > PAGE && w >= 40; w -= 5) pics.forEach(pic => { pic.style.width = w + '%'; });
  if (s.offsetHeight > PAGE) s.classList.add('tight');
  // Still too long: it runs onto a second page anyway, so give it back its full-size drawings and text.
  if (s.offsetHeight > PAGE) { s.classList.remove('tight'); pics.forEach(pic => { pic.style.width = ''; }); }
}
</script>
</body>
</html>
`;

// Lay it out and print it with a headless browser. The drawings stay vector, frozen on their first frame.
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(fs.existsSync);
if (!browser) throw new Error('Needs Google Chrome or Microsoft Edge to lay out the pages');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-pdf-'));
fs.writeFileSync(path.join(work, 'book.html'), page);
fs.copyFileSync(path.join(root, 'book/kindle-cover.jpg'), path.join(work, 'cover.jpg'));
fs.rmSync(out, { force: true });
const p = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(work, 'profile'),
  '--no-pdf-header-footer', '--generate-pdf-document-outline', '--print-to-pdf=' + out, 'file://' + path.join(work, 'book.html')], { stdio: 'ignore' });
p.on('exit', () => {
  fs.rmSync(work, { recursive: true, force: true });
  if (!fs.existsSync(out)) { console.error('The browser did not write ' + out); process.exit(1); }
  console.log(`Wrote ${out}: ${order.length} sections, ${ids.filter(art).length} pictures, ${finales.length} endings, ${deadEnds.length} dead ends.`);
});

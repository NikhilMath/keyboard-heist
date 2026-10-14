// Builds the Kindle eBook (EPUB 3) of the whole story from STORY and VIGNETTES in index.html.
// Run from the repo root (needs node, Google Chrome or Microsoft Edge to draw the pictures, and /usr/bin/zip):
//   node tools/epub.js ~/Downloads/Keyboard-Heist.epub
// The book is a gamebook: one numbered section per scene, each on its own page, every choice a link
// that also says "Turn to N". Section 1 is the opening; the rest are shuffled with a fixed seed, so
// rebuilding the same story gives the same numbers. Never commit the .epub: it spoils every scene.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn, execFileSync } = require('child_process');

const out = path.resolve(process.argv[2] || 'Keyboard-Heist.epub');
const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const TITLE = 'Keyboard Heist';
const AUTHOR = 'Nikhil Math';
const AUTHOR_SORT = 'Math, Nikhil';
const KICKER = 'A pick-your-path comedy';
const BOOK_ID = 'urn:uuid:5e4da200-4fde-472d-bde6-2060e9ed6c02'; // keep: KDP and readers track the book by it
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

// Section numbers: 1 is the opening, the rest are shuffled. No section may lead to the very next
// number, so a reader who swipes forward instead of tapping a choice never lands on a scene that fits.
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (const ch of seed) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = h << 13 | h >>> 19; }
  return () => {
    h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const order = ['arrival', ...ids.filter(id => id !== 'arrival')];
for (let i = order.length - 1; i > 1; i--) { const j = 1 + Math.floor(rand() * i); [order[i], order[j]] = [order[j], order[i]]; }
const leadsNext = o => o.findIndex((id, i) => i + 1 < o.length && (STORY[id].choices || []).some(c => c.next === o[i + 1]));
for (let tries = 0, bad; (bad = leadsNext(order)) >= 0; tries++) {
  if (tries > 10000) throw new Error('Could not shuffle the sections');
  const a = bad + 1, b = 1 + Math.floor(rand() * (order.length - 1));
  [order[a], order[b]] = [order[b], order[a]];
}
const num = Object.fromEntries(order.map((id, i) => [id, i + 1]));
const file = id => 'section-' + String(num[id]).padStart(3, '0') + '.xhtml';
const parents = id => order.filter(p => (STORY[p].choices || []).some(c => c.next === id));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const page = (title, body, type = '') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body${type ? ` epub:type="${type}"` : ''}>
${body}
</body>
</html>
`;
const paras = list => (list || []).map(t => `<p>${esc(t)}</p>`).join('\n');
const stamp = c => c.stamp ? `<span class="stamp">${esc(c.stamp.toUpperCase())}</span> ` : '';
const link = (id, label, hint, pre = '') => `<div class="choice">
<p class="choice-label">${pre}<a href="${file(id)}">${esc(label)} <span class="turn">Turn to ${num[id]}.</span></a></p>
${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
</div>`;

function section(id) {
  const s = STORY[id], n = num[id], pic = art(id);
  const body = [`<section class="scene" epub:type="chapter" id="s${n}">`, `<h1 class="number">Section ${n}</h1>`];
  if (pic) body.push(`<div class="art"><img src="../images/${id}.png" alt="${esc(pic.alt)}"/></div>`);
  body.push(`<h2 class="title">${esc(s.title)}</h2>`, paras(s.text));
  if (s.ticket) body.push(`<div class="ticket">
<p><b>From:</b> ${esc(s.ticket.from)}</p>
<p><b>Subject:</b> ${esc(s.ticket.subject)}</p>
<p>${esc(s.ticket.body)}</p>
</div>`);
  body.push(paras(s.afterTicket));
  if (s.finale) {
    body.push(`<p class="the-end">${esc(s.prompt || 'The end.')}</p>`,
      `<p class="ending-name">Ending: ${esc(s.name || s.title)}</p>`,
      `<p class="again"><a href="${file('arrival')}">Start over at Section 1.</a></p>`);
  } else if (s.ending) {
    // A dead end sends you back to the choice you just made, like the game's "Try a different choice".
    const back = parents(id);
    body.push(`<p class="decision">${esc(s.prompt || 'Every ending is another beginning.')}</p>`,
      `<p class="ending-name">Dead end: ${esc(s.name || s.title)}</p>`,
      `<div class="choice"><p class="choice-label">Try a different choice. ${back.map(p => `<a href="${file(p)}">Turn back to ${num[p]}.</a>`).join(' Or ')}</p>
<p class="hint">Go back to the last choice you made.</p></div>`);
  } else {
    body.push(`<p class="decision">${esc(s.prompt || 'What will you do?')}</p>`,
      ...s.choices.map(c => link(c.next, c.label, c.hint, stamp(c))));
  }
  body.push('</section>');
  return page('Section ' + n, body.join('\n'), 'bodymatter');
}

const finales = ids.filter(id => STORY[id].finale);
const deadEnds = ids.filter(id => STORY[id].ending && !STORY[id].finale);
const words = n => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] || String(n);

const titlePage = page(TITLE, `<section class="title-page" epub:type="titlepage">
<p class="kicker">${esc(KICKER)}</p>
<h1 class="book-title">Keyboard <i>Heist.</i></h1>
<p class="tagline">Steal a keyboard just to feel something.</p>
<p class="author">${esc(AUTHOR)}</p>
<p class="copyright">Copyright © ${new Date().getFullYear()} ${esc(AUTHOR)}</p>
</section>`, 'frontmatter');

const howTo = page('How to read this book', `<section class="how-to" epub:type="preface">
<h1 class="number">How to read this book</h1>
<p>Don’t read this book front to back. Start at Section 1.</p>
<p>At the end of each section, pick what you’ll do next and tap it. Every choice also gives its section number, so you can find it in the table of contents if a tap misses.</p>
<p>The sections are shuffled on purpose. The page after a section is never the next part of your story, so tap a choice instead of turning the page. To undo a tap, use your reader’s Back button.</p>
<p>Some choices are stamped SIN or VIRTUE. Pay attention to them.</p>
<p>Some paths reach a real ending: “The end.” Others hit a dead end, which sends you back to try a different choice. There are ${words(finales.length)} real endings and ${words(deadEnds.length)} dead ends.</p>
<p class="again"><a href="${file('arrival')}">Begin at Section 1.</a></p>
</section>`, 'frontmatter');

const endingsPage = page('The endings', `<section class="endings" epub:type="backmatter">
<h1 class="number">The endings</h1>
<p>There are ${words(finales.length)} real endings. How many have you found?</p>
<ul>
${finales.map(id => `<li>${esc(STORY[id].name || STORY[id].title)}</li>`).join('\n')}
</ul>
<p class="again"><a href="${file('arrival')}">Start over at Section 1.</a></p>
</section>`, 'backmatter');

const css = `body { margin: 0; }
p { margin: 0 0 0.8em; text-indent: 0; line-height: 1.5; }
h1, h2 { font-weight: normal; line-height: 1.2; page-break-after: avoid; }
h1.number { text-align: center; font-size: 1.1em; letter-spacing: 0.15em; text-transform: uppercase; margin: 1em 0 1em; }
h2.title { font-size: 1.5em; margin: 0.8em 0 0.8em; }
.art { text-align: center; margin: 0 0 0.5em; page-break-inside: avoid; }
.art img { width: 100%; height: auto; }
.ticket { border: 1px solid #888; padding: 0.6em 0.9em; margin: 1em 0; }
.ticket p { margin: 0 0 0.4em; }
.decision { margin-top: 1.6em; font-style: italic; }
.choice { margin: 1em 0 0; page-break-inside: avoid; }
.choice-label { font-weight: bold; margin: 0; }
.turn { font-weight: normal; white-space: nowrap; }
.hint { font-style: italic; font-size: 0.9em; margin: 0.2em 0 0; }
.stamp { font-size: 0.75em; letter-spacing: 0.1em; border: 1px solid; padding: 0 0.3em; }
.the-end { margin-top: 1.6em; text-align: center; font-size: 1.3em; font-style: italic; }
.ending-name { text-align: center; font-size: 0.85em; letter-spacing: 0.1em; text-transform: uppercase; }
.again { text-align: center; margin-top: 1.4em; }
.title-page { text-align: center; padding-top: 15%; }
.kicker { font-size: 0.8em; letter-spacing: 0.2em; text-transform: uppercase; }
.book-title { font-size: 2.6em; font-weight: bold; margin: 0.3em 0 0.4em; }
.tagline { font-style: italic; }
.author { font-size: 1.2em; margin-top: 3em; }
.copyright { font-size: 0.8em; margin-top: 5em; }
.endings ul { margin: 1em 0; }
.endings li { margin: 0 0 0.4em; }
`;

// Draw every picture with a headless browser, a few at a time. Each SVG keeps its 480x320 frame at 2.5x.
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(fs.existsSync);
if (!browser) throw new Error('Needs Google Chrome or Microsoft Edge to draw the pictures');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-epub-'));
const draw = id => new Promise((done, fail) => {
  const src = path.join(work, 'draw', id + '.html'), png = path.join(work, 'OEBPS', 'images', id + '.png');
  fs.writeFileSync(src, '<!doctype html><style>html,body{margin:0}svg{display:block;width:480px;height:320px}</style>' + art(id).svg);
  const p = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--user-data-dir=' + path.join(work, 'profile-' + id),
    '--window-size=480,320', '--force-device-scale-factor=2.5', '--screenshot=' + png, 'file://' + src], { stdio: 'ignore' });
  p.on('exit', () => fs.existsSync(png) ? done() : fail(new Error('No picture for ' + id)));
});

(async () => {
  for (const dir of ['META-INF', 'OEBPS/text', 'OEBPS/images', 'draw']) fs.mkdirSync(path.join(work, dir), { recursive: true });
  const pictures = order.filter(art);
  for (let i = 0; i < pictures.length; i += 6) await Promise.all(pictures.slice(i, i + 6).map(draw));
  fs.copyFileSync(path.join(root, 'book/kindle-cover.jpg'), path.join(work, 'OEBPS/images/cover.jpg'));

  const w = (f, text) => fs.writeFileSync(path.join(work, f), text);
  w('mimetype', 'application/epub+zip');
  w('META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
  w('OEBPS/style.css', css);
  w('OEBPS/text/title.xhtml', titlePage);
  w('OEBPS/text/how-to-read.xhtml', howTo);
  w('OEBPS/text/endings.xhtml', endingsPage);
  for (const id of order) w('OEBPS/text/' + file(id), section(id));

  // Table of contents: a short top level, with every section number nested under "Sections".
  const toc = [['text/title.xhtml', 'Title page'], ['text/how-to-read.xhtml', 'How to read this book'], ['text/' + file('arrival'), 'Sections'], ['text/endings.xhtml', 'The endings']];
  const sections = order.map(id => ['text/' + file(id), 'Section ' + num[id]]);
  w('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>Contents</h1>
<ol>
${toc.map(([href, label]) => `<li><a href="${href}">${label}</a>${label === 'Sections' ? `
<ol>
${sections.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('\n')}
</ol>` : ''}</li>`).join('\n')}
</ol>
</nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden"><h1>Landmarks</h1>
<ol>
<li><a epub:type="titlepage" href="text/title.xhtml">Title page</a></li>
<li><a epub:type="bodymatter" href="text/how-to-read.xhtml">How to read this book</a></li>
</ol>
</nav>
</body>
</html>
`);
  let play = 0;
  const point = ([href, label], kids = '') => `<navPoint id="p${++play}" playOrder="${play}"><navLabel><text>${label}</text></navLabel><content src="${href}"/>${kids}</navPoint>`;
  w('OEBPS/toc.ncx', `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="en">
<head><meta name="dtb:uid" content="${BOOK_ID}"/><meta name="dtb:depth" content="2"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${TITLE}</text></docTitle>
<navMap>
${toc.map(t => t[1] === 'Sections' ? point(t, '\n' + sections.map(s => point([s[0], s[1]])).join('\n') + '\n') : point(t)).join('\n')}
</navMap>
</ncx>
`);

  const spine = ['title', 'how-to-read', ...order.map(id => file(id).replace('.xhtml', '')), 'endings'];
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  w('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${BOOK_ID}</dc:identifier>
<dc:title>${TITLE}</dc:title>
<dc:creator id="author">${AUTHOR}</dc:creator>
<meta refines="#author" property="role" scheme="marc:relators">aut</meta>
<meta refines="#author" property="file-as">${AUTHOR_SORT}</meta>
<dc:language>en</dc:language>
<dc:date>${modified.slice(0, 10)}</dc:date>
<dc:description>${esc(html.match(/<meta name="description" content="([^"]*)"/)[1])}</dc:description>
<meta property="dcterms:modified">${modified}</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
${order.filter(art).map(id => `<item id="img-${id}" href="images/${id}.png" media-type="image/png"/>`).join('\n')}
${spine.map(f => `<item id="${f}" href="text/${f}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${spine.map(f => `<itemref idref="${f}"/>`).join('\n')}
</spine>
</package>
`);

  // EPUB rule: "mimetype" goes first and uncompressed.
  fs.rmSync(path.join(work, 'draw'), { recursive: true });
  for (const d of fs.readdirSync(work)) if (d.startsWith('profile-')) fs.rmSync(path.join(work, d), { recursive: true, force: true });
  fs.rmSync(out, { force: true });
  execFileSync('/usr/bin/zip', ['-X0q', out, 'mimetype'], { cwd: work });
  execFileSync('/usr/bin/zip', ['-X9rq', out, 'META-INF', 'OEBPS'], { cwd: work });
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`Wrote ${out}: ${order.length} sections, ${pictures.length} pictures, ${finales.length} endings, ${deadEnds.length} dead ends.`);
})().catch(e => { console.error(e.message); process.exit(1); });

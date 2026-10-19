// Builds the paperback cover for KDP (user's request, 2026-10-18): book/paperback-cover.pdf, one sheet holding the
// back cover, the spine and the front cover, with 0.125 in bleed on every side.
// Run from the repo root after `node tools/pdf.js --paperback`, since the spine width comes from the interior's page count
// (needs node, and Google Chrome or Microsoft Edge):
//   node tools/paperback-cover.js
// The front copies the Kindle cover's design (book/kindle-cover.html) at 6x9. The back-cover words live in book/back-cover.txt,
// one paragraph per blank line: the first is set large as the lead, the last as the closing line.
// The spine is left plain: at 84 pages it is under 0.2 in, too thin for readable spine text.
// KDP prints the ISBN barcode itself, in the lower right of the back cover, so that corner stays empty.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = process.cwd();
const out = path.resolve(process.argv[2] || 'book/paperback-cover.pdf');

const PER_PAGE = 0.002252; // spine inches per page for KDP's standard color on white paper (the user's choice); cream is 0.0025, premium color 0.002347
const TRIM_W = 6, TRIM_H = 9, BLEED = 0.125;
const AUTHOR = 'Nikhil Math';

const interior = fs.readFileSync(path.join(root, 'book/keyboard-heist-paperback.pdf'), 'latin1');
const pages = (interior.match(/\/Type\s*\/Page\b/g) || []).length;
const spine = pages * PER_PAGE;
const W = BLEED + TRIM_W + spine + TRIM_W + BLEED, H = BLEED + TRIM_H + BLEED;

const svg = fs.readFileSync(path.join(root, 'book/kindle-cover.html'), 'utf8').match(/<svg[\s\S]*?<\/svg>/)[0];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const words = fs.readFileSync(path.join(root, 'book/back-cover.txt'), 'utf8').trim().split(/\n\s*\n/).map(p => esc(p.replace(/\s+/g, ' ')));
const lead = words.shift(), closing = words.pop();

// The front's sizes are the Kindle cover's pixels (1600x2560) scaled so its 2560 px height becomes the 9 in trim.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Keyboard Heist: paperback cover</title>
<style>
@page { size: ${W}in ${H}in; margin: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; width: ${W}in; height: ${H}in; overflow: hidden; position: relative; background: #193b37; color: #f2f0e6; font-family: Georgia, serif; }
.panel { position: absolute; top: ${BLEED}in; width: ${TRIM_W}in; height: ${TRIM_H}in; }
.back { left: ${BLEED}in; padding: 0.8in 0.65in 0; box-sizing: border-box; }
.front { left: ${BLEED + TRIM_W + spine}in; --k: calc(${TRIM_H}in / 2560); display: flex; flex-direction: column; align-items: center; }
.kicker { margin-top: calc(230 * var(--k)); font: bold calc(46 * var(--k)) Arial, Helvetica, sans-serif; letter-spacing: calc(14 * var(--k)); color: #c4d4c4; }
h1 { margin: calc(70 * var(--k)) 0 0; font-size: calc(280 * var(--k)); line-height: 1; letter-spacing: calc(-8 * var(--k)); text-align: center; }
h1 span { display: block; }
h1 em { display: block; color: #d8eeaa; margin-top: calc(10 * var(--k)); }
.tagline { margin-top: calc(90 * var(--k)); font-style: italic; font-size: calc(68 * var(--k)); }
.art { margin-top: calc(170 * var(--k)); width: calc(1260 * var(--k)); }
.art svg { display: block; width: 100%; height: auto; }
.caption { margin-top: calc(10 * var(--k)); font: bold calc(30 * var(--k)) Arial, Helvetica, sans-serif; letter-spacing: calc(10 * var(--k)); color: #829788; }
.author { margin-top: auto; margin-bottom: calc(200 * var(--k)); font-size: calc(84 * var(--k)); letter-spacing: calc(2 * var(--k)); }
.back .lead { margin: 0 0 0.22in; font-size: 15pt; line-height: 1.35; font-style: italic; color: #d8eeaa; }
.back p { margin: 0 0 0.13in; font-size: 11pt; line-height: 1.5; }
.back .closing { margin-top: 0.3in; font-size: 14pt; font-style: italic; color: #d8eeaa; }
.back .byline { position: absolute; left: 0.65in; bottom: 0.65in; font: bold 7.5pt Arial, Helvetica, sans-serif; letter-spacing: 0.2em; color: #829788; }
</style>
</head>
<body>
<section class="panel back">
<p class="lead">${lead}</p>
${words.map(p => `<p>${p}</p>`).join('\n')}
<p class="closing">${closing}</p>
<p class="byline">KEYBOARD HEIST · ${esc(AUTHOR.toUpperCase())}</p>
</section>
<section class="panel front">
<div class="kicker">A PICK-YOUR-PATH COMEDY</div>
<h1><span>Keyboard</span><em>Heist.</em></h1>
<div class="tagline">Steal a keyboard just to feel something.</div>
<div class="art">${svg}</div>
<div class="caption">COMPANY PROPERTY</div>
<div class="author">${esc(AUTHOR)}</div>
</section>
</body>
</html>
`;

const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(fs.existsSync);
if (!browser) throw new Error('Needs Google Chrome or Microsoft Edge to print the cover');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-cover-'));
fs.writeFileSync(path.join(work, 'cover.html'), page);
fs.rmSync(out, { force: true });
const p = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(work, 'profile'),
  '--no-pdf-header-footer', '--print-to-pdf=' + out, 'file://' + path.join(work, 'cover.html')], { stdio: 'ignore' });
p.on('exit', () => {
  fs.rmSync(work, { recursive: true, force: true });
  if (!fs.existsSync(out)) { console.error('The browser did not write ' + out); process.exit(1); }
  // Chrome only makes page widths in steps of about 0.013 in (12.439 in comes out 12.443), and KDP checks the cover's size.
  // So set the page box to the exact width, writing the number at the same length so the PDF's byte offsets stay valid.
  // It trims a sliver of plain bleed off the right edge; everything is laid out from the left, so the trim lines don't move.
  const want = W * 72;
  const pdf = fs.readFileSync(out, 'latin1').replace(/(\/(?:Media|Crop)Box\s*\[\s*0 0 )([0-9.]+)/g, (m, pre, w) => {
    const exact = want.toFixed(Math.max(0, w.length - String(Math.floor(want)).length - 1));
    return exact.length === w.length && Math.abs(+w - want) < 2 ? pre + exact : m;
  });
  fs.writeFileSync(out, pdf, 'latin1');
  console.log(`Wrote ${out}: ${W.toFixed(3)} x ${H.toFixed(3)} in for ${pages} interior pages, spine ${spine.toFixed(3)} in.`);
});

// Route check: walks every route from the opening to every ending and checks the story's structure and continuity rules.
// Run from the repo root:  node tools/routes.js   (or: osascript -l JavaScript tools/routes.js)
// It reads index.html only and changes nothing. See "Verification expectations" in AGENTS.md.

const isJXA = typeof ObjC !== 'undefined';
if (isJXA) { ObjC.import('Foundation'); ObjC.import('stdlib'); }
function read(file) {
  if (isJXA) return $.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, null).js;
  return require('fs').readFileSync(file, 'utf8');
}
function quit(code) { if (isJXA) $.exit(code); else process.exit(code); }
const root = isJXA ? $.NSFileManager.defaultManager.currentDirectoryPath.js : process.cwd();
const html = read(root + '/index.html');

// Cut the STORY object literal out of the script by matching braces (skipping strings), as tools/lock.js does.
const start = html.indexOf('const STORY = ') + 'const STORY = '.length;
let depth = 0, i = start;
for (;; i++) {
  const c = html[i];
  if (c === '"') { i++; while (html[i] !== '"') { if (html[i] === '\\') i++; i++; } continue; }
  if (c === '{') depth++;
  else if (c === '}' && --depth === 0) break;
}
const S = JSON.parse(html.slice(start, i + 1));
const ids = Object.keys(S);
const block = html.slice(html.indexOf('const VIGNETTES={'));
const drawings = new Set(block.slice(0, block.indexOf('\n};')).split('\n').slice(1).map(l => (l.match(/^ ([a-z0-9_]+):\{/) || [])[1]).filter(Boolean));
const errors = [];
const seenKinds = new Set();
const err = (m, route) => { if (seenKinds.has(m)) return; seenKinds.add(m); errors.push(route ? m + ', first on ' + route : m); };

// Scene shape.
for (const id of ids) {
  const n = S[id];
  for (const c of n.choices || []) if (!S[c.next]) err(id + ' -> missing scene ' + c.next);
  if (n.ending && (n.choices || []).length) err(id + ' is an ending with choices');
  if (!n.ending && !n.checkpoint && !(n.choices || []).length) err(id + ' has no way out');
  if (n.ending && !n.name) err(id + ' is an ending without a name');
  if (id !== 'arrival' && !drawings.has(id)) err(id + ' has no drawing');
}

// Words a reader sees: titles, text, tickets, prompts, labels (hints are hidden, but checked too).
const words = id => { const n = S[id]; return [n.title, n.prompt, ...(n.text || []), ...(n.ticket ? [n.ticket.from, n.ticket.subject, n.ticket.body] : []), ...(n.afterTicket || []), ...(n.choices || []).map(c => c.label)].filter(Boolean).join(' \n '); };
for (const id of ids) {
  const n = S[id];
  for (const t of [words(id), n.name || '', ...(n.choices || []).map(c => c.hint || '')]) {
    if (/[\u2014\u2013]/.test(t)) err(id + ': em or en dash');
    if (/['"]/.test(t)) err(id + ': straight quote');
    if (/outlook/i.test(t)) err(id + ': says Outlook');
    if ((t.match(/“/g) || []).length !== (t.match(/”/g) || []).length) err(id + ': unbalanced quotes');
    const dbl = t.match(/\b(\w+) \1\b/i); if (dbl) err(id + ': doubled word "' + dbl[0] + '"');
  }
}

// Things that need an introduction earlier on the same route (or in the same scene, before the name).
// [what, pattern that names it, scenes that may introduce it, or a test on the scene's words]
const intro = [
  ['the keyboard heist', /keyboard|decoy/i, ['office']],
  ['Marcy', /Marcy/, id => /Marcy, Daniel’s assistant|His assistant, Marcy/.test(words(id))],
  ['Mrs. Cox', /Mrs\. Cox/, ['grandmother']],
  ['the decoy', /decoy/i, ['plan']],
  ['Jordan', /Jordan/, ['end_speech']],
  ['Danal', /Danal|Xeon/, ['wizard']],
  ['the auditor', /auditor/, ['swap', 'end_red']],
  ['the nice demon', /nice demon/, ['hell_orientation']],
  ['the moon rock', /moon rock/i, ['mom_lands']],
  ['the space keyboard', /Artemis|the capsule/, ['moon_rock']],
];

// Walk every route.
const HELL_START = 'end_running', SPACE_START = 'mom_lands';
let routes = 0;
const endings = {}, records = {};
const reach = new Set();
function stamps(p) { let s = ''; const k = p.indexOf('choice'); if (k < 0) return s; for (let j = k; j < p.length - 1; j++) { const c = S[p[j]].choices.find(c => c.next === p[j + 1]); if (c.stamp) s += c.stamp === 'sin' ? 'S' : 'V'; } return s; }
function walk(id, p) {
  if (p.includes(id)) { err('cycle: ' + p.concat(id).join(' > ')); return; }
  const route = p.concat(id);
  reach.add(id);
  const n = S[id];
  // Introductions.
  for (const [what, pat, by] of intro) {
    if (!pat.test(words(id))) continue;
    const ok = route.slice(0, -1).some(x => typeof by === 'function' ? by(x) : by.includes(x)) || (typeof by === 'function' ? by(id) : by.includes(id));
    if (!ok) err(what + ' comes up in ' + id + ' before it is set up', route.join(' > '));
  }
  // Hell and space flags: everything after end_running is Hell until it comes back up to lie; everything after end_mom is space.
  const h = route.indexOf(HELL_START), back = route.lastIndexOf('lie');
  const inHell = h >= 0 && route.length - 1 >= h && !(back > h);
  if (!!n.hell !== inHell) err(id + (inHell ? ' should' : ' should not') + ' set hell: true', route.join(' > '));
  const inSpace = route.includes(SPACE_START);
  if (!!n.space !== inSpace) err(id + (inSpace ? ' should' : ' should not') + ' set space: true');
  if (n.ending) {
    routes++; endings[id] = (endings[id] || 0) + 1;
    if (n.hell) (records[id] = records[id] || new Set()).add(stamps(route));
    return;
  }
  for (const c of n.choices || []) walk(c.next, route);
}
walk('arrival', []);
for (const id of ids) if (!reach.has(id)) err('unreachable: ' + id);

// Hell records: two stamps to get in, then one ladder (see the Hell branch bullet in AGENTS.md).
const expect = { hell_job: ['SSSSSS'], hell_plateau: ['SSSV', 'SSSSV', 'SSSSSV'], hell_lost: ['SSVS', 'SSVVS', 'SSVVVS'], hell_own_keyboard: ['SSVVVV'], hell_upstairs: ['SV'] };
for (const [id, want] of Object.entries(expect)) {
  const got = [...(records[id] || [])].sort();
  if (got.join() !== [...want].sort().join()) err(id + ' records are ' + got.join(', ') + ', expected ' + want.join(', '));
}

// Joined pages (display only): a one-button scene whose next scene has no other way in.
const ways = {}; for (const id of ids) for (const c of S[id].choices || []) ways[c.next] = (ways[c.next] || 0) + 1;
const joins = ids.filter(id => (S[id].choices || []).length === 1 && ways[S[id].choices[0].next] === 1);

const real = ids.filter(id => S[id].finale), dead = ids.filter(id => S[id].ending && !S[id].finale);
console.log(ids.length + ' scenes, ' + drawings.size + ' drawings, ' + ids.filter(id => S[id].hell).length + ' in Hell, ' + ids.filter(id => S[id].space).length + ' in space');
console.log(real.length + ' real endings, ' + dead.length + ' dead ends, ' + routes + ' routes, ' + joins.length + ' joins, ' + (ids.length - joins.length) + ' pages');
console.log('Multi-parent scenes: ' + ids.filter(id => ways[id] > 1).map(id => id + ' (' + ways[id] + ')').join(', '));
if (errors.length) { console.log('Route check: ' + errors.length + ' problem(s)'); errors.forEach(e => console.log('  ' + e)); quit(1); }
console.log('Route check: OK');

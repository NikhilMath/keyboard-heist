// Story lock (user's direction, 2026-10-13): you can add to the story, but you cannot change it.
// Allowed: new scenes, new drawings for new scenes, new paragraphs at the end of a scene's text,
// and new choices after a scene's existing choices. Anything already locked must stay exactly as it is.
// Only the user can unlock a change, by saying so in chat. See "Story lock" at the top of AGENTS.md.
// Run from the repo root before every commit:
//   osascript -l JavaScript tools/lock.js            (or: node tools/lock.js)
// Only after the user has unlocked something in chat and the change is done:
//   osascript -l JavaScript tools/lock.js relock     accepts the new version of the scenes already locked
//   osascript -l JavaScript tools/lock.js lock-all   locks everything in the story as it is now
// Never relock a change the user did not unlock.

const isJXA = typeof ObjC !== 'undefined';
if (isJXA) { ObjC.import('Foundation'); ObjC.import('stdlib'); }

function read(file) {
  if (isJXA) return $.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, null).js;
  return require('fs').readFileSync(file, 'utf8');
}
function write(file, text) {
  if (isJXA) return $(text).writeToFileAtomicallyEncodingError(file, true, $.NSUTF8StringEncoding, null);
  require('fs').writeFileSync(file, text);
}
function quit(code) { if (isJXA) $.exit(code); else process.exit(code); }

const root = isJXA ? $.NSFileManager.defaultManager.currentDirectoryPath.js : process.cwd();
const args = isJXA ? ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments) : process.argv;
const mode = args.includes('relock') ? 'relock' : args.includes('lock-all') ? 'lock-all' : 'check';
const html = read(root + '/index.html');

// Cut the STORY object literal out of the script by matching braces (skipping strings), as tools/branches.js does.
const start = html.indexOf('const STORY = ') + 'const STORY = '.length;
let depth = 0, i = start;
for (;; i++) {
  const c = html[i];
  if (c === '"') { i++; while (html[i] !== '"') { if (html[i] === '\\') i++; i++; } continue; }
  if (c === '{') depth++;
  else if (c === '}' && --depth === 0) break;
}
const STORY = JSON.parse(html.slice(start, i + 1));

// Each drawing is one line inside VIGNETTES: " id:{alt:'...',svg:'...'},".
const drawings = {};
const block = html.slice(html.indexOf('const VIGNETTES={'));
for (const line of block.slice(0, block.indexOf('\n};')).split('\n').slice(1)) {
  const m = line.match(/^ ([a-z0-9_]+):(\{.*\}),?$/);
  if (m) drawings[m[1]] = m[2];
}

// A 53-bit string hash (cyrb53) over JSON with sorted keys, so reordering keys in the source is not a change.
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let k = 0; k < str.length; k++) {
    const ch = str.charCodeAt(k);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
// A scene is fingerprinted in three parts: each paragraph, each choice, and everything else (title, flags, ticket...).
function print(scene) {
  const rest = {};
  for (const k of Object.keys(scene)) if (k !== 'text' && k !== 'choices') rest[k] = scene[k];
  return { rest: hash(stable(rest)), text: scene.text.map(p => hash(stable(p))), choices: (scene.choices || []).map(c => hash(stable(c))) };
}
const now = {
  scenes: Object.fromEntries(Object.keys(STORY).map(id => [id, print(STORY[id])])),
  drawings: Object.fromEntries(Object.keys(drawings).map(id => [id, hash(drawings[id])]))
};

const lockFile = root + '/story-lock.json';
let lock = null;
try { lock = JSON.parse(read(lockFile)); } catch (e) { lock = null; }
const today = new Date().toISOString().slice(0, 10);
const about = 'Fingerprints of the locked story. You can add to it (new scenes, new paragraphs at the end of a scene, new choices after its existing ones) but not change it. Only the user can unlock a change, by saying so in chat. See "Story lock" in AGENTS.md. Rewrite this file only with tools/lock.js relock or lock-all.';

if (mode !== 'check') {
  const next = { about, lockedOn: lock ? lock.lockedOn : today, updated: today, scenes: {}, drawings: {} };
  for (const kind of ['scenes', 'drawings']) {
    const ids = mode === 'lock-all' || !lock ? Object.keys(now[kind]) : Object.keys(lock[kind]).filter(id => id in now[kind]);
    for (const id of ids) next[kind][id] = now[kind][id];
  }
  write(lockFile, JSON.stringify(next, null, 2) + '\n');
  console.log(`Story lock: ${mode} wrote ${Object.keys(next.scenes).length} scenes and ${Object.keys(next.drawings).length} drawings to story-lock.json.`);
  quit(0);
}

if (!lock) { console.log('Story lock: BROKEN. story-lock.json is missing or unreadable.'); quit(1); }
const same = (was, is) => was.every((h, k) => h === is[k]);
const problems = [], added = [];
for (const id of Object.keys(lock.scenes)) {
  const was = lock.scenes[id], is = now.scenes[id];
  if (!is) { problems.push(`scene ${id} was removed`); continue; }
  if (was.rest !== is.rest) problems.push(`scene ${id}: its title, ticket, flags or other details changed`);
  if (!same(was.text, is.text)) problems.push(`scene ${id}: a locked paragraph was changed, moved or removed`);
  else if (is.text.length > was.text.length) added.push(`${is.text.length - was.text.length} paragraph(s) at the end of ${id}`);
  if (STORY[id].ending && is.choices.length) problems.push(`scene ${id} is an ending, so it cannot get choices`);
  else if (!same(was.choices, is.choices)) problems.push(`scene ${id}: a locked choice was changed, moved or removed`);
  else if (is.choices.length > was.choices.length) added.push(`${is.choices.length - was.choices.length} choice(s) on ${id}`);
}
for (const id of Object.keys(now.scenes)) if (!(id in lock.scenes)) added.push(`new scene ${id}`);
for (const id of Object.keys(lock.drawings)) {
  if (!(id in now.drawings)) problems.push(`drawing ${id} was removed`);
  else if (now.drawings[id] !== lock.drawings[id]) problems.push(`drawing ${id} was changed`);
}
for (const id of Object.keys(now.drawings)) if (!(id in lock.drawings)) added.push(`new drawing ${id}`);

if (added.length) console.log('Added since the lock (allowed): ' + added.join(', ') + '.');
if (problems.length) {
  console.log('Story lock: BROKEN. ' + problems.join('; ') + '. Undo it unless the user unlocked exactly this in chat.');
  quit(1);
}
console.log(`Story lock: OK. Nothing in the ${Object.keys(lock.scenes).length} locked scenes or ${Object.keys(lock.drawings).length} locked drawings has changed.`);

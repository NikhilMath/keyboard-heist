# Keyboard Heist

A short choose-your-own-adventure office comedy that you play in your browser.

You're an IT Support Manager stuck on a dull plateau. A printer ticket takes you to the CEO's office, and his perfectly ordinary keyboard feels wonderful. Buying your own won't do. You have to steal his.

**Play it:** https://keyboardheist.com

## How to play

- Read each scene, then pick one of the choices underneath it.
- Some choices lead to a **real ending** ("The end."). Others lead to a **dead end**, which sends you back to your last choice so you can try again.
- Some choices are stamped **SIN** or **VIRTUE**. Pay attention to them.
- **Your map** shows every branch you've found. Click any dot to jump back to that scene.
- **Your journey** lists the scenes on your current path. Click one to go back to it.
- Your progress saves in your browser. **Start over and do NOT clear history** restarts the story but keeps everything you've found. **Start over AND clear history** wipes it all.

## Run it on your own computer

There's nothing to install. Download the repository and open `index.html` in any modern browser.

If your browser won't save progress from a local file, start a small local server from the project folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## What's in this repository

| File | What it is |
| --- | --- |
| `index.html` | The whole game: the page, the story, and the code that runs it |
| `styles.css` | How the game looks |
| `favicon.svg`, `favicon.png`, `apple-touch-icon.png` | Browser and phone icons |
| `og-image.jpg` | The preview image shown when the link is shared |
| `book/kindle-cover.jpg`, `book/kindle-cover.html` | The Kindle eBook cover (1600x2560) and the page it was made from |
| `BRANCHES.md` | A flowchart of every branch plus the full story text (**spoilers**) |
| `story-map.txt`, `spine-draft.txt` | Planning notes from writing the story |
| `tools/branches.js` | Rebuilds `BRANCHES.md` from the story |
| `story-lock.json`, `tools/lock.js` | The story is locked: you can add to it, but not change it. A fingerprint of every scene, and the check |
| `AGENTS.md` | Instructions for AI assistants that work on this project |

## Help and contact

- **Questions or bugs:** see [SUPPORT.md](SUPPORT.md).
- **Security issues:** see [SECURITY.md](SECURITY.md). Please don't open a public issue.
- **Community rules:** see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- **Owner:** Nikhil Math ([@NikhilMath](https://github.com/NikhilMath), [nikhilmath.com](https://nikhilmath.com)).

## License

MIT. See [LICENSE](LICENSE).

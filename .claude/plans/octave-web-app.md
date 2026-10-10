# octaveHelper: Octave notebook on the web
Progress: 11/20 (55%)
Started: 2026-10-09 23:40 BRT   Updated: 2026-10-10 02:05 BRT

## Goal

A static page at `vanioantunes.com/tools/octaveHelper/` where someone opens a
MATLAB `.m` script, edits it as notebook cells, runs it with real Octave in their
own browser, sees output and plots, and downloads a `.m` file MATLAB opens
without complaint. No server, no account, no upload.

Done means: a plot renders in the browser from a `plot(1:10)` cell, and a
downloaded `.m` from a notebook containing Octave-only syntax has that syntax
converted, verified by screenshot at desktop and phone width.

## Decisions taken with the operator

- `.m` script code, edited as notebook cells, each cell run on its own.
- Octave in-browser via WebAssembly. Plots required in v1.
- Own repo + own Vercel project, proxied like ssHelper. Name: octaveHelper.
- Save produces a plain `.m` download, after an Octave-to-MATLAB cleanup pass.
- Engine lazy-loads on first Run behind a progress bar; any size accepted.

## Steps

- [x] 1. Confirm a real WASM Octave exists: xeus-octave 0.6.2 on emscripten-forge, pulls octave 10.3.0 (91MB) + plotly
- [x] 2. Probe local toolchain: node 25, python 3.14, gh 2.88; no conda/pixi/global pip
- [x] 3. Windows build attempt - fails, Octave packages carry symlinks Windows will not create
- [x] 4. Find a Linux path: WSL Ubuntu present, docker daemon down
- [x] 5. `scripts/bootstrap.sh` - repo-local micromamba + host python env, no sudo, no apt
- [x] 6. `scripts/build.sh` - fails loudly when the kernel dir is absent
- [x] 7. `src/matlabify.js` - the Octave-to-MATLAB conversion, string- and comment-aware
- [x] 8. `test/matlabify.test.mjs` - 19 tests, all passing
- [x] 9. First successful kernel build: kernel 150M, `_site` 238M, jupyterlab-plotly copied in
- [x] 10. `scripts/smoke.mjs` - `disp(A * A)` prints `7 10 / 15 22` in a dedicated browser, 11.4s
- [x] 11. `plot(1:10, (1:10).^2)` renders a plotly figure, 12.5s - the v1 gate, confirmed by screenshot
- [~] 11b. Shrink the payload: `no_sourcemaps` + `no_unused_shared_packages` set, not yet rebuilt
- [ ] 12. Decide whether stdin needs COOP/COEP headers; set them in `vercel.json` only if so
- [ ] 13. JupyterLab toolbar extension: "Save as .m (MATLAB)" calling `cellsToScript` (w=3)
- [ ] 14. "Open .m" - upload a script, split on `%%` into cells (w=2)
- [ ] 15. Conversion-notes panel: line number, rule, what changed or why it could not
- [ ] 16. Brand the shell to Warm Editorial: title, favicon, accent, remove Jupyter chrome (w=2)
- [ ] 17. CI: build on ubuntu, deploy `_site` to Vercel, since the output is too big to commit (w=2)
- [ ] 18. Site repo: tool card, subnav entry in 4 pages, two `vercel.json` rewrites
- [ ] 19. Screenshots at desktop and phone width, WCAG 2.2 AA pass

## Notes

- Windows build failure is `critical libmamba Can't create ... bin/mkoctfile`. Not
  path length: those three files are symlinks. Linux or WSL only.
- Build must run in a WSL-native directory. Over `/mnt/c` it is far too slow.
- `cleanUrls` is off in this repo's `vercel.json`: JupyterLite references real
  `index.html` paths and clean URLs break them.
- Open tension: cells share one Octave workspace, so running out of order can
  show a transcript the saved top-to-bottom `.m` would not reproduce. Save
  concatenates in document order; step 15 should also mark stale cells.
- `title("squares")` did not draw a title on the plotly figure. The curve, axes
  and ticks are all correct, so this is a gap in the plotly toolkit's mapping,
  not a broken graphics path. Worth checking which figure properties survive.
- The repl app logs `Plugin '@jupyterlab/codemirror-extension:commands' failed
  to activate. No provider for: @jupyterlab/notebook:INotebookTracker`. Harmless
  in the repl, which has no notebook, but confirm it is absent in the lab app.

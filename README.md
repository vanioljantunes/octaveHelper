# octaveHelper

Edit and run MATLAB and Octave scripts in a browser, then save them back as `.m`
files MATLAB will open without complaint. Nothing is uploaded: the Octave that
runs the code is compiled to WebAssembly and runs on the reader's own machine.

Live at `vanioantunes.com/tools/octaveHelper/`, proxied from this repo's own
Vercel deployment.

## What it is made of

GNU Octave 10.3 compiled to WebAssembly, driven by the
[xeus-octave](https://github.com/jupyter-xeus/xeus-octave) Jupyter kernel and
served through [JupyterLite](https://jupyterlite.readthedocs.io/), so the whole
thing is static files. Plots render through the kernel's plotly toolkit.

On top of that sits the part this repo actually writes: `src/matlabify.mjs`,
which turns Octave-flavoured source into source MATLAB accepts, and reports
every difference it could not fix safely.

## The conversion

`matlabify()` rewrites what MATLAB rejects outright:

| Octave | MATLAB |
|---|---|
| `# comment`, `#{ ... #}` | `% comment`, `%{ ... %}` |
| `endif`, `endfor`, `endwhile`, `endfunction`, `end_try_catch` | `end` |
| `a != b` | `a ~= b` |
| `!done` | `~done` |
| `i++`, `i--` | `i = i + 1`, `i = i - 1` |
| `x += v` (and `-=`, `*=`, `/=`, `^=`) | `x = x + v` |
| `printf(...)`, `puts(...)` | `fprintf(...)` |

It never rewrites anything that would change what the code does. Those come
back as notes against a line number instead: `unwind_protect`, Octave-only
functions such as `rows()` and `columns()`, backslash escapes inside
double-quoted strings, shell-escape lines, and functions sitting before
executable code in a script.

Rewrites skip the inside of strings and comments, and a `'` after an
identifier, digit or closing bracket is read as transpose rather than as the
start of a char literal, so `b = A' * x;` and `msg = 'a != b';` both survive
untouched.

Run the tests with `npm test`.

## Building

The build must run on Linux or WSL. The Octave conda packages contain symlinks
(`bin/mkoctfile`, `lib/libz.so`, `bin/python`) and Windows refuses to create
them without elevation, so the solver step fails on a native Windows run with
`Cannot find a valid extracted directory cache`.

```bash
bash scripts/bootstrap.sh   # once per machine: micromamba + a host python env
bash scripts/build.sh       # writes _site/
```

`environment.yml` pins what goes into the browser; `jupyter_lite_config.json`
points JupyterLite at it. Both the toolchain and `_site/` are gitignored, so the
site is built in CI rather than committed.

## Known limitations

`title()` does not draw. The plotly toolkit is the only graphics toolkit in the
WebAssembly build, and it does not map the axes title into the figure.
`xlabel()` and `ylabel()` do render, as do the curve, axes and ticks, so this is
one missing property rather than a broken graphics path. Until it is fixed
upstream, put the heading in a markdown cell above the plot.

Octave's `input()` and other prompts that read from stdin need
`SharedArrayBuffer`, which needs the `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` headers. They are not set, so treat scripts as
non-interactive.

## Weight

The page and editor load on their own. Octave itself is roughly 90MB of
WebAssembly and arrives only when someone runs a cell, behind a progress bar,
and is cached afterwards.

## Licence

GPL-3.0-only, following Octave and xeus-octave.

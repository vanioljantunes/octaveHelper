// Two buttons on the notebook toolbar:
//
//   Open .m    read a MATLAB script, split it on %% into cells
//   Save .m    write the notebook back out as a script MATLAB accepts
//
// The conversion itself lives in <repo>/src/matlabify.js, which is plain
// JavaScript so `node --test` can exercise it with no build step.
import { ToolbarButton, showDialog, Dialog } from '@jupyterlab/apputils';
import { INotebookTracker } from '@jupyterlab/notebook';
import { DisposableDelegate } from '@lumino/disposable';
import { Widget } from '@lumino/widgets';
// Plain JS module, compiled in via allowJs; see tsconfig.json
import { cellsToScript, toFileText } from '../../src/matlabify.js';
/** Read the notebook's cells in document order. */
function readCells(panel) {
    const model = panel.content.model;
    if (!model)
        return [];
    const cells = [];
    for (let i = 0; i < model.cells.length; i++) {
        const cell = model.cells.get(i);
        if (cell.type === 'raw')
            continue;
        cells.push({
            type: cell.type === 'markdown' ? 'markdown' : 'code',
            source: cell.sharedModel.getSource(),
        });
    }
    return cells;
}
/** Hand the browser a file to save. */
function download(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick, once the click has certainly been handled.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
/** Build the body of the conversion report shown after a save. */
function reportBody(notes) {
    const wrap = document.createElement('div');
    wrap.className = 'oh-report';
    if (!notes.length) {
        const p = document.createElement('p');
        p.textContent = 'Nothing needed changing. The script was already MATLAB-compatible.';
        wrap.appendChild(p);
        return new Widget({ node: wrap });
    }
    const changed = notes.filter((n) => n.kind === 'changed');
    const manual = notes.filter((n) => n.kind === 'manual');
    const section = (title, items, cls) => {
        if (!items.length)
            return;
        const h = document.createElement('p');
        h.className = 'oh-report__heading';
        h.textContent = title;
        wrap.appendChild(h);
        const ul = document.createElement('ul');
        ul.className = `oh-report__list ${cls}`;
        // One entry per rule per line, in line order.
        const seen = new Set();
        items.forEach((n) => {
            const key = `${n.line}:${n.rule}`;
            if (seen.has(key))
                return;
            seen.add(key);
            const li = document.createElement('li');
            const where = document.createElement('span');
            where.className = 'oh-report__line';
            where.textContent = `line ${n.line}`;
            li.appendChild(where);
            li.appendChild(document.createTextNode(` ${n.message}`));
            ul.appendChild(li);
        });
        wrap.appendChild(ul);
    };
    section(`${manual.length} to check by hand`, manual, 'oh-report__list--manual');
    section(`${changed.length} converted automatically`, changed, 'oh-report__list--changed');
    return new Widget({ node: wrap });
}
/** Split a .m script into cells on its %% section markers. */
export function scriptToCells(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const cells = [];
    let current = [];
    const flush = () => {
        const body = current.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
        if (body)
            cells.push({ type: 'code', source: body });
        current = [];
    };
    lines.forEach((line) => {
        if (/^\s*%%/.test(line)) {
            flush();
        }
        current.push(line);
    });
    flush();
    // A script with no %% markers becomes one cell rather than none.
    if (!cells.length && text.trim()) {
        cells.push({ type: 'code', source: text.replace(/\r\n/g, '\n').trim() });
    }
    return cells;
}
/** Replace the notebook's contents with these cells. */
function writeCells(panel, cells) {
    const model = panel.content.model;
    if (!model)
        return;
    model.sharedModel.transact(() => {
        model.sharedModel.deleteCellRange(0, model.cells.length);
        model.sharedModel.insertCells(0, cells.map((c) => ({ cell_type: c.type, source: c.source, metadata: {} })));
    });
}
class ToolbarButtons {
    createNew(panel) {
        const save = new ToolbarButton({
            className: 'oh-save-m',
            label: 'Save .m',
            tooltip: 'Download this notebook as a MATLAB-friendly .m script',
            onClick: () => {
                const cells = readCells(panel);
                const title = panel.title.label.replace(/\.ipynb$/, '');
                const { code, notes } = cellsToScript(cells, { title });
                const base = title.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, 'm$1') || 'script';
                download(`${base}.m`, toFileText(code));
                void showDialog({
                    title: 'Saved as MATLAB',
                    body: reportBody(notes),
                    buttons: [Dialog.okButton({ label: 'Close' })],
                });
            },
        });
        const open = new ToolbarButton({
            className: 'oh-open-m',
            label: 'Open .m',
            tooltip: 'Replace this notebook with the contents of a .m script',
            onClick: () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.m,text/plain';
                input.onchange = async () => {
                    const file = input.files && input.files[0];
                    if (!file)
                        return;
                    const text = await file.text();
                    const cells = scriptToCells(text);
                    const confirmed = await showDialog({
                        title: 'Replace the notebook?',
                        body: `${file.name} becomes ${cells.length} cell${cells.length === 1 ? '' : 's'}. Everything currently in this notebook is discarded.`,
                        buttons: [Dialog.cancelButton(), Dialog.warnButton({ label: 'Replace' })],
                    });
                    if (!confirmed.button.accept)
                        return;
                    writeCells(panel, cells);
                };
                input.click();
            },
        });
        panel.toolbar.insertItem(10, 'openMatlab', open);
        panel.toolbar.insertItem(11, 'saveMatlab', save);
        return new DisposableDelegate(() => {
            open.dispose();
            save.dispose();
        });
    }
}
const plugin = {
    id: 'octavehelper-matlab-export:plugin',
    description: 'Open and save MATLAB .m scripts from an Octave notebook',
    autoStart: true,
    requires: [INotebookTracker],
    activate: (app) => {
        app.docRegistry.addWidgetExtension('Notebook', new ToolbarButtons());
    },
};
export default plugin;
//# sourceMappingURL=index.js.map
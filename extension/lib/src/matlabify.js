// Convert Octave-flavoured source into source MATLAB will accept.
//
// Every rule here is a syntax difference that MATLAB rejects outright or
// silently misreads. Rules that would change behaviour are reported, never
// applied. The caller shows the report next to the download button.
//
// The converter is deliberately line-oriented and string-aware rather than a
// parser: Octave's grammar is large, and a half-built parser fails in ways that
// are harder to see than a conservative rewrite that says what it skipped.
/**
 * @typedef {object} Note
 * @property {number} line    1-based line number in the input
 * @property {string} rule    identifier of the rule that fired
 * @property {string} message what changed, or why nothing could change
 * @property {'changed'|'manual'} kind
 */
/**
 * Split a line into runs of code and runs of literal text, so rewrites never
 * touch the inside of a string. Handles the doubled-quote escape ('' and "")
 * and Octave's backslash escapes inside double quotes.
 *
 * A single quote only opens a string where a value cannot already be present;
 * after an identifier, a digit, a closing bracket or another transpose it is
 * the transpose operator.
 *
 * @param {string} line
 * @returns {{text: string, code: boolean}[]}
 */
function segment(line) {
    const out = [];
    let buf = '';
    let i = 0;
    const pushCode = () => {
        if (buf)
            out.push({ text: buf, code: true });
        buf = '';
    };
    while (i < line.length) {
        const ch = line[i];
        // Comment to end of line. The `%{` and `#{` block markers are handled by
        // the caller, which tracks block state across lines.
        if (ch === '%' || ch === '#') {
            pushCode();
            out.push({ text: line.slice(i), code: false });
            return out;
        }
        if (ch === '"' || (ch === "'" && !transposeContext(buf))) {
            pushCode();
            const quote = ch;
            let lit = quote;
            i += 1;
            while (i < line.length) {
                const c = line[i];
                if (quote === '"' && c === '\\' && i + 1 < line.length) {
                    lit += c + line[i + 1];
                    i += 2;
                    continue;
                }
                if (c === quote) {
                    if (line[i + 1] === quote) {
                        lit += c + c;
                        i += 2;
                        continue;
                    }
                    lit += c;
                    i += 1;
                    break;
                }
                lit += c;
                i += 1;
            }
            out.push({ text: lit, code: false });
            continue;
        }
        buf += ch;
        i += 1;
    }
    pushCode();
    return out;
}
/**
 * True when a quote following this code run is the transpose operator rather
 * than the start of a char literal.
 *
 * @param {string} before code seen so far on this line
 */
function transposeContext(before) {
    if (!before)
        return false;
    // Trailing whitespace means a new term is starting, so a quote opens a
    // string even after an identifier.
    if (/\s$/.test(before))
        return false;
    return /[A-Za-z0-9_)\]}.']$/.test(before);
}
/** Apply a rewrite to code segments only, counting hits. */
function onCode(segments, fn) {
    let hits = 0;
    const text = segments
        .map((seg) => {
        if (!seg.code)
            return seg.text;
        const { text: next, count } = fn(seg.text);
        hits += count;
        return next;
    })
        .join('');
    return { text, hits };
}
/** Replace with a regex, reporting how many times it fired. */
function sub(text, pattern, replacement) {
    let count = 0;
    const next = text.replace(pattern, (...args) => {
        count += 1;
        return typeof replacement === 'function' ? replacement(...args) : replacement;
    });
    return { text: next, count };
}
const BLOCK_ENDS = [
    'endif',
    'endwhile',
    'endfor',
    'endfunction',
    'endswitch',
    'end_try_catch',
    'end_unwind_protect',
    'endparfor',
    'endclassdef',
    'endproperties',
    'endmethods',
    'endevents',
    'endenumeration',
];
const OCTAVE_ONLY = [
    ['rows', 'size(x, 1)'],
    ['columns', 'size(x, 2)'],
    ['isrow_vector', 'isrow'],
    ['iscolumn_vector', 'iscolumn'],
    ['strsplit_quoted', 'strsplit'],
    ['index', 'strfind'],
    ['rindex', 'strfind, taking the last hit'],
    ['do_string_escapes', 'sprintf'],
    ['undo_string_escapes', 'regexprep'],
];
/**
 * Convert one document.
 *
 * @param {string} source
 * @returns {{code: string, notes: Note[]}}
 */
export function matlabify(source) {
    const notes = [];
    const lines = source.split(/\r?\n/);
    const out = [];
    let inBlockComment = false;
    lines.forEach((raw, index) => {
        const lineNo = index + 1;
        const note = (rule, message, kind = 'changed') => notes.push({ line: lineNo, rule, message, kind });
        // Block comments: Octave accepts #{ ... #}, MATLAB only %{ ... %}.
        const blockOpen = /^\s*[#%]\{\s*$/.test(raw);
        const blockClose = /^\s*[#%]\}\s*$/.test(raw);
        if (blockOpen || blockClose) {
            const converted = raw.replace('#', '%');
            if (converted !== raw)
                note('block-comment', 'block comment marker # to %');
            inBlockComment = blockOpen;
            out.push(converted);
            return;
        }
        if (inBlockComment) {
            out.push(raw);
            return;
        }
        // A whole-line or trailing # comment becomes %.
        let line = segment(raw)
            .map((seg) => {
            if (seg.code || !seg.text.startsWith('#'))
                return seg.text;
            note('comment', 'comment marker # to %');
            return '%' + seg.text.slice(1);
        })
            .join('');
        const apply = (fn) => {
            const res = onCode(segment(line), fn);
            line = res.text;
            return res.hits;
        };
        // A leading ! is a shell escape, not a negation. Say so and leave it.
        const shellEscape = /^\s*!/.test(line);
        if (shellEscape) {
            note('shell-escape', 'line starts with ! (shell escape); MATLAB uses system(...)', 'manual');
        }
        // endif / endfor / endwhile / ... all become a bare end.
        BLOCK_ENDS.forEach((kw) => {
            if (apply((code) => sub(code, new RegExp(`\\b${kw}\\b`, 'g'), 'end'))) {
                note('block-end', `${kw} to end`);
            }
        });
        if (/\bunwind_protect\b/.test(line)) {
            note('unwind-protect', 'unwind_protect has no MATLAB form; use try/catch with the cleanup duplicated, or onCleanup', 'manual');
        }
        // Comparison and negation. != must run before the bare ! rule.
        if (apply((code) => sub(code, /!=/g, '~=')))
            note('not-equal', '!= to ~=');
        if (!shellEscape) {
            if (apply((code) => sub(code, /!(?=[\s(A-Za-z0-9_~])/g, '~')))
                note('not', '! to ~');
        }
        // Increment and compound assignment do not exist in MATLAB.
        if (apply((code) => sub(code, /([A-Za-z_]\w*(?:\([^()]*\))?)\s*\+\+\s*;?/g, (m, lhs) => `${lhs} = ${lhs} + 1;`))) {
            note('increment', 'x++ to x = x + 1');
        }
        if (apply((code) => sub(code, /([A-Za-z_]\w*(?:\([^()]*\))?)\s*--\s*;?/g, (m, lhs) => `${lhs} = ${lhs} - 1;`))) {
            note('decrement', 'x-- to x = x - 1');
        }
        ['+', '-', '*', '/', '^'].forEach((op) => {
            const esc = op.replace(/[.*+^$?()[\]{}|\\]/g, '\\$&');
            const hit = apply((code) => sub(code, new RegExp(`([A-Za-z_]\\w*(?:\\([^()]*\\))?)\\s*${esc}=\\s*`, 'g'), (m, lhs) => `${lhs} = ${lhs} ${op} `));
            if (hit)
                note('compound-assign', `x ${op}= v to x = x ${op} v`);
        });
        // printf writes to stdout; MATLAB has no printf.
        if (apply((code) => sub(code, /\bdisp\s*\(\s*sprintf\s*\(/g, 'fprintf('))) {
            note('disp-sprintf', 'disp(sprintf(...)) to fprintf(...); drop one closing paren');
        }
        if (apply((code) => sub(code, /\bprintf\s*\(/g, 'fprintf(')))
            note('printf', 'printf to fprintf');
        if (apply((code) => sub(code, /\bputs\s*\(/g, 'fprintf('))) {
            note('puts', 'puts to fprintf; no trailing newline is added');
        }
        // Octave-only functions with no MATLAB counterpart.
        OCTAVE_ONLY.forEach(([name, hint]) => {
            if (new RegExp(`\\b${name}\\s*\\(`).test(line)) {
                note('octave-only', `${name}() is Octave-only; in MATLAB use ${hint}`, 'manual');
            }
        });
        // Double-quoted strings differ: Octave expands backslash escapes, MATLAB
        // takes them literally. Only worth saying when an escape is actually there.
        segment(line).forEach((seg) => {
            if (seg.code)
                return;
            if (seg.text.startsWith('"') && /\\[nrtab0\\"]/.test(seg.text)) {
                note('double-quote-escape', 'double-quoted string holds a backslash escape; Octave expands it, MATLAB does not. Wrap it in sprintf().', 'manual');
            }
        });
        // MATLAB requires every function after all executable code in a script.
        if (/^\s*function\b/.test(line)) {
            note('function-position', 'MATLAB wants functions at the end of a script, after all other code', 'manual');
        }
        out.push(line);
    });
    return { code: out.join('\n'), notes };
}
/**
 * Assemble notebook cells into one script in document order, then convert.
 *
 * Cells become `%%` sections so MATLAB's editor shows the same divisions and
 * can run them one at a time. Markdown cells become comment blocks, which keeps
 * the prose without making the file unrunnable.
 *
 * @param {{type: 'code'|'markdown', source: string}[]} cells
 * @param {{title?: string}} [meta]
 */
export function cellsToScript(cells, meta = {}) {
    const parts = [];
    if (meta.title) {
        parts.push(`%% ${meta.title}`);
        parts.push('');
    }
    cells.forEach((cell, index) => {
        const body = cell.source.replace(/\s+$/, '');
        if (!body)
            return;
        if (cell.type === 'markdown') {
            parts.push(`%% ${firstLine(body)}`);
            body.split(/\r?\n/).forEach((l) => parts.push(`% ${l}`.replace(/\s+$/, '')));
        }
        else {
            parts.push(`%% Cell ${index + 1}`);
            parts.push(body);
        }
        parts.push('');
    });
    return matlabify(parts.join('\n'));
}
function firstLine(text) {
    const line = text.split(/\r?\n/)[0] || '';
    return line.replace(/^#+\s*/, '').trim() || 'Notes';
}
/** MATLAB on Windows expects CRLF; keep the file tidy for every editor. */
export function toFileText(code) {
    return code.replace(/\r?\n/g, '\r\n').replace(/\r\n$/, '') + '\r\n';
}
//# sourceMappingURL=matlabify.js.map
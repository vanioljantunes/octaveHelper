/**
 * Convert one document.
 *
 * @param {string} source
 * @returns {{code: string, notes: Note[]}}
 */
export function matlabify(source: string): {
    code: string;
    notes: Note[];
};
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
export function cellsToScript(cells: {
    type: "code" | "markdown";
    source: string;
}[], meta?: {
    title?: string;
} | undefined): {
    code: string;
    notes: Note[];
};
/** MATLAB on Windows expects CRLF; keep the file tidy for every editor. */
export function toFileText(code: any): string;
export type Note = {
    /**
     * 1-based line number in the input
     */
    line: number;
    /**
     * identifier of the rule that fired
     */
    rule: string;
    /**
     * what changed, or why nothing could change
     */
    message: string;
    kind: "changed" | "manual";
};

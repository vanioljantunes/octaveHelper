import { JupyterFrontEndPlugin } from '@jupyterlab/application';
interface Cell {
    type: 'code' | 'markdown';
    source: string;
}
/** Split a .m script into cells on its %% section markers. */
export declare function scriptToCells(text: string): Cell[];
declare const plugin: JupyterFrontEndPlugin<void>;
export default plugin;

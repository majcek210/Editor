import { Compartment, EditorSelection, EditorState, type Extension, type Transaction } from '@codemirror/state';
import {
  EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { darkPlus } from './theme';
import { bracketColors } from './bracketColors';
import { indentGuides } from './indentGuides';

export interface EditorPrefs {
  fontSize: number;
  softWrap: boolean;
  tabSize: number;
}

export const languageConf = new Compartment();
export const wrapConf = new Compartment();
export const fontConf = new Compartment();
export const tabConf = new Compartment();

export function fontTheme(size: number): Extension {
  return EditorView.theme({ '&': { fontSize: `${size}px` } });
}

export function tabExtensions(size: number): Extension {
  return [EditorState.tabSize.of(size), indentUnit.of(' '.repeat(size))];
}

/** True when a transaction came from the user (typing, deleting, pasting, undo...). */
export function isUserEdit(tr: Transaction): boolean {
  return tr.docChanged && ['input', 'delete', 'undo', 'redo', 'move'].some((e) => tr.isUserEvent(e));
}

export function createState(doc: string, language: Extension, prefs: EditorPrefs, extra: Extension = []): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter({ openText: '⌄', closedText: '›' }),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      bracketColors(),
      indentGuides(),
      darkPlus,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      languageConf.of(language),
      wrapConf.of(prefs.softWrap ? EditorView.lineWrapping : []),
      fontConf.of(fontTheme(prefs.fontSize)),
      tabConf.of(tabExtensions(prefs.tabSize)),
      extra,
    ],
  });
}

/** Inserts text at every cursor as a user edit (used by the keyboard toolbar). */
export function insertText(view: EditorView, text: string, cursorOffset = text.length): void {
  view.dispatch(
    view.state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.cursor(range.from + cursorOffset),
    })),
    { userEvent: 'input.type', scrollIntoView: true },
  );
  view.focus();
}

export function goToLine(view: EditorView, line: number, col = 1): void {
  const doc = view.state.doc;
  const l = doc.line(Math.min(Math.max(1, line), doc.lines));
  const pos = Math.min(l.from + Math.max(0, col - 1), l.to);
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  view.focus();
}

export { undo, redo };

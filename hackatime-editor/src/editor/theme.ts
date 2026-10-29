import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** VS Code Dark+ editor colors. */
export const darkPlusTheme = EditorView.theme(
  {
    '&': { color: '#d4d4d4', backgroundColor: '#1e1e1e', height: '100%' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.5' },
    '.cm-content': { caretColor: '#aeafad', paddingBottom: '40vh' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#aeafad', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#264f78' },
    '.cm-activeLine': { backgroundColor: 'transparent', boxShadow: 'inset 0 0 0 1px #282828' },
    '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#858585', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c6c6c6' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px', minWidth: '32px' },
    '.cm-foldPlaceholder': { backgroundColor: '#3a3d41', border: 'none', color: '#d4d4d4' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(0,100,0,0.1)', outline: '1px solid #888888' },
    '.cm-nonmatchingBracket': { color: '#ff1212' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(173,214,255,0.15)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(234,92,0,0.33)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#515c6a', outline: '1px solid #74879f' },
    '.cm-tooltip': { backgroundColor: '#252526', border: '1px solid #454545', color: '#cccccc' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#04395e', color: '#ffffff' },
    '.cm-panels': { backgroundColor: '#252526', color: '#cccccc' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid #454545' },
  },
  { dark: true },
);

export const darkPlusHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.definitionKeyword, t.operatorKeyword], color: '#569cd6' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#c586c0' },
  { tag: [t.string, t.special(t.string), t.character], color: '#ce9178' },
  { tag: [t.regexp], color: '#d16969' },
  { tag: [t.escape], color: '#d7ba7d' },
  { tag: [t.number, t.integer, t.float], color: '#b5cea8' },
  { tag: [t.bool, t.null, t.atom, t.self], color: '#569cd6' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#6a9955' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#dcdcaa' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: '#4ec9b0' },
  { tag: [t.variableName, t.propertyName, t.attributeName, t.labelName], color: '#9cdcfe' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: '#4fc1ff' },
  { tag: [t.definition(t.variableName)], color: '#9cdcfe' },
  { tag: [t.tagName], color: '#569cd6' },
  { tag: [t.angleBracket], color: '#808080' },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: '#c586c0' },
  { tag: [t.operator, t.punctuation, t.separator], color: '#d4d4d4' },
  { tag: [t.heading], color: '#569cd6', fontWeight: 'bold' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: 'bold', color: '#569cd6' },
  { tag: [t.link, t.url], color: '#3794ff', textDecoration: 'underline' },
  { tag: [t.quote], color: '#6a9955' },
  { tag: [t.monospace], color: '#ce9178' },
  { tag: [t.inserted], color: '#b5cea8' },
  { tag: [t.deleted], color: '#ce9178' },
  { tag: [t.invalid], color: '#f44747' },
]);

export const darkPlus = [darkPlusTheme, syntaxHighlighting(darkPlusHighlight)];

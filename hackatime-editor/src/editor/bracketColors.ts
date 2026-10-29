import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

/** Bracket pair colorization in the VS Code Dark+ colors. */
const COLORS = 3;
const MAX_DOC = 400_000;
const SKIP = /String|Comment|Regexp|Template|Char/;
const OPEN = '([{';
const CLOSE = ')]}';
const marks = Array.from({ length: COLORS }, (_, i) => Decoration.mark({ class: `cm-bracket-${i}` }));

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  if (state.doc.length > MAX_DOC) return builder.finish();
  const tree = syntaxTree(state);
  const end = view.visibleRanges.length ? view.visibleRanges[view.visibleRanges.length - 1].to : 0;
  const ranges = view.visibleRanges;
  let depth = 0;
  let ri = 0;
  const text = state.doc.sliceString(0, end);
  for (let pos = 0; pos < text.length; pos++) {
    const ch = text[pos];
    const isOpen = OPEN.includes(ch);
    const isClose = !isOpen && CLOSE.includes(ch);
    if (!isOpen && !isClose) continue;
    const node = tree.resolveInner(pos, 1);
    if (SKIP.test(node.name) || (node.parent && SKIP.test(node.parent.name))) continue;
    if (isClose) depth = Math.max(0, depth - 1);
    while (ri < ranges.length && ranges[ri].to <= pos) ri++;
    if (ri < ranges.length && pos >= ranges[ri].from) builder.add(pos, pos + 1, marks[depth % COLORS]);
    if (isOpen) depth++;
  }
  return builder.finish();
}

export function bracketColors(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
            this.decorations = build(u.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.baseTheme({
      '.cm-bracket-0, .cm-bracket-0 > span': { color: '#ffd700 !important' },
      '.cm-bracket-1, .cm-bracket-1 > span': { color: '#da70d6 !important' },
      '.cm-bracket-2, .cm-bracket-2 > span': { color: '#179fff !important' },
    }),
  ];
}

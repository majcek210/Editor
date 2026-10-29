import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { getIndentUnit } from '@codemirror/language';

/** Vertical indent guides drawn on the leading whitespace of each line. */
const guide = Decoration.mark({ class: 'cm-indent-guide' });

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const unit = Math.max(1, getIndentUnit(view.state));
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      let col = 0;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch !== ' ' && ch !== '\t') break;
        if (col % unit === 0 && i < text.length - 1) builder.add(line.from + i, line.from + i + 1, guide);
        col += ch === '\t' ? unit - (col % unit) : 1;
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export function indentGuides(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.baseTheme({
      '.cm-indent-guide': { boxShadow: 'inset 1px 0 0 #404040' },
    }),
  ];
}

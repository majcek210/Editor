import type { EditorPlugin } from '../core/plugins';

/** Example plugin built on the internal interface: word count in the status bar. */
export const wordCountPlugin: EditorPlugin = {
  id: 'builtin.wordCount',
  activate(ctx) {
    const item = ctx.addStatusItem({ title: 'Word count' });
    const show = (f: { text: string; language: string } | null) => {
      if (!f || (f.language !== 'Markdown' && f.language !== 'Text')) return item.setText('');
      const words = f.text.trim() ? f.text.trim().split(/\s+/).length : 0;
      item.setText(`${words} words`);
    };
    ctx.onActiveFileChange(show);
    ctx.onDocumentChange(show);
  },
};

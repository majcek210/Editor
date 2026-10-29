/**
 * Small internal plugin interface so features can be added later. It is not
 * compatible with VS Code extensions. The Hackatime tracker is deliberately
 * not a plugin: plugins get no access to it or to the native CLI.
 */
import type { CommandRegistry } from './commands';

export interface StatusItem {
  setText(text: string): void;
  dispose(): void;
}

export interface ActiveFileInfo {
  name: string;
  language: string;
  text: string;
}

export interface PluginContext {
  commands: CommandRegistry;
  addStatusItem(options: { title?: string; onClick?: () => void }): StatusItem;
  onActiveFileChange(fn: (file: ActiveFileInfo | null) => void): () => void;
  onDocumentChange(fn: (file: ActiveFileInfo) => void): () => void;
}

export interface EditorPlugin {
  id: string;
  activate(ctx: PluginContext): void | Promise<void>;
}

export async function activatePlugins(plugins: EditorPlugin[], ctx: PluginContext): Promise<void> {
  for (const p of plugins) {
    try {
      await p.activate(ctx);
    } catch (e) {
      console.error(`plugin ${p.id} failed to activate`, e);
    }
  }
}

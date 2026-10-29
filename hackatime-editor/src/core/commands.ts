export interface Command {
  id: string;
  title: string;
  /** Shown in the palette, for example "Ctrl+S". */
  keybinding?: string;
  run: () => unknown | Promise<unknown>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(cmd: Command): () => void {
    if (this.commands.has(cmd.id)) throw new Error(`command ${cmd.id} already registered`);
    this.commands.set(cmd.id, cmd);
    return () => this.commands.delete(cmd.id);
  }

  list(): Command[] {
    return [...this.commands.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  async run(id: string): Promise<void> {
    const c = this.commands.get(id);
    if (!c) throw new Error(`unknown command ${id}`);
    await c.run();
  }
}

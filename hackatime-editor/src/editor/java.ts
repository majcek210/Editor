/**
 * Java support beyond syntax highlighting: completion (keywords, common JDK
 * and modding types with automatic imports, project classes, snippets),
 * a symbol outline, a project class index, package inference and templates.
 * Everything is local and offline; there is no language server.
 */
import type { Extension, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { suggestMembers } from './javaMembers';
import {
  completeAnyWord, snippetCompletion, type Completion, type CompletionContext, type CompletionResult,
} from '@codemirror/autocomplete';

// ------------------------------------------------------------------ data

export const JAVA_KEYWORDS = [
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'continue', 'default',
  'do', 'double', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'float', 'for', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null', 'package', 'private', 'protected',
  'public', 'record', 'return', 'sealed', 'permits', 'short', 'static', 'super', 'switch', 'synchronized', 'this',
  'throw', 'throws', 'transient', 'true', 'try', 'var', 'void', 'volatile', 'while', 'yield',
];

/** Type name to fully qualified name. java.lang types need no import. */
export const KNOWN_TYPES: Record<string, string> = {
  String: 'java.lang.String', Object: 'java.lang.Object', Integer: 'java.lang.Integer', Long: 'java.lang.Long',
  Double: 'java.lang.Double', Float: 'java.lang.Float', Boolean: 'java.lang.Boolean', Character: 'java.lang.Character',
  Math: 'java.lang.Math', System: 'java.lang.System', StringBuilder: 'java.lang.StringBuilder', Thread: 'java.lang.Thread',
  Runnable: 'java.lang.Runnable', Exception: 'java.lang.Exception', RuntimeException: 'java.lang.RuntimeException',
  IllegalArgumentException: 'java.lang.IllegalArgumentException', IllegalStateException: 'java.lang.IllegalStateException',
  Override: 'java.lang.Override', Deprecated: 'java.lang.Deprecated', SuppressWarnings: 'java.lang.SuppressWarnings',
  Iterable: 'java.lang.Iterable', Comparable: 'java.lang.Comparable', Enum: 'java.lang.Enum', Record: 'java.lang.Record',
  List: 'java.util.List', ArrayList: 'java.util.ArrayList', LinkedList: 'java.util.LinkedList', Map: 'java.util.Map',
  HashMap: 'java.util.HashMap', LinkedHashMap: 'java.util.LinkedHashMap', TreeMap: 'java.util.TreeMap', Set: 'java.util.Set',
  HashSet: 'java.util.HashSet', LinkedHashSet: 'java.util.LinkedHashSet', TreeSet: 'java.util.TreeSet', Optional: 'java.util.Optional',
  Arrays: 'java.util.Arrays', Collections: 'java.util.Collections', Objects: 'java.util.Objects', UUID: 'java.util.UUID',
  Random: 'java.util.Random', Iterator: 'java.util.Iterator', Collection: 'java.util.Collection', Deque: 'java.util.Deque',
  ArrayDeque: 'java.util.ArrayDeque', Queue: 'java.util.Queue', EnumMap: 'java.util.EnumMap', EnumSet: 'java.util.EnumSet',
  Function: 'java.util.function.Function', BiFunction: 'java.util.function.BiFunction', Supplier: 'java.util.function.Supplier',
  Consumer: 'java.util.function.Consumer', BiConsumer: 'java.util.function.BiConsumer', Predicate: 'java.util.function.Predicate',
  Stream: 'java.util.stream.Stream', Collectors: 'java.util.stream.Collectors', IntStream: 'java.util.stream.IntStream',
  ConcurrentHashMap: 'java.util.concurrent.ConcurrentHashMap', CompletableFuture: 'java.util.concurrent.CompletableFuture',
  TimeUnit: 'java.util.concurrent.TimeUnit', AtomicInteger: 'java.util.concurrent.atomic.AtomicInteger',
  Pattern: 'java.util.regex.Pattern', Matcher: 'java.util.regex.Matcher',
  Path: 'java.nio.file.Path', Paths: 'java.nio.file.Paths', Files: 'java.nio.file.Files', File: 'java.io.File',
  IOException: 'java.io.IOException', InputStream: 'java.io.InputStream', OutputStream: 'java.io.OutputStream',
  // Logging and modding libraries whose package names do not depend on Minecraft mappings.
  Logger: 'org.slf4j.Logger', LoggerFactory: 'org.slf4j.LoggerFactory',
  ModInitializer: 'net.fabricmc.api.ModInitializer', ClientModInitializer: 'net.fabricmc.api.ClientModInitializer',
  DedicatedServerModInitializer: 'net.fabricmc.api.DedicatedServerModInitializer',
  Environment: 'net.fabricmc.api.Environment', EnvType: 'net.fabricmc.api.EnvType',
  Mixin: 'org.spongepowered.asm.mixin.Mixin', Shadow: 'org.spongepowered.asm.mixin.Shadow',
  Unique: 'org.spongepowered.asm.mixin.Unique', Overwrite: 'org.spongepowered.asm.mixin.Overwrite',
  Inject: 'org.spongepowered.asm.mixin.injection.Inject', At: 'org.spongepowered.asm.mixin.injection.At',
  Redirect: 'org.spongepowered.asm.mixin.injection.Redirect', ModifyArg: 'org.spongepowered.asm.mixin.injection.ModifyArg',
  ModifyVariable: 'org.spongepowered.asm.mixin.injection.ModifyVariable',
  CallbackInfo: 'org.spongepowered.asm.mixin.injection.callback.CallbackInfo',
  CallbackInfoReturnable: 'org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable',
  Accessor: 'org.spongepowered.asm.mixin.gen.Accessor', Invoker: 'org.spongepowered.asm.mixin.gen.Invoker',
};

const SNIPPETS: Completion[] = [
  snippetCompletion('public static void main(String[] args) {\n\t${}\n}', { label: 'main', detail: 'main method', type: 'text' }),
  snippetCompletion('System.out.println(${});', { label: 'sout', detail: 'System.out.println', type: 'text' }),
  snippetCompletion('for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}', { label: 'fori', detail: 'for loop with index', type: 'text' }),
  snippetCompletion('for (${Type} ${item} : ${items}) {\n\t${}\n}', { label: 'foreach', detail: 'enhanced for loop', type: 'text' }),
  snippetCompletion('if (${condition}) {\n\t${}\n}', { label: 'if', detail: 'if block', type: 'text' }),
  snippetCompletion('if (${condition}) {\n\t${}\n} else {\n\t\n}', { label: 'ifelse', detail: 'if / else', type: 'text' }),
  snippetCompletion('while (${condition}) {\n\t${}\n}', { label: 'while', detail: 'while loop', type: 'text' }),
  snippetCompletion('try {\n\t${}\n} catch (${Exception} e) {\n\te.printStackTrace();\n}', { label: 'trycatch', detail: 'try / catch', type: 'text' }),
  snippetCompletion('switch (${value}) {\n\tcase ${A} -> ${};\n\tdefault -> {}\n}', { label: 'switch', detail: 'switch expression', type: 'text' }),
  snippetCompletion('@Override\npublic ${void} ${name}(${}) {\n\t\n}', { label: 'override', detail: '@Override method', type: 'text' }),
  snippetCompletion('private static final Logger LOGGER = LoggerFactory.getLogger(${"MOD_ID"});', {
    label: 'logger', detail: 'SLF4J logger (adds imports)', type: 'text',
  }),
  snippetCompletion('@Inject(method = "${methodName}", at = @At("HEAD"))\nprivate void ${onMethod}(CallbackInfo ci) {\n\t${}\n}', {
    label: 'inject', detail: 'Mixin @Inject at HEAD', type: 'text',
  }),
];

/** Imports a snippet needs, added when it is inserted. */
const SNIPPET_IMPORTS: Record<string, string[]> = {
  logger: ['org.slf4j.Logger', 'org.slf4j.LoggerFactory'],
  inject: [
    'org.spongepowered.asm.mixin.injection.Inject', 'org.spongepowered.asm.mixin.injection.At',
    'org.spongepowered.asm.mixin.injection.callback.CallbackInfo',
  ],
};

// ------------------------------------------------------------- imports

/**
 * Returns the change that adds `import fqcn;` to a Java source, or null when
 * no import is needed (java.lang, same package, already imported or covered
 * by a wildcard import).
 */
export function importChange(src: string, fqcn: string): { from: number; insert: string } | null {
  const dot = fqcn.lastIndexOf('.');
  if (dot < 0) return null;
  const pkg = fqcn.slice(0, dot);
  const simple = fqcn.slice(dot + 1);
  if (pkg === 'java.lang') return null;
  const ownPkg = /^\s*package\s+([\w.]+)\s*;/m.exec(src)?.[1] ?? '';
  if (ownPkg === pkg) return null;
  const imports = [...src.matchAll(/^\s*import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/gm)];
  for (const m of imports) {
    if (m[1]) continue;
    const name = m[2];
    if (name === fqcn || name === `${pkg}.*`) return null;
    if (name.endsWith(`.${simple}`)) return null; // another type with the same name is imported
  }
  const line = `import ${fqcn};\n`;
  // Keep imports sorted: insert before the first import that sorts after it.
  const plain = imports.filter((m) => !m[1]);
  for (const m of plain) {
    if (m[2] > fqcn) return { from: m.index! + m[0].length - m[0].trimStart().length, insert: line };
  }
  if (plain.length) {
    const last = plain[plain.length - 1];
    const end = last.index! + last[0].length;
    return { from: end + 1 > src.length ? src.length : end + 1, insert: src[end] === '\n' ? line : `\n${line}` };
  }
  const pkgLine = /^\s*package\s+[\w.]+\s*;[^\n]*\n?/m.exec(src);
  if (pkgLine) {
    const end = pkgLine.index + pkgLine[0].length;
    return { from: end, insert: `\n${line}` };
  }
  return { from: 0, insert: `${line}\n` };
}

/** Adds several imports in one go (each computed against the evolving text). */
export function withImports(src: string, fqcns: string[]): string {
  let out = src;
  for (const f of fqcns) {
    const c = importChange(out, f);
    if (c) out = out.slice(0, c.from) + c.insert + out.slice(c.from);
  }
  return out;
}

// ---------------------------------------------------- package and files

/**
 * Infers the Java package from a project-relative path such as
 * "src/main/java/com/example/mod/Foo.java" (also src/client/java and other
 * Gradle source sets). Returns "" when the file is not under a java root.
 */
export function packageForDir(relDir: string): string {
  const parts = relDir.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 2; i--) {
    if (parts[i] === 'java' && parts[i - 2] === 'src') return parts.slice(i + 1).join('.');
  }
  const j = parts.lastIndexOf('java');
  return j >= 0 ? parts.slice(j + 1).join('.') : '';
}

export type JavaKind = 'class' | 'interface' | 'enum' | 'record' | 'mixin' | 'fabric-initializer';

export function javaTemplate(pkg: string, name: string, kind: JavaKind, modId = 'modid'): string {
  const head = pkg ? `package ${pkg};\n\n` : '';
  switch (kind) {
    case 'interface':
      return `${head}public interface ${name} {\n\n}\n`;
    case 'enum':
      return `${head}public enum ${name} {\n\t;\n}\n`;
    case 'record':
      return `${head}public record ${name}() {\n\n}\n`;
    case 'mixin':
      return withImports(`${head}@Mixin(TargetClass.class)\npublic abstract class ${name} {\n\t@Inject(method = "methodName", at = @At("HEAD"))\n\tprivate void onMethod(CallbackInfo ci) {\n\t}\n}\n`, [
        'org.spongepowered.asm.mixin.Mixin', 'org.spongepowered.asm.mixin.injection.At',
        'org.spongepowered.asm.mixin.injection.Inject', 'org.spongepowered.asm.mixin.injection.callback.CallbackInfo',
      ]);
    case 'fabric-initializer':
      return withImports(`${head}public class ${name} implements ModInitializer {\n\tpublic static final String MOD_ID = "${modId}";\n\tpublic static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);\n\n\t@Override\n\tpublic void onInitialize() {\n\t\tLOGGER.info("Hello from {}", MOD_ID);\n\t}\n}\n`, [
        'net.fabricmc.api.ModInitializer', 'org.slf4j.Logger', 'org.slf4j.LoggerFactory',
      ]);
    default:
      return `${head}public class ${name} {\n\n}\n`;
  }
}

export function validJavaName(name: string): string | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return 'Use a valid Java identifier, for example MyItem';
  if (JAVA_KEYWORDS.includes(name)) return `${name} is a Java keyword`;
  return null;
}

// ------------------------------------------------------------- symbols

export interface JavaSymbol {
  name: string;
  kind: 'class' | 'interface' | 'enum' | 'record' | 'annotation' | 'method' | 'field';
  /** 1-based line. */
  line: number;
  /** Enclosing type, if any. */
  container?: string;
  /** Field type or method return type, as written (generics included). */
  type?: string;
  /** Method parameter list as written, without parentheses. */
  params?: string;
  isStatic?: boolean;
  /** For types: names after extends / implements. */
  supers?: string[];
}

const TYPE_RE = /\b(class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/;
const METHOD_RE = /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\s+)*(?:<[^>]*>\s*)?([\w$.<>,?\[\] ]+?)\s+([A-Za-z_$][\w$]*)\s*\([^)]*(?:\)\s*(?:throws\s+[\w$.,\s]+?)?\s*(?:\{.*|;\s*)?)?$/;
const CTOR_RE = /^\s*(?:(?:public|protected|private)\s+)([A-Z][\w$]*)\s*\(/;
const FIELD_RE = /^\s*(?:(?:public|protected|private|static|final|transient|volatile)\s+)+([\w$.<>,?\[\] ]+?)\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/;
const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'throw', 'synchronized', 'try', 'do']);

/** A fast, regex-based outline of a Java file (no full parse). */
export function javaSymbols(src: string): JavaSymbol[] {
  const out: JavaSymbol[] = [];
  const stack: { name: string; depth: number }[] = [];
  let depth = 0;
  let inBlockComment = false;
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // strip comments and string contents so braces and keywords inside them do not count
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    line = line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/\/\*.*?\*\//g, '');
    const bc = line.indexOf('/*');
    if (bc >= 0) {
      inBlockComment = true;
      line = line.slice(0, bc);
    }
    const lc = line.indexOf('//');
    if (lc >= 0) line = line.slice(0, lc);

    const container = stack.length ? stack[stack.length - 1].name : undefined;
    const t = TYPE_RE.exec(line);
    if (t) {
      const kind = t[1] === '@interface' ? 'annotation' : (t[1] as JavaSymbol['kind']);
      const decl = line.slice(t.index + t[0].length);
      const supers = [...decl.matchAll(/\b(?:extends|implements)\s+([^{]+)/g)]
        .flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/<.*$/, '').replace(/\b(?:implements|extends)\b.*/, '').trim()))
        .filter(Boolean);
      out.push({ name: t[2], kind, line: i + 1, container, supers });
      stack.push({ name: t[2], depth: depth + 1 });
    } else if (container && stack[stack.length - 1].depth === depth) {
      const c = CTOR_RE.exec(line);
      const m = METHOD_RE.exec(line);
      const f = FIELD_RE.exec(line);
      const isStatic = /\bstatic\b/.test(line);
      const params = /\(([^)]*)\)?/.exec(line)?.[1]?.trim() ?? '';
      if (c && c[1] === container) out.push({ name: c[1], kind: 'method', line: i + 1, container, params });
      else if (m && !NOT_METHOD.has(m[2]) && !NOT_METHOD.has(m[1].trim()) && m[1].trim() !== 'new') {
        out.push({ name: m[2], kind: 'method', line: i + 1, container, type: m[1].trim(), params, isStatic });
      } else if (f && !NOT_METHOD.has(f[1].trim()) && f[1].trim() !== 'return') {
        out.push({ name: f[2], kind: 'field', line: i + 1, container, type: f[1].trim(), isStatic });
      }
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        while (stack.length && depth < stack[stack.length - 1].depth) stack.pop();
      }
    }
  }
  return out;
}

// ------------------------------------------------- project class index

export interface ClassEntry {
  name: string;
  pkg: string;
  /** Project-relative path. */
  rel: string;
  line: number;
  kind: JavaSymbol['kind'];
  members?: Member[];
  supers?: string[];
}

/** A method or field that can be suggested after a dot. */
export interface Member {
  name: string;
  kind: 'method' | 'field';
  /** Return or field type, generics stripped where possible. */
  type: string;
  params: string;
  isStatic: boolean;
}

/** Top-level and nested types declared in one file, with their members. */
export function classesInFile(rel: string, src: string): ClassEntry[] {
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(src)?.[1] ?? '';
  const syms = javaSymbols(src);
  return syms
    .filter((s) => s.kind !== 'method' && s.kind !== 'field')
    .map((s) => ({
      name: s.name, pkg, rel, line: s.line, kind: s.kind, supers: s.supers,
      members: syms.filter((m) => m.container === s.name && (m.kind === 'method' || m.kind === 'field') && m.name !== s.name)
        .map((m) => ({ name: m.name, kind: m.kind as 'method' | 'field', type: m.type ?? '', params: m.params ?? '', isStatic: !!m.isStatic })),
    }));
}

/** Project classes known to completion. Updated by the app. */
let projectClasses = new Map<string, ClassEntry[]>();

export function setProjectFileClasses(rel: string, classes: ClassEntry[]): void {
  if (classes.length) projectClasses.set(rel, classes);
  else projectClasses.delete(rel);
}

export function clearProjectClasses(): void {
  projectClasses = new Map();
}

export function allProjectClasses(): ClassEntry[] {
  return [...projectClasses.values()].flat();
}

// ------------------------------------------------------------ completion

const SKIP_NODES = /String|Comment|TextBlock|CharacterLiteral/;

function applyWithImports(text: string, fqcns: string[]) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const src = view.state.doc.toString();
    const changes: { from: number; to?: number; insert: string }[] = [{ from, to, insert: text }];
    let shift = 0;
    for (const f of fqcns) {
      const c = importChange(src, f);
      if (!c) continue;
      changes.push({ from: c.from, insert: c.insert });
      if (c.from <= from) shift += c.insert.length;
    }
    view.dispatch({
      changes: dedupeSorted(changes),
      selection: { anchor: from + shift + text.length },
      userEvent: 'input.complete',
      scrollIntoView: true,
    });
  };
}

/** CodeMirror wants changes in order and non-overlapping. */
function dedupeSorted(changes: { from: number; to?: number; insert: string }[]) {
  return changes.sort((a, b) => a.from - b.from || (a.to ?? a.from) - (b.to ?? b.from));
}

/** Suggestions after a dot: members of the receiver's type, when it can be worked out. */
function memberCompletions(ctx: CompletionContext): CompletionResult | null {
  const dotted = ctx.matchBefore(/\.\s*[\w$]*/);
  if (!dotted) return null;
  const lineText = ctx.state.doc.lineAt(ctx.pos).text;
  if (/^\s*(package|import)\b/.test(lineText)) return null;
  const src = ctx.state.doc.toString();
  const cursorLine = ctx.state.doc.lineAt(ctx.pos).number;
  const local = classesInFile('', src);
  let currentClass: string | undefined;
  for (const sym of javaSymbols(src)) if (sym.kind !== 'method' && sym.kind !== 'field' && sym.line <= cursorLine) currentClass = sym.name;
  const names = new Set(local.map((c) => c.name));
  const classes = [...local, ...allProjectClasses().filter((c) => !names.has(c.name))];
  const found = suggestMembers({ src, pos: dotted.from, currentClass, classes });
  if (!found) return null;
  const word = /[\w$]*$/.exec(dotted.text)![0];
  const seen = new Set<string>();
  const options: Completion[] = [];
  for (const m of found.members) {
    const key = `${m.kind}:${m.name}`;
    if (seen.has(key)) continue; // overloads: show once
    seen.add(key);
    if (m.kind === 'field') {
      options.push({ label: m.name, type: m.isStatic ? 'constant' : 'property', detail: m.type, boost: 2 });
    } else {
      const insert = `${m.name}()`;
      options.push({
        label: m.name, type: 'method', detail: `(${m.params}): ${m.type}`, boost: 1,
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length - (m.params ? 1 : 0) },
            userEvent: 'input.complete',
          });
        },
      });
    }
  }
  return { from: ctx.pos - word.length, options, validFor: /^[\w$]*$/ };
}

export function javaCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
  if (SKIP_NODES.test(node.name)) return null;
  const members = memberCompletions(ctx);
  if (members) return members;
  // After a dot with an unknown receiver, do not offer keywords and types.
  if (ctx.matchBefore(/\.\s*[\w$]*/)) return null;
  const word = ctx.matchBefore(/@?[\w$]+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  if (word.text.length < 2 && !ctx.explicit) return null;
  const annotation = word.text.startsWith('@');
  const from = annotation ? word.from + 1 : word.from;

  const options: Completion[] = [];
  if (!annotation) {
    for (const k of JAVA_KEYWORDS) options.push({ label: k, type: 'keyword', boost: -1 });
    options.push(...SNIPPETS.map((s) => {
      const imports = SNIPPET_IMPORTS[s.label];
      if (!imports) return s;
      const inner = s.apply as (view: EditorView, c: Completion, from: number, to: number) => void;
      return {
        ...s,
        apply: (view: EditorView, c: Completion, f: number, t: number) => {
          inner(view, c, f, t);
          const src = view.state.doc.toString();
          const next = withImports(src, imports);
          if (next !== src) {
            const head = view.state.selection.main.head;
            view.dispatch({ changes: { from: 0, to: src.length, insert: next }, selection: { anchor: head + (next.length - src.length) }, userEvent: 'input.complete' });
          }
        },
      };
    }));
  }
  const seen = new Set<string>();
  for (const [name, fqcn] of Object.entries(KNOWN_TYPES)) {
    seen.add(name);
    options.push({ label: name, type: 'class', detail: fqcn.slice(0, fqcn.lastIndexOf('.')), apply: applyWithImports(name, [fqcn]) });
  }
  for (const c of allProjectClasses()) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const fq = c.pkg ? `${c.pkg}.${c.name}` : c.name;
    options.push({ label: c.name, type: c.kind === 'interface' ? 'interface' : c.kind === 'enum' ? 'enum' : 'class', detail: c.pkg || 'project', boost: 1, apply: c.pkg ? applyWithImports(c.name, [fq]) : c.name });
  }
  return { from, options, validFor: /^[\w$]*$/ };
}

/** Editor extension for Java tabs: smarter completion plus words from the file. */
export async function javaSupport(): Promise<Extension> {
  const { java, javaLanguage } = await import('@codemirror/lang-java');
  return [java(), javaLanguage.data.of({ autocomplete: javaCompletionSource }), javaLanguage.data.of({ autocomplete: completeAnyWord })];
}

/** Symbols for the "Go to Symbol in File" picker. */
export function stateSymbols(state: EditorState): JavaSymbol[] {
  return javaSymbols(state.doc.toString());
}

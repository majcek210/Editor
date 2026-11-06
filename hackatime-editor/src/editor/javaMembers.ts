/**
 * Suggestions after a dot ("member completion") without a compiler.
 *
 * The type of the expression before the dot is found with simple rules:
 * `this`, a local variable, field or parameter declared in the file, a class
 * name (static members), or a call chain whose return types are known. Members
 * come from the project class index and from a hand-written table of common
 * JDK and modding types. Unknown types simply give no suggestions.
 */
import type { ClassEntry, Member } from './java';

/** "static name(params): Type" or "name: Type" for fields. */
const T: Record<string, string[]> = {
  Object: ['equals(Object obj): boolean', 'hashCode(): int', 'toString(): String', 'getClass(): Class'],
  String: [
    'length(): int', 'charAt(int index): char', 'substring(int beginIndex, int endIndex): String', 'indexOf(String str): int',
    'lastIndexOf(String str): int', 'contains(CharSequence s): boolean', 'startsWith(String prefix): boolean',
    'endsWith(String suffix): boolean', 'equalsIgnoreCase(String other): boolean', 'isEmpty(): boolean', 'isBlank(): boolean',
    'trim(): String', 'strip(): String', 'toLowerCase(): String', 'toUpperCase(): String',
    'replace(CharSequence target, CharSequence replacement): String', 'replaceAll(String regex, String replacement): String',
    'split(String regex): String[]', 'formatted(Object... args): String', 'repeat(int count): String', 'toCharArray(): char[]',
    'chars(): IntStream', 'lines(): Stream', 'matches(String regex): boolean', 'compareTo(String other): int',
    'static format(String format, Object... args): String', 'static valueOf(Object obj): String',
    'static join(CharSequence delimiter, CharSequence... elements): String',
  ],
  StringBuilder: [
    'append(Object obj): StringBuilder', 'insert(int offset, Object obj): StringBuilder', 'length(): int', 'charAt(int index): char',
    'reverse(): StringBuilder', 'deleteCharAt(int index): StringBuilder', 'setLength(int newLength): void', 'isEmpty(): boolean',
  ],
  Collection: [
    'add(E e): boolean', 'addAll(Collection c): boolean', 'remove(Object o): boolean', 'contains(Object o): boolean', 'size(): int',
    'isEmpty(): boolean', 'clear(): void', 'stream(): Stream', 'forEach(Consumer action): void', 'iterator(): Iterator',
    'removeIf(Predicate filter): boolean', 'toArray(): Object[]',
  ],
  List: [
    'get(int index): E', 'set(int index, E element): E', 'add(int index, E element): void', 'indexOf(Object o): int',
    'lastIndexOf(Object o): int', 'subList(int fromIndex, int toIndex): List', 'sort(Comparator c): void', 'getFirst(): E', 'getLast(): E',
    'static of(E... elements): List', 'static copyOf(Collection c): List',
  ],
  Set: ['static of(E... elements): Set', 'static copyOf(Collection c): Set'],
  Map: [
    'put(K key, V value): V', 'get(Object key): V', 'getOrDefault(Object key, V defaultValue): V', 'containsKey(Object key): boolean',
    'containsValue(Object value): boolean', 'remove(Object key): V', 'size(): int', 'isEmpty(): boolean', 'clear(): void',
    'keySet(): Set', 'values(): Collection', 'entrySet(): Set', 'putIfAbsent(K key, V value): V',
    'computeIfAbsent(K key, Function mappingFunction): V', 'merge(K key, V value, BiFunction remapping): V',
    'forEach(BiConsumer action): void', 'putAll(Map m): void', 'static of(K k1, V v1): Map', 'static copyOf(Map map): Map',
  ],
  Optional: [
    'isPresent(): boolean', 'isEmpty(): boolean', 'get(): T', 'orElse(T other): T', 'orElseGet(Supplier supplier): T',
    'orElseThrow(): T', 'ifPresent(Consumer action): void', 'ifPresentOrElse(Consumer action, Runnable emptyAction): void',
    'map(Function mapper): Optional', 'filter(Predicate predicate): Optional', 'flatMap(Function mapper): Optional',
    'static of(T value): Optional', 'static ofNullable(T value): Optional', 'static empty(): Optional',
  ],
  Stream: [
    'filter(Predicate predicate): Stream', 'map(Function mapper): Stream', 'mapToInt(ToIntFunction mapper): IntStream',
    'flatMap(Function mapper): Stream', 'forEach(Consumer action): void', 'collect(Collector collector): R', 'toList(): List',
    'count(): long', 'sorted(): Stream', 'distinct(): Stream', 'limit(long maxSize): Stream', 'skip(long n): Stream',
    'anyMatch(Predicate predicate): boolean', 'allMatch(Predicate predicate): boolean', 'noneMatch(Predicate predicate): boolean',
    'findFirst(): Optional', 'findAny(): Optional', 'reduce(T identity, BinaryOperator accumulator): T',
    'static of(T... values): Stream', 'static empty(): Stream',
  ],
  IntStream: ['sum(): int', 'max(): OptionalInt', 'min(): OptionalInt', 'average(): OptionalDouble', 'boxed(): Stream', 'toArray(): int[]', 'static range(int startInclusive, int endExclusive): IntStream'],
  Iterator: ['hasNext(): boolean', 'next(): E', 'remove(): void'],
  Math: [
    'static abs(int a): int', 'static max(int a, int b): int', 'static min(int a, int b): int', 'static pow(double a, double b): double',
    'static sqrt(double a): double', 'static floor(double a): double', 'static ceil(double a): double', 'static round(double a): long',
    'static random(): double', 'static clamp(long value, int min, int max): int', 'static sin(double a): double',
    'static cos(double a): double', 'static atan2(double y, double x): double', 'static toRadians(double angdeg): double',
    'static floorMod(int x, int y): int', 'static PI: double', 'static E: double',
  ],
  System: [
    'static out: PrintStream', 'static err: PrintStream', 'static currentTimeMillis(): long', 'static nanoTime(): long',
    'static getProperty(String key): String', 'static exit(int status): void',
    'static arraycopy(Object src, int srcPos, Object dest, int destPos, int length): void',
  ],
  PrintStream: ['println(Object x): void', 'print(Object x): void', 'printf(String format, Object... args): PrintStream'],
  Objects: [
    'static equals(Object a, Object b): boolean', 'static hash(Object... values): int', 'static requireNonNull(T obj): T',
    'static requireNonNullElse(T obj, T defaultObj): T', 'static isNull(Object obj): boolean', 'static nonNull(Object obj): boolean',
    'static toString(Object o): String',
  ],
  Arrays: [
    'static asList(T... a): List', 'static sort(Object[] a): void', 'static toString(Object[] a): String',
    'static fill(Object[] a, Object val): void', 'static copyOf(T[] original, int newLength): T[]', 'static stream(T[] array): Stream',
    'static equals(Object[] a, Object[] b): boolean',
  ],
  Collections: [
    'static sort(List list): void', 'static reverse(List list): void', 'static shuffle(List list): void',
    'static unmodifiableList(List list): List', 'static emptyList(): List', 'static emptyMap(): Map', 'static max(Collection coll): T',
    'static min(Collection coll): T',
  ],
  Integer: [
    'intValue(): int', 'compareTo(Integer other): int', 'static parseInt(String s): int', 'static valueOf(int i): Integer',
    'static toString(int i): String', 'static max(int a, int b): int', 'static MAX_VALUE: int', 'static MIN_VALUE: int',
  ],
  UUID: ['toString(): String', 'static randomUUID(): UUID', 'static fromString(String name): UUID'],
  Logger: [
    'info(String msg, Object... args): void', 'warn(String msg, Object... args): void', 'error(String msg, Object... args): void',
    'debug(String msg, Object... args): void', 'trace(String msg, Object... args): void', 'isDebugEnabled(): boolean',
  ],
  LoggerFactory: ['static getLogger(String name): Logger'],
  CallbackInfo: ['cancel(): void', 'isCancelled(): boolean'],
  CallbackInfoReturnable: ['setReturnValue(R returnValue): void', 'getReturnValue(): R', 'cancel(): void', 'isCancelled(): boolean'],
};

/** Supertypes inside the table, so ArrayList gets List and Collection members. */
const SUPERS: Record<string, string[]> = {
  List: ['Collection'], ArrayList: ['List'], LinkedList: ['List'], Set: ['Collection'], HashSet: ['Set'],
  LinkedHashSet: ['Set'], TreeSet: ['Set'], HashMap: ['Map'], LinkedHashMap: ['Map'], TreeMap: ['Map'],
  ConcurrentHashMap: ['Map'], CallbackInfoReturnable: ['CallbackInfo'],
};

function parse(entry: string): Member {
  const isStatic = entry.startsWith('static ');
  const e = isStatic ? entry.slice(7) : entry;
  const m = /^(\w+)(?:\((.*)\))?:\s*(.+)$/.exec(e)!;
  return { name: m[1], kind: m[2] === undefined ? 'field' : 'method', params: m[2] ?? '', type: m[3], isStatic };
}

const cache = new Map<string, Member[]>();

/** Members of a JDK or library type from the table, including its supertypes and Object. */
export function knownMembers(type: string): Member[] | null {
  if (!T[type] && !SUPERS[type]) return null;
  const hit = cache.get(type);
  if (hit) return hit;
  const seen = new Set<string>();
  const out: Member[] = [];
  const visit = (t: string) => {
    if (seen.has(t)) return;
    seen.add(t);
    for (const e of T[t] ?? []) out.push(parse(e));
    for (const s of SUPERS[t] ?? []) visit(s);
  };
  visit(type);
  visit('Object');
  cache.set(type, out);
  return out;
}

/** "List<String>" -> "List", "String[]" -> "String[]", "java.util.Map" -> "Map". */
export function baseType(t: string): string {
  return t.replace(/<.*>/, '').replace(/^.*\./, '').trim();
}

export interface Resolver {
  src: string;
  /** Offset of the dot. */
  pos: number;
  /** Name of the class the cursor is in, if known. */
  currentClass?: string;
  classes: ClassEntry[];
}

/** Members of a project or known type, following project supertypes. */
export function membersOfType(type: string, classes: ClassEntry[], seen = new Set<string>()): Member[] | null {
  const name = baseType(type);
  if (seen.has(name)) return [];
  seen.add(name);
  const own = classes.find((c) => c.name === name);
  if (own) {
    const out = [...(own.members ?? [])];
    for (const s of own.supers ?? []) out.push(...(membersOfType(s, classes, seen) ?? []));
    if (!own.supers?.length) out.push(...(knownMembers('Object') ?? []));
    return dedupe(out);
  }
  return knownMembers(name);
}

function dedupe(ms: Member[]): Member[] {
  const seen = new Set<string>();
  return ms.filter((m) => {
    const k = `${m.kind}:${m.name}:${m.params}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const DECL = (name: string) =>
  new RegExp(`(?:^|[\\s(,<;{])([A-Z][\\w$]*(?:\\.[A-Z][\\w$]*)*(?:<[^;=(){}]*>)?(?:\\[\\])*)\\s+${name}\\s*(?=[=;,):])`, 'g');
const VAR_NEW = (name: string) => new RegExp(`\\bvar\\s+${name}\\s*=\\s*new\\s+([A-Z][\\w$]*)`, 'g');

/** Finds the declared type of a variable, preferring the declaration closest before pos. */
export function typeOfVariable(src: string, name: string, pos: number): string | null {
  let best: { at: number; type: string } | null = null;
  const consider = (re: RegExp) => {
    for (const m of src.matchAll(re)) {
      const at = m.index ?? 0;
      if (at > pos) continue;
      if (!best || at > best.at) best = { at, type: m[1] };
    }
  };
  consider(DECL(name));
  consider(VAR_NEW(name));
  if (best) return (best as { type: string }).type;
  // Fields can be declared below the method that uses them.
  for (const m of src.matchAll(DECL(name))) return m[1];
  return null;
}

/**
 * Splits the expression just before the dot into segments, for example
 * "this.items.get(0)" -> ["this", "items", "get()"]. Returns null when it is
 * not a simple chain (casts, array indexes, string literals and so on).
 */
export function receiverChain(src: string, dot: number): string[] | null {
  let i = dot - 1;
  const segs: string[] = [];
  for (;;) {
    let call = false;
    if (src[i] === ')') {
      let depth = 0;
      for (; i >= 0; i--) {
        if (src[i] === ')') depth++;
        else if (src[i] === '(') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (i < 0) return null;
      i--;
      call = true;
    }
    const end = i + 1;
    while (i >= 0 && /[\w$]/.test(src[i])) i--;
    const ident = src.slice(i + 1, end);
    if (!ident || /^\d/.test(ident)) return null;
    segs.unshift(call ? `${ident}()` : ident);
    while (i >= 0 && /\s/.test(src[i])) i--;
    if (src[i] !== '.') break;
    i--;
    while (i >= 0 && /\s/.test(src[i])) i--;
  }
  return segs;
}

export interface MemberSuggestions {
  members: Member[];
  /** True when the receiver is a type name, so only static members fit. */
  staticOnly: boolean;
  type: string;
}

export function suggestMembers(r: Resolver): MemberSuggestions | null {
  const chain = receiverChain(r.src, r.pos);
  if (!chain?.length) return null;
  let type: string | null = null;
  let staticOnly = false;
  const [first, ...rest] = chain;
  if (first === 'this' || first === 'super') {
    type = r.currentClass ?? null;
    if (first === 'super' && type) type = r.classes.find((c) => c.name === type)?.supers?.[0] ?? null;
  } else if (!first.endsWith('()')) {
    type = typeOfVariable(r.src, first, r.pos);
    if (!type && /^[A-Z]/.test(first) && (r.classes.some((c) => c.name === first) || knownMembers(first))) {
      type = first;
      staticOnly = true;
    }
  } else if (r.currentClass) {
    // a call on the current class: foo().
    const m = membersOfType(r.currentClass, r.classes)?.find((x) => x.kind === 'method' && `${x.name}()` === first);
    type = m?.type ?? null;
  }
  for (const seg of rest) {
    if (!type) return null;
    const members = membersOfType(type, r.classes);
    const isCall = seg.endsWith('()');
    const name = isCall ? seg.slice(0, -2) : seg;
    const m = members?.find((x) => x.name === name && (x.kind === 'method') === isCall);
    type = m?.type ?? null;
    staticOnly = false;
  }
  if (!type) return null;
  const all = membersOfType(type, r.classes);
  if (!all) return null;
  return { members: staticOnly ? all.filter((m) => m.isStatic) : all, staticOnly, type: baseType(type) };
}

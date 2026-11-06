import { describe, expect, it } from 'vitest';
import { classesInFile } from '../src/editor/java';
import { receiverChain, suggestMembers, typeOfVariable } from '../src/editor/javaMembers';

const ITEM = `package com.example.mod.item;
public class RubyItem extends BaseItem {
\tpublic static final int MAX = 64;
\tprivate String name;
\tpublic String getName() { return name; }
\tpublic static RubyItem create(String name) { return new RubyItem(); }
}
`;
const BASE = `package com.example.mod.item;
public abstract class BaseItem {
\tprotected int count;
\tpublic void use(int times) {}
}
`;
const classes = [...classesInFile('RubyItem.java', ITEM), ...classesInFile('BaseItem.java', BASE)];

function at(src: string, marker = '|') {
  const pos = src.indexOf(marker);
  return { src: src.replace(marker, ''), pos };
}
function names(src: string, currentClass?: string) {
  const { src: s, pos } = at(src);
  // pos points just after the dot; suggestMembers wants the dot itself
  const r = suggestMembers({ src: s, pos: pos - 1, currentClass, classes });
  return r ? r.members.map((m) => m.name) : null;
}

describe('receiverChain', () => {
  it('splits call chains', () => {
    const s = 'this.items.get(0).';
    expect(receiverChain(s, s.length - 1)).toEqual(['this', 'items', 'get()']);
  });
  it('rejects numbers', () => {
    expect(receiverChain('3.', 1)).toBeNull();
  });
});

describe('typeOfVariable', () => {
  it('finds locals, fields, params and var', () => {
    const src = 'class A { private final List<String> names; void f(Map<String, Integer> m) { var sb = new StringBuilder(); } }';
    expect(typeOfVariable(src, 'names', src.length)).toBe('List<String>');
    expect(typeOfVariable(src, 'm', src.length)).toBe('Map<String, Integer>');
    expect(typeOfVariable(src, 'sb', src.length)).toBe('StringBuilder');
  });
});

describe('suggestMembers', () => {
  it('suggests JDK members for typed variables', () => {
    const n = names('void f() { List<String> names = new ArrayList<>(); names.| }')!;
    expect(n).toEqual(expect.arrayContaining(['add', 'get', 'size', 'stream', 'forEach', 'equals']));
  });
  it('follows call chains with known return types', () => {
    expect(names('void f(String s) { s.trim().| }')).toEqual(expect.arrayContaining(['length', 'toUpperCase']));
    expect(names('void f() { System.out.| }')).toEqual(expect.arrayContaining(['println', 'printf']));
  });
  it('suggests only static members on a class name', () => {
    const n = names('void f() { Math.| }')!;
    expect(n).toContain('max');
    expect(names('void f() { RubyItem.| }')).toEqual(['MAX', 'create']);
  });
  it('suggests project class members, including inherited ones', () => {
    const n = names('void f(RubyItem item) { item.| }')!;
    expect(n).toEqual(expect.arrayContaining(['getName', 'name', 'use', 'count']));
  });
  it('uses the current class for this.', () => {
    expect(names('class RubyItem { void f() { this.| } }', 'RubyItem')).toEqual(expect.arrayContaining(['getName', 'use']));
  });
  it('suggests logger and mixin callback methods', () => {
    expect(names('static final Logger LOGGER = LoggerFactory.getLogger("x"); void f() { LOGGER.| }')).toEqual(expect.arrayContaining(['info', 'warn', 'error']));
    expect(names('void f(CallbackInfoReturnable<Boolean> cir) { cir.| }')).toEqual(expect.arrayContaining(['setReturnValue', 'cancel']));
  });
  it('gives nothing for unknown types', () => {
    expect(names('void f(PlayerEntity player) { player.| }')).toBeNull();
  });
});

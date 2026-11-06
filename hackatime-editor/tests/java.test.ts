import { describe, expect, it } from 'vitest';
import { classesInFile, importChange, javaSymbols, javaTemplate, packageForDir, validJavaName, withImports } from '../src/editor/java';
import { cliLanguageOf, detectLanguage } from '../src/editor/languages';

const SRC = `package com.example.mod;

import java.util.List;
import net.fabricmc.api.ModInitializer;

public class ExampleMod implements ModInitializer {
\tpublic static final String MOD_ID = "example";
\tprivate final List<String> names = List.of("a", "b {");

\tpublic ExampleMod() {
\t}

\t@Override
\tpublic void onInitialize() {
\t\tif (names.isEmpty()) { return; }
\t\t// void fake() {
\t}

\tprivate static <T> List<T> wrap(T value) {
\t\treturn List.of(value);
\t}

\tenum Mode { ON, OFF }
}
`;

describe('importChange', () => {
  it('adds a missing import in sorted position', () => {
    const c = importChange(SRC, 'java.util.Map')!;
    const out = SRC.slice(0, c.from) + c.insert + SRC.slice(c.from);
    expect(out).toContain('import java.util.List;\nimport java.util.Map;\nimport net.fabricmc');
  });
  it('skips java.lang, already imported, same package and wildcard imports', () => {
    expect(importChange(SRC, 'java.lang.String')).toBeNull();
    expect(importChange(SRC, 'java.util.List')).toBeNull();
    expect(importChange(SRC, 'com.example.mod.Other')).toBeNull();
    expect(importChange('import java.util.*;\nclass A {}', 'java.util.Map')).toBeNull();
  });
  it('adds after the package line when there are no imports', () => {
    expect(withImports('package a.b;\n\nclass A {}\n', ['java.util.List'])).toBe('package a.b;\n\nimport java.util.List;\n\nclass A {}\n');
  });
});

describe('packages and templates', () => {
  it('infers the package from Gradle source set paths', () => {
    expect(packageForDir('src/main/java/com/example/mod')).toBe('com.example.mod');
    expect(packageForDir('src/client/java/com/example/mod/client')).toBe('com.example.mod.client');
    expect(packageForDir('docs')).toBe('');
  });
  it('builds a Fabric initializer with its imports', () => {
    const t = javaTemplate('com.example', 'MyMod', 'fabric-initializer', 'mymod');
    expect(t).toMatch(/^package com\.example;\n\nimport net\.fabricmc\.api\.ModInitializer;\nimport org\.slf4j\.Logger;\nimport org\.slf4j\.LoggerFactory;\n/);
    expect(t).toContain('public class MyMod implements ModInitializer');
    expect(t).toContain('"mymod"');
  });
  it('validates class names', () => {
    expect(validJavaName('MyItem')).toBeNull();
    expect(validJavaName('class')).not.toBeNull();
    expect(validJavaName('1Bad')).not.toBeNull();
  });
});

describe('javaSymbols', () => {
  it('outlines types, fields, constructors and methods, ignoring comments and strings', () => {
    const syms = javaSymbols(SRC).map((s) => `${s.kind}:${s.name}`);
    expect(syms).toEqual([
      'class:ExampleMod', 'field:MOD_ID', 'field:names', 'method:ExampleMod', 'method:onInitialize', 'method:wrap', 'enum:Mode',
    ]);
  });
  it('indexes classes with their package', () => {
    expect(classesInFile('src/main/java/com/example/mod/ExampleMod.java', SRC).map((c) => `${c.pkg}.${c.name}`))
      .toEqual(['com.example.mod.ExampleMod', 'com.example.mod.Mode']);
  });
});

describe('mod file types', () => {
  it('detects the files a Minecraft mod uses', () => {
    expect(detectLanguage('build.gradle').id).toBe('gradle');
    expect(detectLanguage('settings.gradle.kts').id).toBe('kotlin');
    expect(detectLanguage('mods.toml').id).toBe('toml');
    expect(detectLanguage('gradle.properties').id).toBe('properties');
    expect(detectLanguage('pack.mcmeta').id).toBe('json');
    expect(detectLanguage('gradlew').id).toBe('shell');
  });
  it('lets the CLI detect languages without a clear WakaTime name', () => {
    expect(cliLanguageOf(detectLanguage('A.java'))).toBe('Java');
    expect(cliLanguageOf(detectLanguage('build.gradle'))).toBeUndefined();
    expect(cliLanguageOf(detectLanguage('notes.txt'))).toBeUndefined();
  });
});

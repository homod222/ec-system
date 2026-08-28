import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const sourceRoot = join(root, 'src');
const dictionary = join(sourceRoot, 'i18n.tsx');
const technicalText = /^(?:EC|KNET|MIME|[a-z][\w.-]*\.(?:read|write|create|update|delete|publish|accept))$/;

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }));
  return nested.flat().filter((path) => /\.(?:ts|tsx)$/.test(path));
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function report(errors, file, source, offset, message) {
  errors.push(`${relative(root, file)}:${lineAt(source, offset)} — ${message}`);
}

function checkDictionary(source, errors) {
  const section = (name) => {
    const start = source.indexOf(`${name}: {`);
    if (start < 0) return null;
    let depth = 0;
    for (let index = source.indexOf('{', start); index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    return null;
  };
  const arabic = section('ar');
  const english = section('en');
  if (!arabic || !english) {
    errors.push('src/i18n.tsx — could not locate ar/en message dictionaries');
    return;
  }
  const keys = (section) => new Set([...section.matchAll(/'([^']+)'\s*:/g)].map((match) => match[1]));
  const arKeys = keys(arabic);
  const enKeys = keys(english);
  for (const key of [...arKeys].filter((key) => !enKeys.has(key))) errors.push(`src/i18n.tsx — missing English key: ${key}`);
  for (const key of [...enKeys].filter((key) => !arKeys.has(key))) errors.push(`src/i18n.tsx — extra English key: ${key}`);
}

function isTechnical(value) {
  return technicalText.test(value.trim());
}

const errors = [];
const dictionarySource = await readFile(dictionary, 'utf8');
checkDictionary(dictionarySource, errors);

for (const file of await filesIn(sourceRoot)) {
  if (file === dictionary) continue;
  const source = await readFile(file, 'utf8');

  const canonicalValueMatch = file.endsWith('/App.tsx') && source.includes("const DEFAULT_ACADEMIC_LEVEL = 'تمهيدي';");
  for (const match of source.matchAll(/[\u0600-\u06ff]/g)) {
    if (canonicalValueMatch && match.index >= source.indexOf("const DEFAULT_ACADEMIC_LEVEL") && match.index < source.indexOf('\n', source.indexOf("const DEFAULT_ACADEMIC_LEVEL"))) continue;
    report(errors, file, source, match.index, 'Arabic Unicode must be referenced through i18n messages');
  }
  for (const match of source.matchAll(/(?:placeholder|title|aria-label|alt)\s*=\s*(['"])(.*?)\1/g)) {
    if (/[A-Za-z]/.test(match[2]) && !isTechnical(match[2])) {
      report(errors, file, source, match.index, `hardcoded English ${match[0].split('=')[0]} attribute: "${match[2]}"`);
    }
  }
  for (const match of source.matchAll(/>\s*([A-Za-z][A-Za-z0-9 .,!?'’-]*)\s*<(?=\/[A-Za-z])/g)) {
    const text = match[1].trim();
    if (text && !isTechnical(text)) {
      report(errors, file, source, match.index, `hardcoded English JSX text: "${text}"`);
    }
  }
}

if (errors.length) {
  console.error('i18n validation failed:\n' + errors.map((error) => `  ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('i18n validation passed.');
}
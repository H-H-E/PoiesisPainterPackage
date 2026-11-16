import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';

const source = new URL('../src/schema.json', import.meta.url);
const schema = JSON.parse(await readFile(source, 'utf8'));
const types = await compile(schema, 'PaintingDocument', {
  bannerComment: '/* Generated from src/schema.json by npm run generate. Do not edit. */',
  style: { singleQuote: true, semi: true },
  additionalProperties: false,
  unreachableDefinitions: true,
});
const ajv = new Ajv({ allErrors: true, strict: true, strictTuples: false, discriminator: true, code: { source: true, esm: true }, inlineRefs: true });
// Compiler optimization only: the public schema remains standard draft-07.
// Each branch already requires a unique constant op, so this changes error
// selection and dispatch cost, not which documents are accepted.
const optimizedSchema = structuredClone(schema);
optimizedSchema.definitions.Command.discriminator = { propertyName: 'op' };
const validate = ajv.compile(optimizedSchema);
const validator = '// @ts-nocheck\n/* Generated from src/schema.json by npm run generate. Do not edit. */\n' + standaloneCode(ajv, validate) + '\n';
const outputs = [
  [new URL('../src/types.generated.ts', import.meta.url), types],
  [new URL('../src/validator.generated.ts', import.meta.url), validator],
];
if (process.argv.includes('--check')) {
  for (const [path, expected] of outputs) {
    const actual = await readFile(path, 'utf8');
    if (actual !== expected) throw new Error(`${fileURLToPath(path)} is stale; run npm run generate`);
  }
  console.log('Generated schema artifacts are current.');
} else {
  for (const [path, content] of outputs) await writeFile(path, content);
  console.log('Generated TypeScript types and standalone validator from src/schema.json.');
}

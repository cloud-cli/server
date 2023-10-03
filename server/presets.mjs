import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import tailwind from 'tailwindcss';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import resolveConfig from 'tailwindcss/resolveConfig.js';
import Yaml from 'yaml';

const CWD = process.cwd();
const getPresetPath = (name) => join(CWD, 'systems', name + '.yml');

function defineComponent(name, def) {
  return [
    def.variants ? '@variants ' + def.variants + ' {\n' : '',
    `.${name} {\n${(def.apply && '  @apply ' + def.apply + ';\n') || ''}}\n`,
    (def.parts &&
      Object.entries(def.parts).map(([part, classes]) => `.${name}__${part} {\n  @apply ${classes} ;\n}\n`)) ||
      [],
    def.variants ? '}' : '',
  ]
    .flat()
    .join('');
}

function generateCssTemplate(preset) {
  const componentDefinitions = !preset.components
    ? ''
    : Object.entries(preset.components)
        .map(([name, def]) => defineComponent(name, def))
        .join('');

  const css = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer components {
${componentDefinitions}
}

${preset.styles || ''}
`;

  return css;
}

async function ensureFolder(folder) {
  return existsSync(folder) || (await mkdir(folder, { recursive: true }));
}

export function generateConfig(preset) {
  if (Array.isArray(preset.extends)) {
    loadChain(preset);
  }

  return preset.resolve ? resolveConfig(preset) : preset;
}

export async function generatePreset(preset) {
  const tailwindConfig = generateConfig(preset);
  const json = JSON.stringify(tailwindConfig, null, 2);
  const input = generateCssTemplate(preset);
  const plugins = [tailwind(tailwindConfig), autoprefixer(), preset.minify && cssnano()].filter(Boolean);
  const processor = postcss(...plugins);

  try {
    const output = await processor.process(input, { from: '/web-design-system.css', to: '/index.css' });
    const { css } = output;

    return { error: null, css, json };
  } catch (error) {
    return { error, css: '', json };
  }
}

export async function readPreset(name) {
  const path = getPresetPath(name);

  if (!existsSync(path)) {
    return '';
  }

  return await readFile(path, 'utf-8');
}

/**
 * @param {String} name
 * @returns {Promise<object|null>} preset
 */
export async function loadPreset(name) {
  const input = await readPreset(name);
  return (input && Yaml.parse(input)) || null;
}

/**
 * @param {object} preset
 * @returns {Promise<object>} preset chain
 */
export async function loadChain(nameOrPreset) {
  let preset = nameOrPreset;

  if (typeof nameOrPreset === 'string') {
    preset = await loadPreset(name);
  }

  if (!preset?.extends) {
    return preset;
  }

  const presets = preset.presets || [];

  for (const extension of preset.extends.reverse()) {
    const next = await loadPreset(extension);

    if (next?.extends) {
      await loadChain(next);
      presets.unshift(...next.presets);
    }

    presets.unshift(next);
  }

  return preset;
}

export async function savePreset(name, preset) {
  const path = getPresetPath(name);
  await ensureFolder(dirname(path));
  await writeFile(path, preset, 'utf-8');
}

export async function savePresetAssets(name, preset) {
  const { json, css } = preset;
  const basePath = join(CWD, 'presets', name);
  await writeFile(basePath + '.mjs', 'export default ' + json);
  await writeFile(basePath + '.css', css);
}

export function loadPresetAsset(name) {
  const path = join(CWD, 'presets', name);

  if (existsSync(path)) {
    return createReadStream(path);
  }

  return null;
}

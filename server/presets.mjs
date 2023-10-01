import tailwind from 'tailwindcss';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import resolveConfig from 'tailwindcss/resolveConfig.js';
import { defaultPlugins, allPlugins } from './constants.mjs';

const commentSeparator = '//';
const definitionSeparator = ':';

const transformPlugins = (list) =>
  !Array.isArray(list)
    ? []
    : list.flatMap((next) => {
        if (next.endsWith('*')) {
          const stem = next.slice(0, -1);
          return allPlugins.filter((p) => p.startsWith(stem));
        }

        return next;
      });

function transformText(input) {
  if (!input) {
    return undefined;
  }

  const source =
    typeof input === 'string'
      ? input
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [left, right] = line.split(definitionSeparator);
            const [value] = right.split(commentSeparator);
            return [left, value];
          })
      : Object.entries(input);

  return source.reduce((all, next) => {
    all[String(next[0]).trim()] = String(next[1]).trim();
    return all;
  }, {});
}

function parseDefinitions(definitions) {
  const { sizes, colors, spacing, devices } = definitions;

  return {
    ...definitions,
    sizes: transformText(sizes),
    colors: transformText(colors),
    spacing: transformText(spacing),
    devices: transformText(devices),
  };
}

function generateScreens(devices) {
  if (!devices) {
    return;
  }

  const entries = Object.entries(devices).map(([device, string]) => [
    device,
    string.startsWith('raw:') ? { raw: string.slice(4) } : string,
  ]);

  return {
    portrait: { raw: '(orientation: portrait)' },
    landscape: { raw: '(orientation: landscape)' },
    ...Object.fromEntries(entries),
  };
}

function generateColors(colors) {
  if (!colors) {
    return;
  }

  const entries = Object.entries(colors).map(([key, DEFAULT]) => [key, { DEFAULT }]);

  return {
    transparent: 'transparent',
    current: 'currentColor',
    ...Object.fromEntries(entries),
  };
}

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

function generateCssTemplate(components) {
  const componentDefinitions = !components
    ? ''
    : Object.entries(components)
        .map(([name, def]) => defineComponent(name, def))
        .join('');

  const css = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer components {
${componentDefinitions}
}`;

  return css;
}

function combinePlugins(preset, stack = []) {
  if (preset.presets) {
    preset.presets.forEach((p) => combinePlugins(p, stack));
  }

  stack.unshift(preset.corePlugins || (preset.plugins === 'default' ? defaultPlugins : preset.plugins) || []);

  const combined = stack.filter(Boolean).flat().sort();
  return [...new Set(combined)];
}

export function generateConfig(preset) {
  const {
    borderRadius,
    colors: _colors,
    devices,
    spacing,
    presets,
    variants = null,
    theme = null,
  } = preset;

  const screens = generateScreens(devices);
  const colors = generateColors(_colors);
  const corePlugins = transformPlugins(combinePlugins(preset));
  const _ = (o) => o || {};

  return resolveConfig({
    ..._(corePlugins.length && { corePlugins }),
    ..._(Array.isArray(presets) && { presets: presets.map(generateConfig) }),
    ..._(variants && { variants }),
    theme: {
      extend: {
        ..._(screens && { screens }),
        ..._(colors && { colors }),
        ..._(borderRadius && { borderRadius }),
        ..._(spacing && { spacing }),
      },
      ..._(theme),
    },
  });
}

export async function generatePreset(definitions) {
  const parsed = parseDefinitions(definitions);
  const tailwindConfig = generateConfig(parsed);
  const json = JSON.stringify(tailwindConfig, null, 2);
  const input = generateCssTemplate(parsed.components);
  const plugins = [tailwind(tailwindConfig), autoprefixer(), definitions.minify && cssnano()].filter(Boolean);
  const processor = postcss(...plugins);

  try {
    const output = await processor.process(input, { from: '/web-design-system.css', to: '/index.css' });
    const { css } = output;

    return { error: null, css, json };
  } catch (error) {
    return { error, css: '', json };
  }
}

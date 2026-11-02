import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const simBans = [
  { object: 'Math', property: 'random', message: 'Sim must use the seeded RNG (src/sim/rng.ts).' },
  { object: 'Math', property: 'sin', message: 'Transcendental math can differ between engines.' },
  { object: 'Math', property: 'cos', message: 'Transcendental math can differ between engines.' },
  { object: 'Math', property: 'tan', message: 'Transcendental math can differ between engines.' },
  { object: 'Math', property: 'exp', message: 'Transcendental math can differ between engines.' },
  { object: 'Math', property: 'log', message: 'Transcendental math can differ between engines.' },
  { object: 'Math', property: 'pow', message: 'Use integer formulas or lookup tables.' },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/generated/**', 'tools/vendor/**', 'src-tauri/target/**', 'src-tauri/gen/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...simBans],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Sim time is the game day counter.' },
        { name: 'performance', message: 'No wall-clock time in sim.' },
        { name: 'crypto', message: 'Sim must use the seeded RNG.' },
        { name: 'setTimeout', message: 'The clock lives in src/worker.' },
        { name: 'setInterval', message: 'The clock lives in src/worker.' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['../*', '!../sim/*'], message: 'src/sim may only import from src/sim.' }, { group: ['pixi.js', 'preact', 'preact/*', '@preact/*', 'idb-keyval'], message: 'Sim must stay pure.' }] },
      ],
    },
  },
);

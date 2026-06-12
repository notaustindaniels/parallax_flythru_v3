// ESLint 9 flat config — CI-enforced (SPEC §2).
//
// The determinism block below is BINDING (CLAUDE.md rule 1, SPEC §3.2): engine and
// renderer code may not touch wall-clock time, ambient randomness, locale, or
// object-key iteration order. frame = f(sceneSpec, frameIndex), exactly.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'out/**',
      'docs/reference/**', // prior art, kept verbatim — never linted, never formatted
      'spikes/.work/**',
      'spikes/results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // plain-JS node entrypoints (CLI bin stubs) — declare the node globals we use
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },

  // ---- Determinism bans: packages/engine + packages/renderer-svg (SPEC §3.2) ----
  {
    files: ['packages/engine/**/*.ts', 'packages/renderer-svg/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Determinism (SPEC §3.2): use the keyed RNG — rand("feature/row:N/seg:M/attr").',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Determinism (SPEC §3.2): time is frameIndex / tS only.',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'Determinism (SPEC §3.2): time is frameIndex / tS only.',
        },
        {
          object: 'crypto',
          property: 'getRandomValues',
          message: 'Determinism (SPEC §3.2): use the keyed RNG.',
        },
        {
          object: 'crypto',
          property: 'randomUUID',
          message: 'Determinism (SPEC §3.2): entity IDs are world-derived, never random.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Determinism (CLAUDE.md rule 1): wall-clock/calendar time is banned here.',
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: 'Determinism (CLAUDE.md rule 1): wall-clock/calendar time is banned here.',
        },
        {
          selector: 'ForInStatement',
          message:
            'Determinism (CLAUDE.md rule 1): object-key iteration order is banned — iterate arrays or explicitly sorted keys.',
        },
        {
          selector: 'CallExpression[callee.property.name=/^toLocale/]',
          message: 'Determinism (CLAUDE.md rule 1): locale-dependent formatting is banned here.',
        },
      ],
    },
  },

  // ---- packages/engine has ZERO runtime deps: no DOM, no npm packages, no node: builtins
  // (SPEC §2 — pure TS, usable verbatim from both node and the browser studio) ----
  {
    files: ['packages/engine/**/*.ts'],
    ignores: ['packages/engine/**/*.test.ts', 'packages/engine/test/**'], // tests may import vitest
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^[^./]',
              message:
                'packages/engine has zero runtime dependencies (SPEC §2): relative imports only.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'engine is DOM-free (SPEC §2).' },
        { name: 'window', message: 'engine is DOM-free (SPEC §2).' },
        { name: 'navigator', message: 'engine is DOM-free (SPEC §2).' },
        { name: 'fetch', message: 'engine does no I/O (SPEC §2, §7).' },
      ],
    },
  },
);

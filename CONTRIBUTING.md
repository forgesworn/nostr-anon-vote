# Contributing to nostr-anon-vote

Anonymous voting on Nostr using LSAG ring signatures. Contributions welcome.

## Prerequisites

- Node.js 24 (LTS)
- npm (not pnpm)

## Setup

```bash
git clone https://github.com/forgesworn/nostr-anon-vote.git
cd nostr-anon-vote
npm install
npm run build
npm test
```

## Development workflow

```bash
npm run build      # compile TypeScript → dist/
npm test           # run all tests with vitest
npm run typecheck  # type-check without emitting
```

Tests live in `tests/voting.test.ts`. There is also a `src/voting.test.ts` — that file is a stale copy; the canonical tests are in `tests/`.

## Project structure

```
src/
  constants.ts   — kind numbers, label, algorithm name
  types.ts       — exported types and interfaces
  errors.ts      — VotingError, ValidationError, CryptoError
  nostr.ts       — low-level Nostr helpers
  voting.ts      — all public API functions
  index.ts       — re-exports

tests/
  voting.test.ts — integration and unit tests
```

## Conventions

- **British English** in all strings, comments, and documentation (organiser, authorisation, etc.)
- **Commit messages** use `type: description` format — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- **Errors** — always throw a typed subclass of `VotingError`; never throw plain `Error` from public API
- **Nostr pubkeys** are x-only 32-byte secp256k1 points, hex-encoded (64 chars), not npubs
- **Timestamps** are Unix seconds (`Math.floor(Date.now() / 1000)`)
- **ESM throughout** — all imports use `.js` extensions even for `.ts` source files

## Cryptographic changes

Changes to the ring signature scheme, key image derivation, or ballot encryption format are breaking. Any such change must:

1. Bump the format version (update the HKDF info string or add a version tag to events)
2. Update `llms-full.txt` and `llms.txt` to document the new format
3. Include migration notes in the PR description

Do not change the HKDF info string `'signet-ballot-encrypt-v1'` without a version bump — it breaks decryption of existing ballots.

## Pull requests

- Open an issue first for significant changes
- Keep PRs focused — one concern per PR
- All tests must pass and typecheck must be clean before review
- Add or update tests for any new behaviour

## Licence

MIT. By contributing you agree your changes are released under the same licence.

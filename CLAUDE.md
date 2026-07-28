# CLAUDE.md — nostr-anon-vote

Anonymous voting on Nostr using LSAG ring signatures. Voters prove eligibility without revealing identity; key images prevent double-voting without unmasking voters.

## Build & test

```bash
npm run build      # tsc → dist/
npm test           # vitest run (all tests in tests/)
npm run typecheck  # tsc --noEmit
```

Node.js 24. ESM throughout (`"type": "module"`). No pnpm — uses npm.

## Architecture

```
src/
  constants.ts   — VOTING_KINDS (30482–30484), DEFAULT_LABEL, DEFAULT_CRYPTO_ALGORITHM
  types.ts       — all exported types and interfaces
  errors.ts      — VotingError, ValidationError, CryptoError
  nostr.ts       — low-level Nostr helpers (signEvent, getEventId, getPublicKey, getTagValue, validateFieldSizeBounds)
  voting.ts      — all public API: createElection, castBallot, verifyBallot, tallyElection, encrypt/decrypt, validate*
  index.ts       — re-exports everything from voting.ts, constants.ts, errors.ts, types.ts

tests/
  voting.test.ts — full integration + unit tests (vitest)
```

There is also a `src/voting.test.ts` file that appeared to be a stale copy — the canonical tests live in `tests/voting.test.ts`.

## Key design decisions

### Ballot anonymity via ephemeral pubkeys
`castBallot` signs the ballot event with a freshly generated ephemeral keypair — the voter's real Nostr pubkey never appears in any published event. This means you cannot link a ballot to its author by inspecting `event.pubkey`.

### LSAG message binding
The ring signature signs `electionId:sha256(encryptedVote)`, not the plaintext vote or a free-form string. This binds the signature to the specific ciphertext, preventing an attacker from reusing a signature with a different vote payload.

### Key image derivation
Key images are computed by `@forgesworn/ring-sig`'s `computeKeyImage(privkey, pubkey, electionId)`. They are unique per voter per election, enabling the tally to deduplicate without knowing which ring member voted.

### Ballot encryption
ECDH (ephemeral secp256k1 keypair × tally pubkey) → SHA-256 of shared x-coordinate → HKDF-SHA256 with info string `'signet-ballot-encrypt-v1'` → AES-256-GCM. Serialised as `ephemeralPubkey(64 hex) + nonce(24 hex) + ciphertext+tag(variable hex)`.

Note: the HKDF info string says `signet-ballot-encrypt-v1` — this is a historical artefact from early development, not a dependency on Signet. Do not change it; doing so would break decryption of existing ballots.

### Re-vote deduplication
During tallying, ballots are grouped by key image. When `reVote: 'allowed'`, the ballot with the highest `created_at` wins. When `reVote: 'denied'`, the first ballot wins and duplicates are counted as invalid.

## Conventions

- **British English** in all user-visible strings and documentation (organiser, authorisation, etc.)
- **Nostr pubkeys** are x-only 32-byte secp256k1 points, hex-encoded (64 chars) — not npubs
- **Private keys** are hex-encoded 32-byte scalars
- **Timestamps** are Unix seconds (`Math.floor(Date.now() / 1000)`)
- **Errors** — always throw a typed subclass of `VotingError`; never throw plain `Error` from public API

## Event structure

### Kind 30482 — Election

Required tags: `d`, `title`, `scale`, `opens`, `closes`, `re-vote`, `algo`, `L`, `l`, one or more `option`, one or more `tally-pubkey`.

Optional: `description`, `eligible-entity-type` (multiple), `eligible-min-tier`, `eligible-community`, `tally-threshold` (e.g. `"2/3"`), `ring-size`.

### Kind 30483 — Ballot

Required tags: `d` (unique per ballot, includes random suffix), `election` (election event ID), `key-image`, `encrypted-vote`, `algo`, `L`, `l`.

**`content` holds the LSAG signature** as JSON, with `ring` and `keyImage` omitted — the verifier reconstructs them from the eligible ring and the `key-image` tag. Neither can be forged this way because both feed the LSAG challenge chain, so a wrong value fails verification.

This is deliberate. Tag values are capped at 1024 characters and the signature grows ~134 bytes per ring member, so the previous `ring-sig` tag made the library reject its own ballots above a ring size of 5. `content` is capped at 65536, which carries ~990 members — finally consistent with ring-sig's `MAX_RING_SIZE` of 1000.

Legacy ballots carrying a `ring-sig` tag with an empty `content` still verify. `verifyBallot` prefers `content` and falls back to the tag.

The `event.pubkey` is the ephemeral pubkey, not the voter's real key.

### Kind 30484 — Election Result

Required tags: `d` (`electionId:result`), `election`, `total-ballots`, `total-eligible`, `total-invalid`, one or more `result` tags (three-element: `["result", optionName, count]`), `algo`, `L`, `l`.

## Security bounds

| Limit | Value |
|-------|-------|
| Max content length | 65 536 chars |
| Max tag value length | 1 024 chars |
| Max tags per event | 100 |
| Max ring size | 1 000 (ring-sig); ~990 in practice, bounded by the 65536 content cap |
| Min ring size | 2 (enforced by ring-sig) |
| Future timestamp tolerance | 60 seconds |

## Pitfalls

- The `eligibleRing` array order must be consistent between `castBallot` and `verifyBallot`/`tallyElection`. The ring order feeds the LSAG signature; a mismatch will cause verification to fail. `computeRingHash` is order-sensitive for the same reason.
- Pass `eligibleRing` to `createElection` to commit a `ring-hash` to the election. Without it the ring is unpinned, and a voter can present a ring of their own choosing and be identified by the intersection of the rings they appear in. It is optional for backwards compatibility, but you want it.
- `verifyBallot` does **not** check key image uniqueness — that is the tally's responsibility.
- `castBallot` validates that the election is currently open (`opens ≤ now < closes`). Signing an event with a backdated `created_at` will not bypass this check because `castBallot` uses `Date.now()` internally.
- Ballot events signed by ephemeral keys are not associated with any Nostr profile. Relays that require POW or NIP-42 authentication may reject them.

## CI / release

CI runs on GitHub Actions (`.github/workflows/ci.yml`): typecheck → test. Releases via `forgesworn/anvil@v0` (workflow_call) on push to main.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@forgesworn/ring-sig` | LSAG ring signature generation and verification |
| `@noble/curves` | secp256k1 ECDH for ballot encryption |
| `@noble/hashes` | SHA-256, HKDF |
| `typescript` (dev) | TypeScript compiler |
| `vitest` (dev) | Test runner |


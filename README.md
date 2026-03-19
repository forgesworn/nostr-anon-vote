# nostr-anon-vote

Anonymous voting on Nostr with LSAG ring signatures — double-vote prevention without revealing identity.

## Features

- **Anonymous ballots** — LSAG ring signatures prove group membership without revealing which member voted
- **Double-vote prevention** — Key images detect duplicate votes without unmasking the voter
- **Re-vote support** — Optional policy allowing voters to change their mind (last ballot counts)
- **Encrypted ballots** — Vote content encrypted until tallying
- **Identity-agnostic** — Works with any ring of Nostr pubkeys, not tied to any specific identity system
- **Nostr-native** — Builds standard Nostr events (kinds 30482–30484)

## Install

```bash
npm install nostr-anon-vote
```

## Quick Start

```typescript
import { createElection, castBallot, tallyElection } from 'nostr-anon-vote';

// 1. Create an election
const election = await createElection(organizerPrivkey, {
  title: 'Should we adopt proposal X?',
  options: ['Yes', 'No', 'Abstain'],
  eligiblePubkeys: [pubkey1, pubkey2, pubkey3],
  closesAt: Math.floor(Date.now() / 1000) + 86400, // 24h
  scale: 'community',
  reVotePolicy: 'allowed',
});

// 2. Cast a ballot
const ballot = await castBallot(voterPrivkey, {
  electionEventId: election.id,
  vote: 'Yes',
  ring: [pubkey1, pubkey2, pubkey3],
  signerIndex: 0, // voter's position in the ring
});

// 3. Tally results
const result = await tallyElection(organizerPrivkey, {
  electionEvent: election,
  ballotEvents: [ballot],
  tallyKey: tallyPrivkey,
});
```

## Event Kinds

| Kind | Name | Purpose |
|------|------|---------|
| 30482 | Election | Define an election with eligible voters and options |
| 30483 | Ballot | Anonymous signed ballot with LSAG key image |
| 30484 | Election Result | Tallied result with verification data |

Kind numbers are placeholders pending NIP assignment.

## How It Works

1. An organiser publishes an **Election** event listing eligible pubkeys and voting options
2. Each voter constructs an **LSAG ring signature** over their encrypted vote, using the eligible pubkeys as the ring
3. The ring signature proves "I am one of the eligible voters" without revealing which one
4. A **key image** is included — unique per voter per election, enabling double-vote detection
5. After the election closes, a tally authority decrypts and counts valid ballots
6. The **Election Result** is published with verification data so anyone can audit

## Cryptography

- **LSAG** (Linkable Spontaneous Anonymous Group) signatures on secp256k1 via [`@forgesworn/ring-sig`](https://www.npmjs.com/package/@forgesworn/ring-sig)
- **ECDH + HKDF** for ballot encryption (voter ↔ tally authority)
- **Schnorr signatures** (BIP-340) for Nostr event signing

## API

### Election

- `createElection(privkey, params)` — Create and sign an election event
- `parseElection(event)` — Parse an election event into structured data
- `validateElection(event)` — Validate election event structure

### Voting

- `castBallot(privkey, params)` — Cast an anonymous ballot with LSAG signature
- `verifyBallot(ballot, election)` — Verify ballot signature and eligibility
- `validateBallot(event)` — Validate ballot event structure

### Tallying

- `tallyElection(privkey, params)` — Decrypt and count ballots, publish result
- `encryptBallotContent(plaintext, sharedSecret)` — Encrypt vote content
- `decryptBallotContent(ciphertext, sharedSecret)` — Decrypt vote content
- `validateElectionResult(event)` — Validate result event structure

## Licence

MIT

# Weighted anonymous voting at crowd scale

Design note. Two problems block `nostr-anon-vote` from serving stake-weighted
crowdfunding milestone approval:

1. **Weight.** Ring membership is binary, so a ring vote is one-member-one-vote.
   Crowdfunding wants approval weighted by contribution.
2. **Scale.** LSAG is linear in ring size. A few thousand donors means a few
   thousand ring members per ballot.

Short answer: both are solvable, and above a certain tier they are the same
problem with the same solution.

Before either matters there is a live defect: **the library currently rejects
its own ballots above a ring size of 5.** That is measured, not theoretical, and
it is the first thing to fix.

---

## Why the current design cannot express weight

`computeKeyImage` derives `I = x · H_p(P ‖ electionId)`. It is deterministic
given a private key and an election. One key in one election yields exactly one
key image, and a second ballot under the same key image is rejected as a
duplicate. That is precisely the property that makes double-vote prevention
work, and it is the same property that makes weight inexpressible.

Weight therefore cannot be added by letting a voter cast `w` ballots. Deriving
the key image from `(key, ballotIndex)` would allow `w` ballots but would also
allow unbounded ballots, since nothing constrains the index. The bound has to
come from somewhere other than the signature.

There are three places it can come from, in increasing order of cost and
strength: the electorate partition, a blind-signature issuer, or a zero-knowledge
proof over committed weights.

---

## Before any of that: the library capped out at 5 voters — FIXED 2026-07-28

`validateBallot` calls `validateFieldSizeBounds`, which rejects any tag value
over `MAX_TAG_VALUE_LENGTH = 1024`. The `ring-sig` tag holds the JSON-serialised
`LsagSignature`, which grows by ~134 bytes per ring member. Measured against the
built package:

| Ring size | `ring-sig` tag chars | `validateBallot` |
|----------:|---------------------:|------------------|
| 3 | 686 | pass |
| 5 | 954 | pass |
| 6 | 1088 | **fail** |
| 128 | 17 440 | fail |

**`castBallot` produces ballots that `validateBallot` rejects at ring sizes
above 5**, while `MAX_RING_SIZE` in the same dependency is 1000. Any consumer
that casts and then validates has a broken flow past five voters, and an
anonymity set of five is barely anonymity at all.

This is a live defect, not a scaling concern, and it blocks everything below.

**Fixed.** The signature now lives in `content`, bounded at 65 536 rather than
1024, with `ring` and `keyImage` stripped and reconstructed by the verifier.
Measured after the fix:

| Ring size | content | Largest tag | `validateBallot` | `verifyBallot` |
|----------:|--------:|------------:|---|---|
| 5 | 0.5 KB | 152 | pass | pass |
| 6 | 0.6 KB | 152 | pass | pass |
| 128 | 8.6 KB | 152 | pass | pass |
| 512 | 33.7 KB | 152 | pass | pass |

Largest tag length is now **constant at 152 characters** regardless of ring
size, so the 1024 bound is no longer a function of the ring at all. The
practical ceiling is ~990 members, set by the content cap, which finally agrees
with ring-sig's `MAX_RING_SIZE` of 1000.

Relay-level event size limits are now the binding constraint at around 500
members, which is where the rest of this document picks up.

---

## Current ceiling, measured

Figures below are measured against `@forgesworn/ring-sig@1.0.1` on an M4, and
describe the constraints that apply *once the tag-size defect above is fixed*.

`LsagSignature` carries `responses: string[]` and `ring: string[]`, one entry
each per member, JSON-serialised into a `ring-sig` tag:

| Ring size | Sign | Verify | Ballot on wire | Without `ring` |
|----------:|-----:|-------:|---------------:|---------------:|
| 128 | 1.2 s | 1.0 s | 17.6 KB | 9.0 KB |
| 256 | 2.2 s | 2.2 s | 34.8 KB | 17.6 KB |
| 512 | 4.1 s | 4.2 s | 69.3 KB | 34.8 KB |
| 1000 | 7.5 s | 7.2 s | 135.1 KB | 67.7 KB |

**`MAX_RING_SIZE = 1000` is above what relays will carry.** The effective size
ceiling today is 256, maybe 512 against permissive relays.

**But time is the harder limit, not size.** Verification is `O(n)` per ballot
and a tally is `O(n · B)` over `B` ballots. At n=500, a tally of 1000 ballots
takes **58 minutes**. That is the real blocker, and it bites well before the
relay size cap does.

### The constant factor is mostly a bug, and it is a 12x win

Per ring member, LSAG performs one base-point multiplication, three
arbitrary-point multiplications and one `hashToPoint`. The arbitrary-point
multiplications dominate at ~2.3 ms each, which is roughly 20x slower than
secp256k1 scalar multiplication should be in this library.

The cause is that `safeMultiply` calls `point.multiply(s)` on points that have
no precomputed table. noble builds wNAF tables lazily and only on request:

| | µs per scalar mult | |
|---|---:|---|
| `multiply`, no precompute (current) | 2655 | |
| `multiply`, after `precompute(8)` | 225 | **11.8x**, still constant-time |
| `multiplyUnsafe`, after `precompute(8)` | 214 | 12.4x, verify path only |

**The entire win comes from precomputation, which is security-neutral.**
`multiplyUnsafe` buys a further 5 per cent and is not worth the argument about
whether the verify path is safely non-constant-time. Just precompute.

Applied to a full ballot verification at n=500:

| | per ballot | tally of 1000 |
|---|---:|---:|
| current | 3456 ms | 58 min |
| precomputed ring (warm) | 385 ms | 6.4 min |

Two caveats. The tables build lazily on first use, costing ~15 s one-off for a
500-member ring, so precomputation is a large win when verifying a batch and a
net **loss** when verifying a single ballot. Gate it on batch size. And the
tables cost memory, roughly 6 MB at n=500 with window 8; tune the window down
if that matters.

Also cache `H_p(P ‖ electionId)` per member per election. It is identical for
every ballot in an election and is currently recomputed for each one.

**This does not change the asymptotics.** It buys about one order of magnitude,
moving the practical ceiling from ~256 members to ~1000-2000. Beyond that the
log-size constructions below are still required.

**Free 2x on size: stop shipping the ring.** The `ring` array is roughly half
the payload and is fully reconstructible from the election definition plus a
deterministic subring rule. Replacing it with a subring identifier takes n=512
from 69 KB to 35 KB. No cryptographic change, no security loss.

A second issue: `castBallot` takes `eligibleRing` from the caller rather than
deriving it from the election event. Voter-chosen rings are vulnerable to
intersection attacks, since a voter who appears across several self-selected
rings can be identified by the overlap. The ring must be derived, not supplied.

**Free 2x: stop shipping the ring.** The `ring` array is roughly half the
payload and is fully reconstructible from the election definition plus a
deterministic subring rule. Replacing it with a subring identifier takes
n=512 from ~69 KB to ~35 KB. No cryptographic change, no security loss.

A second issue: `castBallot` takes `eligibleRing` from the caller rather than
deriving it from the election event. Voter-chosen rings are vulnerable to
intersection attacks, since a voter who appears across several self-selected
rings can be identified by the overlap. The ring must be derived, not supplied.

---

## Tier 1: quantised weight bands

Ships on the existing primitive. No new cryptography.

Partition the electorate into bands by contribution and run one election per
band, each with its own `electionId`. Ballot weight is the band's nominal
weight. The final tally is the sum over bands of band weight times band votes.

Key images already bind to `electionId`, so a donor in band 3 produces a key
image valid only in band 3's election, and ring membership prevents voting in
any other band. Double-vote prevention is unchanged.

**Banding function.** Use `floor(log2(sats))`. Cashu denominations are already
powers of two, so this is native to a Cashu-funded campaign.

**Minimum occupancy.** If a band holds fewer than `k` members, merge it into the
adjacent band. Without this a whale sits alone in the top band and is
deanonymised by the fact of having voted at all. Merging costs the whale some
weight. That is the price, and it doubles as a plutocracy damper.

**What leaks.** Your band, which is a coarse bucket of your contribution size.
In most Nostr crowdfunds donations arrive as public zaps or on-chain payments,
so contribution size is already public and the marginal leak is zero. The thing
that must stay private is how you voted, and that is preserved.

**Split resistance.** Linear weight with round-down banding is split-resistant:
one contribution of 10,000 sits in band 8192, whereas ten of 1,000 sit in band
512 each for 5,120 total. Splitting loses, so no sybil defence is required.

**If you want quadratic weighting** (`weight = sqrt(sats)`, which compresses a
power-law donor distribution and populates bands much more evenly) note that it
is **only sound with a sybil-resistant identity layer**. Under a concave weight
function, splitting 10,000 into ten contributions of 1,000 turns a weight of 100
into 316. Quadratic voting has always required identity, and this is where
`nostr-veil` earns its place in the stack: WoT-backed personhood is exactly the
missing input. The two libraries compose here rather than overlapping.

---

## Tier 2: Cashu-native blinded vote tokens

Fits a Cashu-funded campaign directly, and blind signatures are the classic
anonymous voting primitive (Chaum 1988; Fujioka, Okamoto and Ohta 1992).

At contribution time the campaign escrow issues blinded vote tokens denominated
by contribution. At milestone vote time the donor spends tokens against an
option. The mint's spent-secret set prevents double spending; the blind
signature makes issuance unlinkable from spend. Weight is native because tokens
are denominated.

**Amount fingerprinting** is the failure mode. Spending 4096+512+256+128+8 in
one go re-identifies a 5,000 sat donor by the denomination pattern. Mitigate by
swapping at the mint before voting, which Cashu supports natively, and by voting
in fixed denominations.

**Trust.** The issuer could mint phantom vote tokens for itself. This is an
integrity assumption, not a privacy one, and it is publicly auditable: total
issuance must reconcile against the public contribution ledger. Publish a
commitment to issuance and let anyone check it.

This is the pragmatic strong option. No new zero-knowledge machinery, and it
slots into a stack that already has a mint in it.

---

## Tier 3: one-out-of-many proofs over committed weights

This is where the two gaps collapse into one.

At contribution time, publish a Pedersen commitment per member,
`C_i = g^(w_i) · h^(r_i)`, binding member `i` to weight `w_i`.

At vote time the voter produces:

- a re-randomised `C' = C_i · h^(r')`
- a proof that `C' / C_j` opens to zero for **some** `j` in the electorate,
  without revealing `j`
- a key image, for double-vote prevention as today
- the option choice, with `C'` encrypted under exponential ElGamal to the tally
  key

Tally sums ciphertexts per option homomorphically and threshold-decrypts. The
weighted total is revealed; no individual weight ever is.

The proof in step two is a **one-out-of-many proof** (Groth and Kohlweiss,
Eurocrypt 2015), which is `O(log n)` in size, needs no trusted setup, and works
in any prime-order group including secp256k1. **That same proof is a log-size
ring signature.** Groth and Kohlweiss present it as both, in one paper.

So:

- Gap 1 solved: weight is carried in a commitment nobody can open.
- Gap 2 solved: membership proof is `O(log n)` instead of `O(n)`.
- One construction, both properties.

**Triptych** (Noether and Goodell, Monero Research Lab, 2020) is the
ready-made form: a log-size *linkable* ring signature with key images, built on
one-out-of-many, designed explicitly as LSAG's successor. It keeps the key image
semantics this library already depends on, so double-vote prevention survives the
migration unchanged.

**Costs, stated honestly.** Proof *size* is `O(log n)`, low single-digit KB at
n=4096, which fits a Nostr event comfortably. Verification is still `O(n)` group
operations, because the verifier must fold in every ring member's commitment.

So one-out-of-many fixes the size problem outright and improves but does not
eliminate the time problem. What it does change is that the `O(n)` work becomes
a single multiexponentiation, which Pippenger handles far better than LSAG's
inherently sequential challenge chain, and which batches across ballots. The
measured LSAG numbers above cannot be batched at all, because each member's
challenge depends on the previous one. That structural difference matters more
than the asymptotic notation suggests.

**Curve.** secp256k1 throughout, no pairings. The ring is literal Nostr pubkeys
with no separate identity ceremony. This is the significant practical advantage
over the SNARK route below.

`tallyPubkeys` and `tallyThreshold` already exist in `ElectionParams` but
`castBallot` encrypts to `tallyPubkeys[0]` only, so threshold tally is declared
and not implemented. Tier 3 needs it for real, and FROST is the natural fit,
which also happens to be what a BAO dispute court would already be running.

---

## Tier 4: Merkle accumulator with nullifiers

Semaphore-style. A Merkle tree of identity commitments, a SNARK proof of
membership, and a nullifier for double-vote prevention. Constant proof size
around 200 bytes, constant verification, anonymity sets in the millions.

Costs a Groth16 trusted setup, runs on BN254 rather than secp256k1 (so identity
commitments are derived from Nostr keys rather than being Nostr keys), and
proving in a browser is order seconds. Only worth it at national scale.

---

## Mapping to the existing type surface

`ElectionScale` is already `'organisational' | 'community' | 'national'`. That
maps onto the tiers almost exactly:

| Scale | Electorate | Construction | Ballot size |
|-------|-----------:|--------------|------------:|
| organisational | to ~1000 | LSAG, precomputed, banded weights | ~35 KB |
| community | to ~10k | Triptych, committed weights | low single-digit KB |
| national | 10k+ | Merkle + nullifier | ~200 bytes |

The `organisational` figure assumes the precomputation fix. Without it the
honest ceiling is ~256.

`ringSize` is parsed and range-checked but never used to sample. Wiring it to a
**deterministic** subring assignment, seeded from `(electionId, memberIndex)` so
that it is public and not voter-chosen, caps both ballot size and verification
time at any electorate size, at the cost of an honestly reduced anonymity set of
`ringSize` rather than the full electorate.

---

## Recommended order

0. ~~**Move `ring-sig` out of a tag and into `content`.**~~ **Done 2026-07-28**,
   along with dropping `ring` from the wire format, the `ring-hash` election
   commitment, and the ring-sig v1 → v3 / noble v2 upgrade. Ceiling 5 → ~990.
1. **Add a reusable verifier context to `ring-sig` that caches parsed and
   precomputed ring points, plus `H_p(P ‖ electionId)`, across verifications.**
   11x on the tally path, output-neutral, additive API so no consumer changes.
   Gate precomputation on batch size, since it is a net loss for a single
   ballot. Benefits all 13 dependents, not just this repo.
2. Lower `MAX_RING_SIZE` to something relays actually carry, drop `ring` from
   the serialised signature, and derive the ring from the election rather than
   taking it from the caller. The last of these is a privacy fix, not just a
   size one.
3. Implement deterministic subring assignment from `ringSize`.
4. Add banded weights with minimum occupancy. Delivers weighted milestone
   approval on the existing primitive.
5. Implement real threshold tally against `tallyThreshold`. Needed by everything
   above tier 1 and useful on its own.
6. Triptych behind the existing signature interface. Key image semantics are
   preserved, so this is a swap rather than a redesign.

Steps 1 to 4 are engineering, and step 1 is close to free. Step 6 is the
research-shaped one, and even that is implementation of a published,
peer-reviewed construction rather than novel cryptography.

---

## Blast radius: what breaks

`@forgesworn/ring-sig` has 13 dependents in the workspace, on four different
pinning strategies:

| Version | Repos |
|---------|-------|
| `^3.0.0` | `nostr-veil`, `bray`, `bray-site`, `bray-event-validation`, `bray-payment-protocol`, `signet` |
| `^1.0.x` | `nostr-anon-vote`, `signet-protocol` |
| git pin `186560f` | `hawker-kit`, `toll-kit`, `meatchat-shared-library-split` |
| vendored | `meatchat` |

**v1 and v3 are wire-compatible.** Measured directly: v3 verifies v1 signatures,
v1 verifies v3 signatures, and key images are byte-identical across versions.
That last point matters most, because key images are what double-vote detection
relies on; if they diverged, an upgrade would silently reopen double voting. The
v1→v2→v3 majors were an API break (noble v2 import paths) and a validation
tightening (`hexToScalar` rejecting non-canonical scalars), not a format change.

So `nostr-anon-vote` can move v1 → v3 with no data migration and no re-signing.

**`nostr-veil` does not have the tag-size defect.** Its `serialiseSig` already
excludes `ring` and `keyImage` from the per-signature payload, keeping the ring
in a separate `veil-ring` tag and the key image as the third tag element. That
is the same optimisation recommended above for `nostr-anon-vote`, already
implemented. Veil also enforces no `MAX_TAG_VALUE_LENGTH`, so nothing in veil
self-rejects.

**Change-by-change impact:**

| Change | Touches | Breaks |
|--------|---------|--------|
| Precompute / point cache | `ring-sig` internals | Nothing. Output-neutral, verified: key images stable, signatures still verify |
| `ring-sig` tag → `content` | `nostr-anon-vote` only | Existing anon-vote ballots. Needs a compat read path |
| Drop `ring` from signature | `nostr-anon-vote` only | Same. Veil already does this |
| Banded weights | `nostr-anon-vote` additive | Nothing |
| Real threshold tally | `nostr-anon-vote` | Nothing if 1-of-1 stays the default |
| Triptych | new `ring-sig` major | Nothing until a consumer opts in |

### The precompute fix needs a small API, not a one-liner

`pubkeyToPoint` calls `Point.fromHex` on every invocation, so points are rebuilt
per call and any externally attached wNAF table is discarded. Measured:
precomputing the ring from outside the library gives **1.03x**, i.e. nothing.

The 11x is only reachable if `ring-sig` caches parsed and precomputed ring
points itself and reuses them across verifications. That means an **additive**
export, something like a reusable verifier context bound to a ring and election,
leaving `lsagVerify` untouched for existing callers. Additive, so no major bump
and no consumer changes required, but it is a small design task rather than a
one-line patch.

### Test baselines

- `nostr-veil`: 292/292 pass. Four failures appear if `dist/` is stale, because
  the docs and examples tests resolve `nostr-veil` by package name; `npm run
  build` clears them. Not a code defect.
- `nostr-anon-vote`: 44/44 pass.

The anon-vote suite passes *because* its largest ring is 3 members and the
validation bound is 5. The ring-size defect is invisible to the tests by two
members. Any fix should add a test at a realistic ring size.

---

## References

- Groth and Kohlweiss, *One-Out-of-Many Proofs: Or How to Leak a Secret and
  Spend a Coin*, Eurocrypt 2015.
- Noether and Goodell, *Triptych: logarithmic-sized linkable ring signatures
  with applications*, Monero Research Lab, 2020.
- Chaum, *Elections with Unconditionally-Secret Ballots*, Eurocrypt 1988.
- Fujioka, Okamoto and Ohta, *A Practical Secret Voting Scheme for Large Scale
  Elections*, Auscrypt 1992.

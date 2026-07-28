// nostr-anon-vote Types

/** Asymmetric cryptographic algorithm for event signing and key agreement. */
export type CryptoAlgorithm = 'secp256k1' | (string & {});

// --- Base Nostr Event ---

export interface UnsignedEvent {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface NostrEvent extends UnsignedEvent {
  id: string;
  sig: string;
}

// --- Voting Extension ---

/** Election scale */
export type ElectionScale = 'organisational' | 'community' | 'national';

/** Re-vote policy */
export type ReVotePolicy = 'allowed' | 'denied';

/** Kind 30482: Election Definition */
export interface ElectionParams {
  electionId: string;
  title: string;
  description?: string;
  options: string[];
  scale: ElectionScale;
  /** Consumer-defined eligibility group tags (e.g. 'natural_person', 'member', etc.) */
  eligibleEntityTypes: string[];
  /** Consumer-defined minimum tier value (numeric string stored in tag) */
  eligibleMinTier: number;
  eligibleCommunity?: string;
  opens: number;
  closes: number;
  reVote: ReVotePolicy;
  tallyPubkeys: string[];
  tallyThreshold?: [m: number, n: number];
  ringSize?: number;
  /** Eligible voter ring. When supplied, its hash is committed to the election
   *  as a `ring-hash` tag so the ring cannot be substituted per-ballot. */
  eligibleRing?: string[];
}

export interface ParsedElection {
  electionId: string;
  title: string;
  description?: string;
  options: string[];
  scale: ElectionScale;
  eligibleEntityTypes: string[];
  eligibleMinTier: number;
  eligibleCommunity?: string;
  opens: number;
  closes: number;
  reVote: ReVotePolicy;
  tallyPubkeys: string[];
  tallyThreshold?: [m: number, n: number];
  ringSize?: number;
  /** Commitment to the eligible ring, if the election declared one. */
  ringHash?: string;
  authorityPubkey: string;
  algorithm: CryptoAlgorithm;
}

/** Kind 30483: Ballot */
export interface BallotParams {
  electionId: string;
  electionEventId: string;
  keyImage: string;
  ringSig: string;
  encryptedVote: string;
}

export interface ParsedBallot {
  electionId: string;
  electionEventId: string;
  keyImage: string;
  ringSig: string;
  encryptedVote: string;
  ephemeralPubkey: string;
  timestamp: number;
  algorithm: CryptoAlgorithm;
}

/** Kind 30484: Election Result */
export interface ElectionResultParams {
  electionId: string;
  electionEventId: string;
  results: Array<{ option: string; count: number }>;
  totalBallots: number;
  totalEligible: number;
  totalInvalid?: number;
  tallyProof?: string;
}

export interface ParsedElectionResult {
  electionId: string;
  electionEventId: string;
  results: Array<{ option: string; count: number }>;
  totalBallots: number;
  totalEligible: number;
  totalInvalid: number;
  tallyProof?: string;
  tallierPubkey: string;
  algorithm: CryptoAlgorithm;
}

/** Return type for validation functions */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

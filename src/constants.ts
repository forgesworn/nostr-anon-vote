/** Voting event kind numbers (placeholder pending NIP assignment) */
export const VOTING_KINDS = {
  ELECTION: 30482,
  BALLOT: 30483,
  ELECTION_RESULT: 30484,
} as const;

/** Default NIP-32 namespace label for anonymous voting events */
export const DEFAULT_LABEL = 'anon-vote';

/** Default asymmetric cryptographic algorithm (Nostr standard secp256k1) */
export const DEFAULT_CRYPTO_ALGORITHM = 'secp256k1' as const;

/** Base error for all nostr-anon-vote errors */
export class VotingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VotingError';
  }
}

/** Validation errors (malformed events, missing fields, bounds exceeded) */
export class ValidationError extends VotingError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Cryptographic errors (invalid keys, failed verification, bad proofs) */
export class CryptoError extends VotingError {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

// Nostr event utilities for nostr-anon-vote
// Schnorr signatures (BIP-340) on secp256k1, event ID computation, tag helpers

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { UnsignedEvent, NostrEvent } from './types.js';

export const MAX_CONTENT_LENGTH = 65536;
export const MAX_TAG_VALUE_LENGTH = 1024;
export const MAX_TAGS_COUNT = 100;

/** Generate a new secp256k1 keypair. Returns { privateKey, publicKey } as hex strings.
 *  Public key is x-only (32 bytes) per BIP-340 / Nostr convention. */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const privateKeyRaw = schnorr.utils.randomSecretKey();
  const publicKey = schnorr.getPublicKey(privateKeyRaw);
  const privateKey = bytesToHex(privateKeyRaw);
  const publicKeyHex = bytesToHex(publicKey);
  // Zero the raw bytes
  privateKeyRaw.fill(0);
  return {
    privateKey,
    publicKey: publicKeyHex,
  };
}

/** Get x-only public key (32 bytes hex) from a private key */
export function getPublicKey(privateKey: string): string {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
}

/** Serialize a Nostr event for hashing (NIP-01) */
function serializeEvent(event: UnsignedEvent): string {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

/** Compute the event ID (SHA-256 of the serialised event) */
export function getEventId(event: UnsignedEvent): string {
  const serialized = serializeEvent(event);
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}

/** Sign an unsigned event, returning a full NostrEvent */
export async function signEvent(
  event: UnsignedEvent,
  privateKey: string,
): Promise<NostrEvent> {
  const id = getEventId(event);
  // noble v2 requires Uint8Array for both message and secret key.
  const sig = schnorr.sign(hexToBytes(id), hexToBytes(privateKey));
  return {
    ...event,
    id,
    sig: bytesToHex(sig),
  };
}

/** Get a tag value by name from a Nostr event */
export function getTagValue(
  event: NostrEvent | { tags: string[][] },
  name: string,
): string | undefined {
  const tag = event.tags.find((t) => t[0] === name);
  return tag?.[1];
}

/** Validate field-size bounds on untrusted event data */
export function validateFieldSizeBounds(event: NostrEvent, errors: string[]): void {
  if (event.content.length > MAX_CONTENT_LENGTH) {
    errors.push(`Event content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
  }
  if (event.tags.length > MAX_TAGS_COUNT) {
    errors.push(`Event has too many tags (max ${MAX_TAGS_COUNT})`);
  }
  for (const t of event.tags) {
    for (let i = 1; i < t.length; i++) {
      if (t[i] !== undefined && t[i].length > MAX_TAG_VALUE_LENGTH) {
        errors.push(
          `Tag value at index ${i} for "${t[0]}" exceeds maximum length of ${MAX_TAG_VALUE_LENGTH} characters`,
        );
      }
    }
  }
}

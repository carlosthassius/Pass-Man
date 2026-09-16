export const KDF_ITERATIONS = 600000;

export function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

export function base64ToBytes(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

export async function deriveEncryptionKey(password, salt, iterations = KDF_ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations, hash:'SHA-256' }, material, { name:'AES-GCM', length:256 }, false, ['encrypt', 'decrypt']);
}

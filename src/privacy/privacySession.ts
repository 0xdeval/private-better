type EncryptedPayload = {
  iv: string;
  ciphertext: string;
};

export type PrivacyLocalSession = {
  privateAddress: string;
  mnemonic: string;
  positionSecrets: Record<string, string>;
  updatedAt: number;
};

const SESSION_VERSION = 1;
const STORAGE_PREFIX = 'pb.privacy.session';

type WrappedSession = {
  version: number;
  payload: EncryptedPayload;
};

const assertWebCrypto = () => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API is unavailable in this browser context.');
  }
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex length for session key.');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
};

const importAesKey = async (sessionKeyHex: string): Promise<CryptoKey> => {
  assertWebCrypto();
  const keyBytes = hexToBytes(sessionKeyHex);
  if (keyBytes.length !== 32) {
    throw new Error('Session key must be 32 bytes.');
  }
  return crypto.subtle.importKey('raw', Uint8Array.from(keyBytes), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
};

const encryptPayload = async (sessionKeyHex: string, plainText: string): Promise<EncryptedPayload> => {
  const key = await importAesKey(sessionKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
};

const decryptPayload = async (sessionKeyHex: string, payload: EncryptedPayload): Promise<string> => {
  const key = await importAesKey(sessionKeyHex);
  const iv = Uint8Array.from(base64ToBytes(payload.iv));
  const ciphertext = Uint8Array.from(base64ToBytes(payload.ciphertext));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
};

const storageKey = (chainId: bigint, eoaAddress: string): string =>
  `${STORAGE_PREFIX}:v${SESSION_VERSION}:${chainId.toString()}:${eoaAddress.toLowerCase()}`;

export const loadPrivacySession = async (
  chainId: bigint,
  eoaAddress: string,
  sessionKeyHex: string,
): Promise<PrivacyLocalSession | null> => {
  const raw = localStorage.getItem(storageKey(chainId, eoaAddress));
  if (!raw) return null;

  const wrapped = JSON.parse(raw) as WrappedSession;
  if (!wrapped?.payload?.ciphertext || !wrapped?.payload?.iv) {
    return null;
  }
  if (wrapped.version !== SESSION_VERSION) {
    return null;
  }

  const plain = await decryptPayload(sessionKeyHex, wrapped.payload);
  const parsed = JSON.parse(plain) as PrivacyLocalSession;
  if (!parsed.privateAddress || !parsed.mnemonic) {
    return null;
  }
  parsed.positionSecrets ??= {};
  parsed.updatedAt ??= Date.now();
  return parsed;
};

export const savePrivacySession = async (
  chainId: bigint,
  eoaAddress: string,
  sessionKeyHex: string,
  session: PrivacyLocalSession,
): Promise<void> => {
  const payloadText = JSON.stringify({
    ...session,
    positionSecrets: session.positionSecrets ?? {},
    updatedAt: Date.now(),
  });
  const payload = await encryptPayload(sessionKeyHex, payloadText);
  const wrapped: WrappedSession = {
    version: SESSION_VERSION,
    payload,
  };
  localStorage.setItem(storageKey(chainId, eoaAddress), JSON.stringify(wrapped));
};

export const clearPrivacySession = (chainId: bigint, eoaAddress: string): void => {
  localStorage.removeItem(storageKey(chainId, eoaAddress));
};

export const clearLegacyRailgunStorage = async (): Promise<void> => {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith('pb.railgun.session') || key.startsWith('railgun-artifact')) {
      localStorage.removeItem(key);
    }
  }

  if (typeof indexedDB === 'undefined') return;

  const dbNames = ['railgun_engine_db_arbitrum_v2', 'railgun_artifacts_db:arbitrum_v2'];
  await Promise.all(
    dbNames.map(
      (dbName) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(dbName);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        }),
    ),
  );
};

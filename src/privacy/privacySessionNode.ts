import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type PrivacyLocalSession = {
  privateAddress: string;
  mnemonic: string;
  positionSecrets: Record<string, string>;
  updatedAt: number;
};

const STORE_VERSION = 1;
const STORE_PATH = join(process.cwd(), '.data', 'privacy-session.json');

type SessionStore = {
  version: number;
  sessions: Record<string, PrivacyLocalSession>;
};

const sessionKey = (chainId: bigint, eoaAddress: string): string =>
  `${chainId.toString()}:${eoaAddress.toLowerCase()}`;

const readStore = async (): Promise<SessionStore> => {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as SessionStore;
    if (parsed.version !== STORE_VERSION || typeof parsed.sessions !== 'object' || parsed.sessions == null) {
      return { version: STORE_VERSION, sessions: {} };
    }
    return parsed;
  } catch {
    return { version: STORE_VERSION, sessions: {} };
  }
};

const writeStore = async (store: SessionStore): Promise<void> => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
};

export const loadPrivacySessionNode = async (
  chainId: bigint,
  eoaAddress: string,
): Promise<PrivacyLocalSession | null> => {
  const store = await readStore();
  return store.sessions[sessionKey(chainId, eoaAddress)] ?? null;
};

export const savePrivacySessionNode = async (
  chainId: bigint,
  eoaAddress: string,
  session: PrivacyLocalSession,
): Promise<void> => {
  const store = await readStore();
  store.sessions[sessionKey(chainId, eoaAddress)] = {
    ...session,
    positionSecrets: session.positionSecrets ?? {},
    updatedAt: Date.now(),
  };
  await writeStore(store);
};

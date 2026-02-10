import LevelJS from 'level-js';

type ArtifactStoreLike = {
  get: (path: string) => Promise<string | Buffer | null>;
  store: (dir: string, path: string, item: string | Uint8Array) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
};

const ARTIFACT_KEY_PREFIX = 'railgun-artifact:';

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

export const createWebDatabase = (dbLocationPath: string) => {
  return new LevelJS(dbLocationPath);
};

export const createBrowserArtifactStore = (): ArtifactStoreLike => {
  const getFile = async (path: string): Promise<string | Buffer | null> => {
    const raw = localStorage.getItem(`${ARTIFACT_KEY_PREFIX}${path}`);
    if (!raw) return null;

    if (raw.startsWith('str:')) {
      return raw.slice(4);
    }

    if (raw.startsWith('b64:')) {
      const bytes = base64ToBytes(raw.slice(4));
      return bytes as unknown as Buffer;
    }

    return raw;
  };

  const storeFile = async (
    _dir: string,
    path: string,
    item: string | Uint8Array,
  ): Promise<void> => {
    if (typeof item === 'string') {
      localStorage.setItem(`${ARTIFACT_KEY_PREFIX}${path}`, `str:${item}`);
      return;
    }

    localStorage.setItem(
      `${ARTIFACT_KEY_PREFIX}${path}`,
      `b64:${bytesToBase64(item)}`,
    );
  };

  const fileExists = async (path: string): Promise<boolean> => {
    return localStorage.getItem(`${ARTIFACT_KEY_PREFIX}${path}`) != null;
  };

  return {
    get: getFile,
    store: storeFile,
    exists: fileExists,
  };
};

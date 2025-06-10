import type { ObservedLogEntry } from "./logObserver";

const DB_NAME    = 'raftDB';
const STORE_NAME = 'snapshots';
const DB_VERSION = 1;

export interface SnapshotPayload {
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  state: (ObservedLogEntry<string> | null)[];
}

export type StoredSnapshot = SnapshotPayload & {
  id: string;
  timestamp: number;
};

function openSnapshotDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('byTimestamp', 'timestamp');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

export async function writeSnapshot(
  payload: SnapshotPayload
): Promise<void> {
  const db = await openSnapshotDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const id = `${payload.lastIncludedIndex}-${payload.lastIncludedTerm}`;
    const record: StoredSnapshot = {
      ...payload,
      id,
      timestamp: Date.now(),
    };

    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function readLatestSnapshot(): Promise<StoredSnapshot | null> {
  const db = await openSnapshotDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const idx   = store.index('byTimestamp');

    const req = idx.openCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? (cursor.value as StoredSnapshot) : null);
    };
    req.onerror = () => reject(req.error);
  });
}


export async function readSnapshot(
  id: string
): Promise<StoredSnapshot | null> {
  const db = await openSnapshotDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(id);
    req.onsuccess = () => {
      resolve((req.result as StoredSnapshot) ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

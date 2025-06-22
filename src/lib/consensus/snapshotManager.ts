import type { ObservedLogEntry } from "./logObserver";

const DB_NAME = 'raftDB';
const STORE_NAME = 'snapshots';
const DB_VERSION = 1;
const SNAPSHOT_KEY = 'latest';

interface SnapshotRecord {
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  state: (ObservedLogEntry<string> | null)[];
}

type StoredSnapshot = SnapshotRecord & { key: string; timestamp: number };

function openSnapshotDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('byTimestamp', 'timestamp');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function writeSnapshot(payload: SnapshotRecord): Promise<void> {
  let mergeState = true;
  const existing = await readSnapshot();
  
  if (payload.state.includes(null)) {
    mergeState = false;
  }
  
  const record: StoredSnapshot = {
    key: SNAPSHOT_KEY,
    lastIncludedIndex: payload.lastIncludedIndex,
    lastIncludedTerm: payload.lastIncludedTerm,
    state: existing && mergeState ? [...existing.state, ...payload.state] : [...payload.state],
    timestamp: Date.now()
  };

  const db = await openSnapshotDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function readSnapshot(): Promise<StoredSnapshot | null> {
  const db = await openSnapshotDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(SNAPSHOT_KEY);
    req.onsuccess = () => resolve(req.result as StoredSnapshot | null);
    req.onerror = () => reject(req.error);
  });
}


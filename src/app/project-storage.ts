import type { EnvironmentTemplate } from "./types";

const DB_NAME = "directorboard-project-storage";
const DB_VERSION = 1;
const ENVIRONMENT_STORE = "environment-templates";

type StoredEnvironmentRecord = {
  id: string;
  name: string;
  splat: {
    path: string;
    sizeBytes: number;
    fileType: string;
    blob: Blob;
  };
  collision: {
    path: string;
    sizeBytes: number;
    fileType: string;
    blob: Blob;
  };
  defaults?: EnvironmentTemplate["defaults"];
};

export async function saveUploadedEnvironmentTemplate(
  template: EnvironmentTemplate,
) {
  if (!template.splat?.file || !template.collision?.file) {
    throw new Error("Uploaded environment template must include file blobs.");
  }

  const db = await openProjectDatabase();
  const record: StoredEnvironmentRecord = {
    id: template.id,
    name: template.name,
    splat: {
      path: template.splat.path,
      sizeBytes: template.splat.sizeBytes,
      fileType: template.splat.fileType,
      blob: template.splat.file,
    },
    collision: {
      path: template.collision.path,
      sizeBytes: template.collision.sizeBytes,
      fileType: template.collision.fileType,
      blob: template.collision.file,
    },
    defaults: template.defaults,
  };

  await runTransaction(db, ENVIRONMENT_STORE, "readwrite", (store) => {
    store.put(record);
  });
  db.close();
}

export async function loadUploadedEnvironmentTemplates() {
  const db = await openProjectDatabase();
  const records = await readAllRecords<StoredEnvironmentRecord>(
    db,
    ENVIRONMENT_STORE,
  );
  db.close();

  return records.map(
    (record): EnvironmentTemplate => ({
      id: record.id,
      name: record.name,
      source: "upload",
      splat: {
        path: record.splat.path,
        sizeBytes: record.splat.sizeBytes,
        fileType: record.splat.fileType,
        objectUrl: URL.createObjectURL(record.splat.blob),
      },
      collision: {
        path: record.collision.path,
        sizeBytes: record.collision.sizeBytes,
        fileType: record.collision.fileType,
        objectUrl: URL.createObjectURL(record.collision.blob),
      },
      defaults: normalizeUploadedTemplateDefaults(record.defaults),
    }),
  );
}

function normalizeUploadedTemplateDefaults(
  defaults: EnvironmentTemplate["defaults"],
): EnvironmentTemplate["defaults"] {
  if (!defaults?.transform) return defaults;

  const { rotation } = defaults.transform;
  const hasLegacyRootFlip =
    Math.abs(rotation[0] - Math.PI) < 0.0001 &&
    Math.abs(rotation[1]) < 0.0001 &&
    Math.abs(rotation[2]) < 0.0001;

  if (!hasLegacyRootFlip) return defaults;

  return {
    ...defaults,
    transform: {
      ...defaults.transform,
      rotation: [0, 0, 0],
    },
  };
}

function openProjectDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENVIRONMENT_STORE)) {
        db.createObjectStore(ENVIRONMENT_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    operation(store);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function readAllRecords<T>(db: IDBDatabase, storeName: string) {
  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

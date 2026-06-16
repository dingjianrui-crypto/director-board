import type { DirectorScene, SceneAssets } from "./types";
import { createSceneWorld } from "./sample-data";

const DB_NAME = "directorboard-project-storage";
const DB_VERSION = 2;
const IMPORTED_SCENE_STORE = "imported-scenes";
const LEGACY_ASSET_STORE = "environment-templates";

type StoredImportedSceneRecord = {
  id: string;
  name: string;
  slug: string;
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
  defaults?: SceneAssets["defaults"];
};

type LegacyAssetRecord = {
  id: string;
  name: string;
  splat: StoredImportedSceneRecord["splat"];
  collision: StoredImportedSceneRecord["collision"];
  defaults?: SceneAssets["defaults"];
};

export async function saveImportedScene(scene: DirectorScene) {
  if (!scene.assets.splat?.file || !scene.assets.collision?.file) {
    throw new Error("Imported scene must include file blobs.");
  }

  const db = await openProjectDatabase();
  const record: StoredImportedSceneRecord = {
    id: scene.id,
    name: scene.name,
    slug: scene.slug,
    splat: {
      path: scene.assets.splat.path,
      sizeBytes: scene.assets.splat.sizeBytes,
      fileType: scene.assets.splat.fileType,
      blob: scene.assets.splat.file,
    },
    collision: {
      path: scene.assets.collision.path,
      sizeBytes: scene.assets.collision.sizeBytes,
      fileType: scene.assets.collision.fileType,
      blob: scene.assets.collision.file,
    },
    defaults: scene.assets.defaults,
  };

  await runTransaction(db, IMPORTED_SCENE_STORE, "readwrite", (store) => {
    store.put(record);
  });
  db.close();
}

export async function deleteImportedScene(scene: DirectorScene) {
  const db = await openProjectDatabase();
  const deletions: Array<Promise<void>> = [];

  if (db.objectStoreNames.contains(IMPORTED_SCENE_STORE)) {
    deletions.push(
      runTransaction(db, IMPORTED_SCENE_STORE, "readwrite", (store) => {
        store.delete(scene.id);
      }),
    );
  }

  if (
    scene.assets.source === "upload" &&
    scene.id.startsWith("scene-import-") &&
    db.objectStoreNames.contains(LEGACY_ASSET_STORE)
  ) {
    deletions.push(
      runTransaction(db, LEGACY_ASSET_STORE, "readwrite", (store) => {
        store.delete(scene.id.replace(/^scene-import-/, ""));
      }),
    );
  }

  await Promise.all(deletions);
  db.close();
}

export async function loadImportedScenes() {
  const db = await openProjectDatabase();
  const records = db.objectStoreNames.contains(IMPORTED_SCENE_STORE)
    ? await readAllRecords<StoredImportedSceneRecord>(db, IMPORTED_SCENE_STORE)
    : [];
  const legacyRecords = db.objectStoreNames.contains(LEGACY_ASSET_STORE)
    ? await readAllRecords<LegacyAssetRecord>(db, LEGACY_ASSET_STORE)
    : [];
  db.close();

  const scenes = records.map(createSceneFromStoredRecord);
  const existingIds = new Set(scenes.map((scene) => scene.id));
  const legacyScenes = legacyRecords
    .filter((record) => !existingIds.has(`scene-import-${record.id}`))
    .map((record) =>
      createSceneFromStoredRecord({
        ...record,
        id: `scene-import-${record.id}`,
        slug: "INT. SCAN - DAY",
      }),
    );

  return [...scenes, ...legacyScenes];
}

function createSceneFromStoredRecord(record: StoredImportedSceneRecord): DirectorScene {
    const assets: SceneAssets = {
      id: `assets-${record.id}`,
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
      defaults: normalizeUploadedSceneDefaults(record.defaults),
    };

    return {
      id: record.id,
      name: record.name,
      slug: record.slug,
      origin: "user",
      assets,
      world: createSceneWorld(assets),
      objects: [],
      cameras: [],
      shots: [],
    };
}

function normalizeUploadedSceneDefaults(
  defaults: SceneAssets["defaults"],
): SceneAssets["defaults"] {
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
      if (!db.objectStoreNames.contains(IMPORTED_SCENE_STORE)) {
        db.createObjectStore(IMPORTED_SCENE_STORE, { keyPath: "id" });
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

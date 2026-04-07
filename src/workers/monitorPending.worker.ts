type MonitorSnapshotEntry = {
  path: string;
  id: string;
  isDirectory: boolean;
  modifiedAt: number;
};

type MonitorBaseline = {
  byPath: Map<string, MonitorSnapshotEntry>;
  byId: Map<string, MonitorSnapshotEntry>;
};

const monitorBaselines = new Map<string, MonitorBaseline>();
const monitorLastSnapshotAt = new Map<string, number>();

function isPathInFolderTree(path: string, folderPath: string) {
  if (!path || !folderPath || path === folderPath) {
    return false;
  }
  const normalizedFolder = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
  return path.startsWith(normalizedFolder);
}

function isPathEqualOrDescendantInSet(path: string, candidates: Set<string>) {
  if (candidates.size === 0 || !path) {
    return false;
  }
  if (candidates.has(path)) {
    return true;
  }
  if (path.startsWith("/") && candidates.has("/")) {
    return true;
  }
  let cursor = path;
  while (cursor.length > 1) {
    const separatorIndex = cursor.lastIndexOf("/");
    if (separatorIndex <= 0) {
      break;
    }
    cursor = cursor.slice(0, separatorIndex);
    if (candidates.has(cursor)) {
      return true;
    }
  }
  return false;
}

function buildMonitorBaseline(entries: MonitorSnapshotEntry[]): MonitorBaseline {
  const byPath = new Map<string, MonitorSnapshotEntry>();
  const byId = new Map<string, MonitorSnapshotEntry>();
  for (const entry of entries) {
    byPath.set(entry.path, entry);
    byId.set(entry.id, entry);
  }
  return { byPath, byId };
}

function dedupeMonitorEntriesByPath(entries: MonitorSnapshotEntry[]) {
  const map = new Map<string, MonitorSnapshotEntry>();
  for (const entry of entries) {
    map.set(entry.path, entry);
  }
  return Array.from(map.values());
}

function collapseMonitorPendingEntries(entries: MonitorSnapshotEntry[]) {
  const deduped = dedupeMonitorEntriesByPath(entries);
  deduped.sort((a, b) => a.path.localeCompare(b.path));
  
  const kept: MonitorSnapshotEntry[] = [];
  let currentParentPath: string | null = null;
  
  for (const entry of deduped) {
    if (currentParentPath && isPathInFolderTree(entry.path, currentParentPath)) {
      continue;
    }
    kept.push(entry);
    if (entry.isDirectory) {
      currentParentPath = entry.path;
    }
  }
  return kept;
}

function getMonitoredChangeEntries(baseline: MonitorBaseline | undefined, entries: MonitorSnapshotEntry[]) {
  if (!baseline) {
    return [];
  }
  return entries.filter((entry) => {
    if (!baseline.byPath.has(entry.path)) {
      return true;
    }
    const previous = baseline.byId.get(entry.id);
    if (!previous) {
      return true;
    }
    return previous.path !== entry.path;
  });
}

function getEntriesChangedSinceSnapshot(lastSnapshotAt: number | undefined, entries: MonitorSnapshotEntry[]) {
  if (!lastSnapshotAt) {
    return [];
  }
  return entries.filter((entry) => entry.modifiedAt > lastSnapshotAt);
}

function getMonitorCandidateEntries(options: {
  entries: MonitorSnapshotEntry[];
  baseline?: MonitorBaseline;
  lastSnapshotAt?: number;
  previousPendingEntries?: MonitorSnapshotEntry[];
}) {
  const snapshotByPath = new Map(options.entries.map((entry) => [entry.path, entry]));
  const previousPendingEntries = (options.previousPendingEntries ?? [])
    .map((entry) => snapshotByPath.get(entry.path))
    .filter((entry): entry is MonitorSnapshotEntry => Boolean(entry));

  return dedupeMonitorEntriesByPath([
    ...previousPendingEntries,
    ...getMonitoredChangeEntries(options.baseline, options.entries),
    ...getEntriesChangedSinceSnapshot(options.lastSnapshotAt, options.entries)
  ]);
}

export type WorkerRequest =
  | { type: 'setBaseline'; path: string; snapshot: MonitorSnapshotEntry[]; lastSnapshotAt: number }
  | { type: 'getBaseline'; requestId: number; path: string }
  | { type: 'deleteBaseline'; path: string }
  | { type: 'recalculatePending'; requestId: number; path: string; scannedEntries: MonitorSnapshotEntry[]; isIncremental: boolean; pathsToScan: string[]; currentPending: MonitorSnapshotEntry[] }
  | { type: 'clearBaselines' };

export type WorkerResponse =
  | { type: 'baselineGot'; requestId: number; snapshot: MonitorSnapshotEntry[] }
  | { type: 'recalculateResult'; requestId: number; pendingEntries: MonitorSnapshotEntry[] }
  | { type: 'error'; requestId: number; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data;
  
  try {
    if (payload.type === 'setBaseline') {
      monitorBaselines.set(payload.path, buildMonitorBaseline(payload.snapshot));
      monitorLastSnapshotAt.set(payload.path, payload.lastSnapshotAt);
    } else if (payload.type === 'getBaseline') {
      const baseline = monitorBaselines.get(payload.path);
      const snapshot = baseline ? Array.from(baseline.byPath.values()) : [];
      self.postMessage({
        type: 'baselineGot',
        requestId: payload.requestId,
        snapshot
      });
    } else if (payload.type === 'clearBaselines') {
      monitorBaselines.clear();
      monitorLastSnapshotAt.clear();
    } else if (payload.type === 'deleteBaseline') {
      monitorBaselines.delete(payload.path);
      monitorLastSnapshotAt.delete(payload.path);
    } else if (payload.type === 'recalculatePending') {
      let retained: MonitorSnapshotEntry[] = [];
      if (payload.isIncremental) {
        const scanPathSet = new Set(payload.pathsToScan.filter((path) => path.length > 0));
        retained = payload.currentPending.filter(
          (entry) => !isPathEqualOrDescendantInSet(entry.path, scanPathSet)
        );
      }

      const candidateEntries = getMonitorCandidateEntries({
        entries: payload.scannedEntries,
        baseline: monitorBaselines.get(payload.path),
        lastSnapshotAt: monitorLastSnapshotAt.get(payload.path),
        previousPendingEntries: payload.isIncremental ? payload.currentPending : payload.currentPending
      });

      const pendingEntries = collapseMonitorPendingEntries([
        ...retained,
        ...candidateEntries
      ]);

      self.postMessage({
        type: 'recalculateResult',
        requestId: payload.requestId,
        pendingEntries
      });
    }
  } catch (error) {
    if ('requestId' in payload) {
      self.postMessage({
        type: 'error',
        requestId: payload.requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
};

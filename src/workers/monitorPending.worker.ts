type MonitorSnapshotEntry = {
  path: string;
  id: string;
  isDirectory: boolean;
  modifiedAt: number;
};

type WorkerRequest = {
  requestId: number;
  retainedPendingEntries: MonitorSnapshotEntry[];
  candidateEntries: MonitorSnapshotEntry[];
  changedPaths: string[];
  isIncrementalRefresh: boolean;
};

type WorkerResponse = {
  requestId: number;
  pendingEntries: MonitorSnapshotEntry[];
};

function isPathInFolderTree(path: string, folderPath: string) {
  if (!path || !folderPath || path === folderPath) {
    return false;
  }
  const normalizedFolder = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
  return path.startsWith(normalizedFolder);
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
  deduped.sort((left, right) => left.path.length - right.path.length);
  const kept: MonitorSnapshotEntry[] = [];
  for (const entry of deduped) {
    let coveredByParent = false;
    for (const candidate of kept) {
      if (candidate.isDirectory && isPathInFolderTree(entry.path, candidate.path)) {
        coveredByParent = true;
        break;
      }
    }
    if (!coveredByParent) {
      kept.push(entry);
    }
  }
  return kept;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data;
  const changedPathSet = new Set(payload.changedPaths);
  const inspectedPendingEntries = payload.candidateEntries.filter((entry) =>
    changedPathSet.has(entry.path)
  );
  const merged = payload.isIncrementalRefresh
    ? [...payload.retainedPendingEntries, ...inspectedPendingEntries]
    : inspectedPendingEntries;
  const pendingEntries = collapseMonitorPendingEntries(merged);
  const response: WorkerResponse = {
    requestId: payload.requestId,
    pendingEntries
  };
  self.postMessage(response);
};

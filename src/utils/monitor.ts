import type { MonitorSnapshotEntry } from "../desktopBridge";
import type { MonitorBaseline } from "../types";
import { isPathInFolderTree } from "./path";

export function buildMonitorBaseline(entries: MonitorSnapshotEntry[]): MonitorBaseline {
  const byPath = new Map<string, MonitorSnapshotEntry>();
  const byId = new Map<string, MonitorSnapshotEntry>();
  for (const entry of entries) {
    byPath.set(entry.path, entry);
    byId.set(entry.id, entry);
  }
  return { byPath, byId };
}

export function dedupeMonitorEntriesByPath(entries: MonitorSnapshotEntry[]) {
  return Array.from(
    entries.reduce((map, entry) => {
      map.set(entry.path, entry);
      return map;
    }, new Map<string, MonitorSnapshotEntry>()).values()
  );
}

export function collapseMonitorPendingEntries(entries: MonitorSnapshotEntry[]) {
  const deduped = dedupeMonitorEntriesByPath(entries);
  return deduped.sort((a, b) => a.path.localeCompare(b.path));
}

export function collapseMonitorChangedPaths(paths: string[]) {
  const deduped = Array.from(new Set(paths.filter((path) => path.trim().length > 0))).sort();
  const kept: string[] = [];
  let currentParent: string | null = null;
  
  for (const path of deduped) {
    if (currentParent && isPathInFolderTree(path, currentParent)) {
      continue;
    }
    currentParent = path;
    kept.push(path);
  }
  return kept;
}

export function replaceMonitorBaselineEntries(options: {
  baseline?: MonitorBaseline;
  changedPaths: string[];
  nextEntries: MonitorSnapshotEntry[];
}) {
  const changedPaths = collapseMonitorChangedPaths(options.changedPaths);
  if (!options.baseline || changedPaths.length === 0) {
    return buildMonitorBaseline(dedupeMonitorEntriesByPath(options.nextEntries));
  }

  const nextIds = new Set(options.nextEntries.map((entry) => entry.id));

  const retainedEntries = Array.from(options.baseline.byPath.values()).filter(
    (entry) =>
      !nextIds.has(entry.id) &&
      !changedPaths.some((changedPath) => entry.path === changedPath || isPathInFolderTree(entry.path, changedPath))
  );

  return buildMonitorBaseline(dedupeMonitorEntriesByPath([...retainedEntries, ...options.nextEntries]));
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

export function getMonitorCandidateEntries(options: {
  path: string;
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

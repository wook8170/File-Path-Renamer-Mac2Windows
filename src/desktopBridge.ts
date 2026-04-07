export type NormalizeResult = {
  sourcePath: string;
  outputPath: string;
  sourceName: string;
  outputName: string;
  sourceNormalization: "NFC" | "NFD" | "BOTH" | "MIXED";
  changed: boolean;
  isDirectory: boolean;
  collisionResolved: boolean;
  displayName: string;
  compactPath: string;
};

export type NormalizeProgress = {
  processed: number;
  total: number;
};

export type InspectProgress = {
  fileCount: number;
};

export type BeforeItem = {
  sourcePath: string;
  sourceName: string;
  sourceNormalization: NormalizeResult["sourceNormalization"];
  changed: boolean;
  isDirectory: boolean;
  folderFileCount: number;
  parentFolderPath: string | null;
  isNfdLike: boolean;
  displayName: string;
  normalizedDisplayName: string;
  compactPath: string;
};

export type MonitorSnapshotEntry = {
  path: string;
  id: string;
  isDirectory: boolean;
  modifiedAt: number;
};

export type MonitorStateEntry = {
  path: string;
  lastSnapshotAt: number | null;
  snapshotEntries: MonitorSnapshotEntry[];
  pendingEntries: MonitorSnapshotEntry[];
  bookmarkData: string | null;
};

export type PickedMonitorDirectory = {
  path: string;
  bookmarkData: string | null;
};

export type MonitorWatchEvent = {
  roots: string[];
  paths: string[];
  kind: string;
};

export type DaemonCollectTargetsResult = {
  items: BeforeItem[];
  requestedCount: number;
  inspectedCount: number;
  addedCount: number;
  skippedExistingCount: number;
};

export type DaemonConvertTargetsResult = {
  results: NormalizeResult[];
  requestedCount: number;
  uniqueCount: number;
  changedCount: number;
};

export type AutoConvertHistoryEntry = {
  timestamp: number;
  sourcePath: string;
  outputPath: string;
  sourceName: string;
  outputName: string;
  changed: boolean;
  isDirectory: boolean;
  status: string;
};

type ClipboardCopyResult = {
  copiedCount: number;
  mode: "file" | "text" | "none";
  reason?: string;
  requestedCount: number;
  missingCount: number;
  missingPaths?: string[];
  errorCode?: string;
  errorMessage?: string;
};

export type DesktopBridge = {
  normalizeFileNames(filePaths: string[]): Promise<NormalizeResult[]>;
  daemonConvertTargets(filePaths: string[]): Promise<DaemonConvertTargetsResult>;
  pickFiles(): Promise<string[]>;
  pickDirectory(): Promise<string | null>;
  inspectSourceFiles(filePaths: string[]): Promise<BeforeItem[]>;
  daemonCollectTargets(filePaths: string[], excludePaths: string[]): Promise<DaemonCollectTargetsResult>;
  inspectPathsShallow(filePaths: string[]): Promise<BeforeItem[]>;
  scanMonitorDirectory(rootPath: string): Promise<MonitorSnapshotEntry[]>;
  scanMonitorPaths(paths: string[]): Promise<MonitorSnapshotEntry[]>;
  daemonCollectPendingEntries(roots: string[]): Promise<MonitorSnapshotEntry[]>;
  startMonitorWatch(paths: string[]): Promise<void>;
  stopMonitorWatch(): Promise<void>;
  pickMonitorDirectory(): Promise<PickedMonitorDirectory | null>;
  loadMonitorState(): Promise<MonitorStateEntry[]>;
  saveMonitorState(entries: MonitorStateEntry[]): Promise<void>;
  loadAutoConvertHistory(): Promise<AutoConvertHistoryEntry[]>;
  getAutoConvertHistoryCount(): Promise<number>;
  appendAutoConvertHistory(entries: AutoConvertHistoryEntry[]): Promise<number>;
  clearAutoConvertHistory(): Promise<void>;
  setTrayBadgeCount(count: number): Promise<void>;
  isLaunchAtLoginEnabled(): Promise<boolean>;
  setLaunchAtLoginEnabled(enabled: boolean): Promise<void>;
  getPathForFile(file: File): string;
  openItem(filePath: string): Promise<void>;
  showItemInFolder(filePath: string): Promise<void>;
  copyFilesToClipboard(filePaths: string[]): Promise<ClipboardCopyResult>;
  copyPathTextToClipboard(filePaths: string[]): Promise<{ copiedCount: number }>;
  onInspectProgress(listener: (progress: InspectProgress) => void): Promise<() => void>;
  onInspectBatch(listener: (items: BeforeItem[]) => void): Promise<() => void>;
  onNormalizeProgress(listener: (progress: NormalizeProgress) => void): Promise<() => void>;
  onNormalizeItem(listener: (item: NormalizeResult) => void): Promise<() => void>;
  onMonitorWatchEvent(listener: (event: MonitorWatchEvent) => void): Promise<() => void>;
  onMonitorWatchError(listener: (message: string) => void): Promise<() => void>;
  onMainWindowVisibility(listener: (visible: boolean) => void): Promise<() => void>;
  onAutoConvertHistoryCount(listener: (count: number) => void): Promise<() => void>;
  openAutoConvertHistoryWindow(): Promise<void>;
  startFileDrag(filePaths: string[]): Promise<void>;
};

let dragIconPathCache: string | null = null;
let coreModulePromise: Promise<typeof import("@tauri-apps/api/core")> | null = null;
let eventModulePromise: Promise<typeof import("@tauri-apps/api/event")> | null = null;
let dialogModulePromise: Promise<typeof import("@tauri-apps/plugin-dialog")> | null = null;
let pathModulePromise: Promise<typeof import("@tauri-apps/api/path")> | null = null;
let dragModulePromise: Promise<typeof import("@crabnebula/tauri-plugin-drag")> | null = null;
let autostartModulePromise: Promise<typeof import("@tauri-apps/plugin-autostart")> | null = null;

function getCoreModule() {
  coreModulePromise ??= import("@tauri-apps/api/core");
  return coreModulePromise;
}

function getEventModule() {
  eventModulePromise ??= import("@tauri-apps/api/event");
  return eventModulePromise;
}

function getDialogModule() {
  dialogModulePromise ??= import("@tauri-apps/plugin-dialog");
  return dialogModulePromise;
}

function getPathModule() {
  pathModulePromise ??= import("@tauri-apps/api/path");
  return pathModulePromise;
}

function getDragModule() {
  dragModulePromise ??= import("@crabnebula/tauri-plugin-drag");
  return dragModulePromise;
}

function getAutostartModule() {
  autostartModulePromise ??= import("@tauri-apps/plugin-autostart");
  return autostartModulePromise;
}

async function invoke<T>(command: string, args?: Record<string, unknown>) {
  const core = await getCoreModule();
  return core.invoke<T>(command, args);
}

async function getDragIconPath() {
  if (dragIconPathCache) {
    return dragIconPathCache;
  }
  const { resolveResource } = await getPathModule();
  const candidates = ["icons/32x32.png", "32x32.png", "icons/icon.png", "icon.png"];
  for (const candidate of candidates) {
    try {
      const resolved = await resolveResource(candidate);
      if (resolved) {
        dragIconPathCache = resolved;
        return resolved;
      }
    } catch {
      // Try next candidate.
    }
  }
  throw new Error("드래그 아이콘 리소스를 찾지 못했습니다.");
}

async function pickFilePathsFromDialog() {
  const { open } = await getDialogModule();
  const selected = await open({
    multiple: true,
    directory: false
  });
  if (!selected) {
    return [];
  }
  if (Array.isArray(selected)) {
    return selected;
  }
  return [selected];
}

async function pickDirectoryPathFromDialog() {
  const { open } = await getDialogModule();
  const selected = await open({
    multiple: false,
    directory: true
  });
  if (!selected) {
    return null;
  }
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

export const desktopBridge: DesktopBridge = {
  normalizeFileNames(filePaths) {
    return invoke<NormalizeResult[]>("normalize_file_names", { filePaths });
  },
  daemonConvertTargets(filePaths) {
    return invoke<DaemonConvertTargetsResult>("daemon_convert_targets", { filePaths });
  },
  pickFiles() {
    return pickFilePathsFromDialog();
  },
  pickDirectory() {
    return pickDirectoryPathFromDialog();
  },
  inspectSourceFiles(filePaths) {
    return invoke<BeforeItem[]>("inspect_source_files", { filePaths });
  },
  daemonCollectTargets(filePaths, excludePaths) {
    return invoke<DaemonCollectTargetsResult>("daemon_collect_targets", { filePaths, excludePaths });
  },
  inspectPathsShallow(filePaths) {
    return invoke<BeforeItem[]>("inspect_paths_shallow", { filePaths });
  },
  scanMonitorDirectory(rootPath) {
    return invoke<MonitorSnapshotEntry[]>("scan_monitor_directory", { rootPath });
  },
  scanMonitorPaths(paths) {
    return invoke<MonitorSnapshotEntry[]>("scan_monitor_paths", { paths });
  },
  daemonCollectPendingEntries(roots) {
    return invoke<MonitorSnapshotEntry[]>("daemon_collect_pending_entries", { roots });
  },
  startMonitorWatch(paths) {
    return invoke("start_monitor_watch", { paths });
  },
  stopMonitorWatch() {
    return invoke("stop_monitor_watch");
  },
  pickMonitorDirectory() {
    return invoke<PickedMonitorDirectory | null>("pick_monitor_directory");
  },
  loadMonitorState() {
    return invoke<MonitorStateEntry[]>("load_monitor_state");
  },
  saveMonitorState(entries) {
    return invoke("save_monitor_state", { entries });
  },
  loadAutoConvertHistory() {
    return invoke<AutoConvertHistoryEntry[]>("load_auto_convert_history");
  },
  getAutoConvertHistoryCount() {
    return invoke<number>("get_auto_convert_history_count");
  },
  appendAutoConvertHistory(entries) {
    return invoke<number>("append_auto_convert_history", { entries });
  },
  clearAutoConvertHistory() {
    return invoke("clear_auto_convert_history");
  },
  setTrayBadgeCount(count) {
    return invoke("set_tray_badge_count", { count });
  },
  async isLaunchAtLoginEnabled() {
    const { isEnabled } = await getAutostartModule();
    return isEnabled();
  },
  async setLaunchAtLoginEnabled(enabled) {
    const { enable, disable } = await getAutostartModule();
    if (enabled) {
      await enable();
      return;
    }
    await disable();
  },
  getPathForFile(file) {
    return ((file as unknown as { path?: string }).path ?? "").toString();
  },
  openItem(filePath) {
    return invoke("open_item", { filePath });
  },
  showItemInFolder(filePath) {
    return invoke("show_item_in_folder", { filePath });
  },
  copyFilesToClipboard(filePaths) {
    return invoke<ClipboardCopyResult>("copy_files_to_clipboard", { filePaths });
  },
  copyPathTextToClipboard(filePaths) {
    return invoke<{ copiedCount: number }>("copy_path_text_to_clipboard", { filePaths });
  },
  async onInspectProgress(listener) {
    const { listen } = await getEventModule();
    const unlisten = await listen<InspectProgress>("inspect-progress", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async onInspectBatch(listener) {
    const { listen } = await getEventModule();
    const unlisten = await listen<BeforeItem[]>("inspect-batch", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async onNormalizeProgress(listener) {
    const { listen } = await getEventModule();
    const unlisten = await listen<NormalizeProgress>("normalize-progress", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async onNormalizeItem(listener) {
    const { listen } = await getEventModule();
    const unlisten = await listen<NormalizeResult>("normalize-item", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async onMonitorWatchEvent(listener) {
    const { listen } = await getEventModule();
    const unlisten = await listen<MonitorWatchEvent>("monitor-watch-event", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async onMonitorWatchError(listener) {
    const { listen } = await getEventModule();
    const unlisten = await listen<string>("monitor-watch-error", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async onMainWindowVisibility(listener) {
    const { listen } = await getEventModule();
    const unlisten = await listen<boolean>("main-window-visibility", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async onAutoConvertHistoryCount(listener) {
    const { listen } = await getEventModule();
    const unlisten = await listen<number>("auto-convert-history-count", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async openAutoConvertHistoryWindow() {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel("auto-convert-history");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }
    const url = (() => {
      try {
        return new URL("auto-history.html", window.location.href).toString();
      } catch {
        return "auto-history.html";
      }
    })();
    new WebviewWindow("auto-convert-history", {
      title: "백그라운드 자동 변환 내역",
      width: 980,
      height: 680,
      resizable: true,
      minimizable: true,
      maximizable: false,
      focus: true,
      visible: true,
      url
    });
  },
  async startFileDrag(filePaths) {
    const normalized = Array.from(new Set(filePaths.filter((path) => path.trim().length > 0)));
    if (normalized.length === 0) {
      throw new Error("드래그할 파일이 없습니다.");
    }
    const icon = await getDragIconPath();
    const { startDrag } = await getDragModule();
    await startDrag({
      item: normalized,
      icon,
      mode: "copy"
    });
  }
};

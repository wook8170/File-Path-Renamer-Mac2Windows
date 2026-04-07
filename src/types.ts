import type {
  BeforeItem as RawBeforeItem,
  MonitorSnapshotEntry,
  NormalizeResult as RawNormalizeResult
} from "./desktopBridge";

export type NormalizeResult = RawNormalizeResult & {
  displayName: string;
  compactPath: string;
  convertedInBackground?: boolean;
};

export type BeforeItem = RawBeforeItem & {
  tooltipPath: string;
  metaLabel: string;
  unselectedCardClass: string;
  chipVariant: "folder" | "apple" | "window";
};

export type AppState = {
  beforeItems: BeforeItem[];
  selectedBeforePaths: Set<string>;
  beforeNfdOnly: boolean;
  results: NormalizeResult[];
  selectedOutputPaths: Set<string>;
  progressBaseLabel: string;
  progressDotStep: number;
  progressTimerId: number;
  progressPulseTimerId: number;
  beforeDragDepth: number;
  beforeDragHoverTimerId: number;
  afterInternalDragActive: boolean;
  busy: boolean;
  darkMode: boolean;
  mainWindowVisible: boolean;
  monitorDirectoryPaths: string[];
  monitorPendingPaths: Set<string>;
  monitorPendingFileCount: number;
  monitorPendingDirectoryCount: number;
  monitorProgressMessage: string;
  launchAtLoginEnabled: boolean;
  autoMonitorConvertEnabled: boolean;
  autoConvertFilesEnabled: boolean;
  monitorAutoConvertRunning: boolean;
};

export type MonitorBaseline = {
  byPath: Map<string, MonitorSnapshotEntry>;
  byId: Map<string, MonitorSnapshotEntry>;
};

export type MonitorDirectoryInfo = {
  path: string;
  lastSnapshotAt: number | null;
  pendingFileCount: number;
  pendingDirectoryCount: number;
  pendingCount: number;
};

export type StatusTone = "idle" | "error" | "success";

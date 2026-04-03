import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type NormalizeResult = {
  sourcePath: string;
  outputPath: string;
  sourceName: string;
  outputName: string;
  sourceNormalization: "NFC" | "NFD" | "BOTH" | "MIXED";
  changed: boolean;
  collisionResolved: boolean;
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
  pickFiles(): Promise<string[]>;
  inspectSourceFiles(filePaths: string[]): Promise<BeforeItem[]>;
  getPathForFile(file: File): string;
  showItemInFolder(filePath: string): Promise<void>;
  copyFilesToClipboard(filePaths: string[]): Promise<ClipboardCopyResult>;
  copyPathTextToClipboard(filePaths: string[]): Promise<{ copiedCount: number }>;
  onInspectProgress(listener: (progress: InspectProgress) => void): Promise<() => void>;
  onNormalizeProgress(listener: (progress: NormalizeProgress) => void): Promise<() => void>;
  onNormalizeItem(listener: (item: NormalizeResult) => void): Promise<() => void>;
  startFileDrag(filePaths: string[]): void;
};

async function pickFilePathsFromDialog() {
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

export const desktopBridge: DesktopBridge = {
  normalizeFileNames(filePaths) {
    return invoke<NormalizeResult[]>("normalize_file_names", { filePaths });
  },
  pickFiles() {
    return pickFilePathsFromDialog();
  },
  inspectSourceFiles(filePaths) {
    return invoke<BeforeItem[]>("inspect_source_files", { filePaths });
  },
  getPathForFile(file) {
    return ((file as unknown as { path?: string }).path ?? "").toString();
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
    const unlisten = await listen<InspectProgress>("inspect-progress", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async onNormalizeProgress(listener) {
    const unlisten = await listen<NormalizeProgress>("normalize-progress", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  async onNormalizeItem(listener) {
    const unlisten = await listen<NormalizeResult>("normalize-item", (event) => {
      listener(event.payload);
    });
    return () => {
      unlisten();
    };
  },
  startFileDrag(_filePaths) {
    // Tauri does not provide a direct equivalent for Electron startDrag in this flow.
  }
};

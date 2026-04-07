export function toWindowsPreviewBefore(value: string, changed: boolean) {
  if (!changed) {
    return value.normalize("NFC");
  }
  return value.normalize("NFD");
}

export function toWindowsPreviewAfter(value: string) {
  return value.normalize("NFC");
}

export function toCompactPath(rawPath: string) {
  const normalizedPath = rawPath.replace(/\\/g, "/");
  const isAbsolute = normalizedPath.startsWith("/");
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
  const normalizedSegments = segments.map((segment) => segment.normalize("NFC"));
  if (normalizedSegments.length <= 6) {
    return `${isAbsolute ? "/" : ""}${normalizedSegments.join("/")}`;
  }
  const head = normalizedSegments.slice(0, 2);
  const tail = normalizedSegments.slice(-3);
  return `${isAbsolute ? "/" : ""}${[...head, "...", ...tail].join("/")}`;
}

export function getDirectoryPath(rawPath: string) {
  const normalizedPath = rawPath.replace(/\\/g, "/");
  const isAbsolute = normalizedPath.startsWith("/");
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return isAbsolute ? "/" : segments[0] ?? "";
  }
  const parent = segments.slice(0, -1).join("/");
  return `${isAbsolute ? "/" : ""}${parent}`;
}

export function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
}

function hasExternalMonitorDirectory(paths: string[]) {
  return paths.some((path) => path.startsWith("/Volumes/"));
}

function hasMissingMonitorBookmark(paths: string[], bookmarks: Map<string, string>) {
  return paths.some((path) => path.startsWith("/Volumes/") && !bookmarks.has(path));
}

export function toMonitorPermissionGuidance(
  message: string,
  options: {
    monitorDirectoryPaths: string[];
    monitorDirectoryBookmarks: Map<string, string>;
    isDev: boolean;
  }
) {
  if (!message.includes("Permission denied") && !message.includes("os error 13")) {
    return message;
  }

  const hints: string[] = [];
  if (hasExternalMonitorDirectory(options.monitorDirectoryPaths)) {
    hints.push("외장 SSD 권한 문제일 수 있습니다.");
  }
  if (hasMissingMonitorBookmark(options.monitorDirectoryPaths, options.monitorDirectoryBookmarks)) {
    hints.push("기존 저장 경로에는 북마크 권한이 없어 해제 후 다시 선택이 필요합니다.");
  }
  if (options.isDev) {
    hints.push("현재 개발 실행(`tauri dev`)에서는 권한 승계가 불안정할 수 있어 배포 빌드에서 다시 확인해 주세요.");
  }
  if (hints.length === 0) {
    return message;
  }
  return `${message} ${hints.join(" ")}`;
}

export function normalizePathForCompare(value: string) {
  return value.replace(/\\/g, "/").normalize("NFC");
}

export function isPathInFolderTree(targetPath: string, folderPath: string) {
  const normalizedTargetPath = normalizePathForCompare(targetPath);
  const normalizedFolderPath = normalizePathForCompare(folderPath);
  return normalizedTargetPath === normalizedFolderPath || normalizedTargetPath.startsWith(`${normalizedFolderPath}/`);
}

export function formatSnapshotTime(value: number | null) {
  if (!value) {
    return "없음";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

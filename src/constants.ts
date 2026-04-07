export const MONITOR_START_DELAY_MS = 1500;
export const MONITOR_WATCH_DEBOUNCE_MS = 220;
export const MONITOR_SNAPSHOT_STALE_MS = 12 * 60 * 60 * 1000;
export const MONITOR_SNAPSHOT_CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const SELECTED_CARD_CLASSES = [
  "border-2",
  "border-violet-500",
  "bg-violet-100",
  "text-stone-900"
];
export const LIST_CLASS =
  "scroll-fade relative grid content-start auto-rows-max h-[460px] max-h-[460px] min-h-[460px] gap-0.5 overflow-y-auto overflow-x-hidden pl-2 pr-4 py-2 [scrollbar-gutter:stable]";
export const LIST_CLASS_EMPTY =
  "scroll-fade relative grid content-start auto-rows-max h-[460px] max-h-[460px] min-h-[460px] gap-0.5 overflow-y-auto overflow-x-hidden pl-0 pr-0 py-0 [scrollbar-gutter:stable]";
export const LIST_CLASS_VIRTUAL =
  "virtual-list-host scroll-fade relative h-[460px] max-h-[460px] min-h-[460px] overflow-y-auto overflow-x-hidden pl-2 pr-4 py-2 [scrollbar-gutter:stable]";
export const VIRTUAL_LIST_THRESHOLD = 80;
export const VIRTUAL_ROW_HEIGHT = 44;
export const VIRTUAL_OVERSCAN = 48;
export const AUTO_MONITOR_CONVERT_STORAGE_KEY = "file-path-renamer-auto-monitor-convert";
export const AUTO_CONVERT_FILES_STORAGE_KEY = "file-path-renamer-auto-convert-files";
export const THEME_STORAGE_KEY = "file-path-renamer-theme";

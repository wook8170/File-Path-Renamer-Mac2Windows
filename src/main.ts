import "./styles.css";
import { desktopBridge } from "./desktopBridge";

type NormalizeResult = {
  sourcePath: string;
  outputPath: string;
  sourceName: string;
  outputName: string;
  sourceNormalization: "NFC" | "NFD" | "BOTH" | "MIXED";
  changed: boolean;
  collisionResolved: boolean;
};

type NormalizeProgress = {
  processed: number;
  total: number;
};

type InspectProgress = {
  fileCount: number;
};

type BeforeItem = {
  sourcePath: string;
  sourceName: string;
  sourceNormalization: NormalizeResult["sourceNormalization"];
  changed: boolean;
  isDirectory: boolean;
  folderFileCount: number;
  parentFolderPath: string | null;
};

declare global {
  interface Window {
    desktopBridge: {
      normalizeFileNames(filePaths: string[]): Promise<NormalizeResult[]>;
      pickFiles(): Promise<string[]>;
      inspectSourceFiles(filePaths: string[]): Promise<BeforeItem[]>;
      getPathForFile(file: File): string;
      openItem(filePath: string): Promise<void>;
      showItemInFolder(filePath: string): Promise<void>;
      copyFilesToClipboard(filePaths: string[]): Promise<{
        copiedCount: number;
        mode: "file" | "text" | "none";
        reason?: string;
        requestedCount: number;
        missingCount: number;
        missingPaths?: string[];
        errorCode?: string;
        errorMessage?: string;
      }>;
      copyPathTextToClipboard(filePaths: string[]): Promise<{ copiedCount: number }>;
      onInspectProgress(listener: (progress: InspectProgress) => void): Promise<() => void>;
      onNormalizeProgress(listener: (progress: NormalizeProgress) => void): Promise<() => void>;
      onNormalizeItem(listener: (item: NormalizeResult) => void): Promise<() => void>;
      startFileDrag(filePaths: string[]): Promise<void>;
    };
  }
}

window.desktopBridge = desktopBridge;

const state = {
  beforeItems: [] as BeforeItem[],
  selectedBeforePaths: new Set<string>(),
  beforeNfdOnly: false,
  results: [] as NormalizeResult[],
  selectedOutputPaths: new Set<string>(),
  progressBaseLabel: "처리 중",
  progressDotStep: 0,
  progressTimerId: 0,
  progressPulseTimerId: 0,
  beforeDragDepth: 0,
  beforeDragHoverTimerId: 0,
  busy: false,
  darkMode: false
};
const SELECTED_CARD_CLASSES = ["border-sky-300", "bg-sky-100/60", "text-stone-900", "shadow-sm", "shadow-sky-100"];
const LIST_CLASS =
  "scroll-fade relative grid content-start auto-rows-max h-[460px] max-h-[460px] min-h-[460px] gap-2 overflow-y-auto overflow-x-hidden pl-2 pr-4 py-2 [scrollbar-gutter:stable]";
const LIST_CLASS_EMPTY =
  "scroll-fade relative grid content-start auto-rows-max h-[460px] max-h-[460px] min-h-[460px] gap-2 overflow-y-auto overflow-x-hidden pl-0 pr-0 py-0 [scrollbar-gutter:stable]";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container not found.");
}

app.innerHTML = `
  <main class="flex h-full w-full flex-col gap-3 overflow-hidden p-3">
    <section id="top-section" class="rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-soft backdrop-blur">
      <div class="mb-2 flex items-center justify-between gap-3">
        <h1 class="text-xl font-extrabold tracking-tight text-stone-900 sm:text-2xl">File Path Renamer (NFD -> NFC)</h1>
        <button
          id="theme-toggle"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-stone-50 text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
          type="button"
          aria-pressed="false"
          aria-label="다크 모드 켜기"
          title="다크 모드 켜기"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" class="h-4 w-4 fill-none stroke-current stroke-[1.8]">
            <circle cx="10" cy="10" r="3.5" />
            <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div>
        <p id="status-text" class="status-idle hidden h-0 text-xs leading-5">아직 처리된 파일이 없습니다.</p>
        <div
          id="status-log"
          class="h-20 overflow-y-auto rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] leading-4 text-stone-600"
        ></div>
        <div id="progress-wrap" class="mt-2 h-8">
          <div class="flex items-center justify-between text-[11px] text-stone-500">
            <span id="progress-label">작업 대기 중...</span>
            <span id="progress-percent"></span>
          </div>
          <div id="progress-track" class="mt-1 hidden h-2 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              id="progress-bar"
              class="h-full w-full origin-left rounded-full bg-stone-700 transition-transform duration-200 ease-out"
              style="transform: scaleX(0)"
            ></div>
          </div>
        </div>
      </div>
    </section>

    <section class="relative grid gap-4 lg:grid-cols-2">
      <div class="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <button
          id="center-convert"
          class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-sm font-semibold text-stone-600 shadow transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-200"
          type="button"
          aria-label="before 변환 실행"
          title="변환"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" class="h-5 w-5 fill-none stroke-current stroke-[2.2]">
            <path d="M3.5 10h12" stroke-linecap="round" />
            <path d="M11.4 6.6 16.2 10l-4.8 3.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          id="center-refresh"
          class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-sm font-semibold text-stone-600 shadow transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-200"
          type="button"
          aria-label="before/after 전체 초기화"
          title="전체 초기화"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" class="h-5 w-5 fill-none stroke-current stroke-[2.2]">
            <path d="M16.5 10a6.5 6.5 0 1 1-2-4.6" stroke-linecap="round" />
            <path d="M16 3.4v3.9h-3.9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
      <section id="before-section" class="relative rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-soft backdrop-blur">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Before</p>
            <h2 class="flex items-center gap-2 text-sm font-semibold text-stone-900">
              원본 파일 목록
              <span id="before-count" class="text-xs font-medium text-stone-400">(0개)</span>
            </h2>
          </div>
          <button
            id="before-filter-toggle"
            class="inline-flex items-center gap-2 self-end whitespace-nowrap rounded-md border border-stone-300 bg-stone-50 px-3 py-1.5 text-[11px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
            type="button"
            aria-pressed="false"
          >
            <span class="text-[11px]">전체 보기</span>
            <span id="before-filter-toggle-pill" class="inline-flex h-4 w-9 items-center rounded-full bg-stone-300 p-0.5 transition-colors">
              <span id="before-filter-toggle-knob" class="h-3 w-3 rounded-full bg-white shadow-sm transition-transform"></span>
            </span>
            <span id="before-filter-toggle-text" class="text-left text-[10px]">NFD만 보기</span>
          </button>
        </div>
        <div id="before-list-host" class="relative h-[460px] overflow-hidden rounded-2xl">
          <div id="before-list" class="grid content-start auto-rows-max h-[460px] max-h-[460px] min-h-[460px] gap-2 overflow-y-auto overflow-x-hidden pl-0 pr-0 py-0 [scrollbar-gutter:stable]">
            <div class="flex h-[444px] min-h-[444px] items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 text-center text-sm text-stone-400">
              원본 파일 목록이 여기에 표시됩니다.
            </div>
          </div>
        </div>
      </section>

      <section id="after-section" class="relative rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-soft backdrop-blur">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">After</p>
            <h2 class="flex items-center gap-2 text-sm font-semibold text-stone-900">
              변환된 파일 목록
              <span id="after-count" class="text-xs font-medium text-stone-400">(0개)</span>
            </h2>
          </div>
          <div class="flex items-center gap-2 self-end">
            <button
              id="select-all-after"
              class="inline-flex items-center whitespace-nowrap rounded-md border border-stone-300 bg-stone-50 px-3 py-1.5 text-[11px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              전체선택
            </button>
            <button
              id="copy-paths"
              class="inline-flex items-center whitespace-nowrap rounded-md border border-stone-300 bg-stone-50 px-3 py-1.5 text-[11px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              경로 복사
            </button>
            <button
              id="copy-selection"
              class="inline-flex items-center whitespace-nowrap rounded-md border border-stone-300 bg-stone-50 px-3 py-1.5 text-[11px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              파일 복사
            </button>
          </div>
        </div>
        <div id="after-list" class="grid content-start auto-rows-max h-[460px] max-h-[460px] min-h-[460px] gap-2 overflow-y-auto overflow-x-hidden pl-0 pr-0 py-0 [scrollbar-gutter:stable]">
          <div class="flex h-[444px] min-h-[444px] items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 text-center text-sm text-stone-400">
            변환된 파일 목록이 여기에 표시됩니다.
          </div>
        </div>
      </section>
    </section>
  </main>
  <div
    id="after-context-menu"
    class="fixed z-[140] hidden min-w-[140px] rounded-md border border-stone-300 bg-white p-1 shadow-lg"
    role="menu"
    aria-hidden="true"
  >
    <button
      id="after-context-select-all"
      class="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      전체 선택
    </button>
    <button
      id="after-context-copy-paths"
      class="mt-0.5 flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      경로 복사
    </button>
    <button
      id="after-context-copy-files"
      class="mt-0.5 flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      파일 복사
    </button>
  </div>
  <div
    id="copy-toast"
    class="pointer-events-none fixed bottom-3 right-3 z-[150] hidden w-[min(380px,calc(100vw-1.5rem))] rounded-xl border border-sky-200 bg-white p-3 shadow-lg"
    aria-live="polite"
  >
    <p id="copy-toast-title" class="text-xs font-semibold text-sky-700"></p>
    <div id="copy-toast-list" class="mt-1 max-h-36 overflow-y-auto text-[11px] leading-4 text-stone-700"></div>
  </div>
  <div
    id="before-context-menu"
    class="fixed z-[140] hidden min-w-[140px] rounded-md border border-stone-300 bg-white p-1 shadow-lg"
    role="menu"
    aria-hidden="true"
  >
    <button
      id="before-context-convert"
      class="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      변환 하기
    </button>
    <button
      id="before-context-clear"
      class="mt-0.5 flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      전체 삭제
    </button>
  </div>
`;

const beforeList = document.querySelector<HTMLDivElement>("#before-list");
const beforeListHost = document.querySelector<HTMLDivElement>("#before-list-host");
const afterList = document.querySelector<HTMLDivElement>("#after-list");
const statusText = document.querySelector<HTMLParagraphElement>("#status-text");
const beforeCount = document.querySelector<HTMLSpanElement>("#before-count");
const beforeFilterToggleButton = document.querySelector<HTMLButtonElement>("#before-filter-toggle");
const beforeFilterTogglePill = document.querySelector<HTMLSpanElement>("#before-filter-toggle-pill");
const beforeFilterToggleKnob = document.querySelector<HTMLSpanElement>("#before-filter-toggle-knob");
const beforeFilterToggleText = document.querySelector<HTMLSpanElement>("#before-filter-toggle-text");
const afterCount = document.querySelector<HTMLSpanElement>("#after-count");
const progressWrap = document.querySelector<HTMLDivElement>("#progress-wrap");
const progressLabel = document.querySelector<HTMLSpanElement>("#progress-label");
const progressPercent = document.querySelector<HTMLSpanElement>("#progress-percent");
const progressTrack = document.querySelector<HTMLDivElement>("#progress-track");
const progressBar = document.querySelector<HTMLDivElement>("#progress-bar");
const statusLog = document.querySelector<HTMLDivElement>("#status-log");
const selectAllAfterButton = document.querySelector<HTMLButtonElement>("#select-all-after");
const copySelectionButton = document.querySelector<HTMLButtonElement>("#copy-selection");
const copyPathsButton = document.querySelector<HTMLButtonElement>("#copy-paths");
const centerConvertButton = document.querySelector<HTMLButtonElement>("#center-convert");
const centerRefreshButton = document.querySelector<HTMLButtonElement>("#center-refresh");
const afterContextMenu = document.querySelector<HTMLDivElement>("#after-context-menu");
const afterContextCopyFilesButton = document.querySelector<HTMLButtonElement>("#after-context-copy-files");
const afterContextSelectAllButton = document.querySelector<HTMLButtonElement>("#after-context-select-all");
const afterContextCopyPathsButton = document.querySelector<HTMLButtonElement>("#after-context-copy-paths");
const copyToast = document.querySelector<HTMLDivElement>("#copy-toast");
const copyToastTitle = document.querySelector<HTMLParagraphElement>("#copy-toast-title");
const copyToastList = document.querySelector<HTMLDivElement>("#copy-toast-list");
const beforeContextMenu = document.querySelector<HTMLDivElement>("#before-context-menu");
const beforeContextConvertButton = document.querySelector<HTMLButtonElement>("#before-context-convert");
const beforeContextClearButton = document.querySelector<HTMLButtonElement>("#before-context-clear");
const themeToggleButton = document.querySelector<HTMLButtonElement>("#theme-toggle");

if (
  !beforeList ||
  !beforeListHost ||
  !afterList ||
  !statusText ||
  !beforeCount ||
  !beforeFilterToggleButton ||
  !beforeFilterTogglePill ||
  !beforeFilterToggleKnob ||
  !beforeFilterToggleText ||
  !afterCount ||
  !progressWrap ||
  !progressLabel ||
  !progressPercent ||
  !progressTrack ||
  !progressBar ||
  !statusLog ||
  !selectAllAfterButton ||
  !copySelectionButton ||
  !copyPathsButton ||
  !centerConvertButton ||
  !centerRefreshButton ||
  !afterContextMenu ||
  !afterContextCopyFilesButton ||
  !afterContextSelectAllButton ||
  !afterContextCopyPathsButton ||
  !copyToast ||
  !copyToastTitle ||
  !copyToastList ||
  !beforeContextMenu ||
  !beforeContextConvertButton ||
  !beforeContextClearButton ||
  !themeToggleButton
) {
  throw new Error("Failed to initialize UI.");
}

let copyToastTimerId = 0;
const afterCardElementMap = new Map<string, HTMLElement>();
const THEME_STORAGE_KEY = "file-path-renamer-theme";
const systemThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

function isThemePinnedByUser() {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" || stored === "light";
}

function applyTheme(darkMode: boolean, save = false) {
  state.darkMode = darkMode;
  document.body.classList.toggle("theme-dark", darkMode);
  const label = darkMode ? "라이트 모드로 전환" : "다크 모드로 전환";
  themeToggleButton.setAttribute("aria-label", label);
  themeToggleButton.title = label;
  themeToggleButton.innerHTML = darkMode
    ? `
      <svg viewBox="0 0 20 20" aria-hidden="true" class="h-4 w-4 fill-current">
        <path d="M12.5 2.8c.2 0 .3.2.2.3a7 7 0 1 0 4.2 10.8c.1-.2.4-.2.5 0 .1.1.1.3 0 .4a8 8 0 1 1-5.2-11.5h.3Z" />
      </svg>
    `
    : `
      <svg viewBox="0 0 20 20" aria-hidden="true" class="h-4 w-4 fill-none stroke-current stroke-[1.8]">
        <circle cx="10" cy="10" r="3.5" />
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke-linecap="round" />
      </svg>
    `;
  themeToggleButton.setAttribute("aria-pressed", darkMode ? "true" : "false");
  if (save) {
    window.localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
  }
}

function initializeTheme() {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark") {
    applyTheme(true);
    return;
  }
  if (stored === "light") {
    applyTheme(false);
    return;
  }
  applyTheme(systemThemeMediaQuery.matches);
}

function handleSystemThemeChange(event: MediaQueryListEvent) {
  if (isThemePinnedByUser()) {
    return;
  }
  applyTheme(event.matches);
}

function setupSystemThemeWatcher() {
  if ("addEventListener" in systemThemeMediaQuery) {
    systemThemeMediaQuery.addEventListener("change", handleSystemThemeChange);
    return;
  }
  systemThemeMediaQuery.addListener(handleSystemThemeChange);
}

function showCopyToast(title: string, names: string[]) {
  if (copyToastTimerId !== 0) {
    window.clearTimeout(copyToastTimerId);
    copyToastTimerId = 0;
  }
  copyToastTitle.textContent = title;
  const previewNames = names
    .slice(0, 10)
    .map((name) => `<p class="truncate">• ${escapeHtml(name)}</p>`)
    .join("");
  const remain = names.length - Math.min(names.length, 10);
  const tail = remain > 0 ? `<p class="mt-0.5 text-stone-500">외 ${remain}개</p>` : "";
  copyToastList.innerHTML = `${previewNames}${tail}`;
  copyToast.classList.remove("hidden");
  copyToastTimerId = window.setTimeout(() => {
    copyToast.classList.add("hidden");
    copyToastTimerId = 0;
  }, 3400);
}

function hideAfterContextMenu() {
  afterContextMenu.classList.add("hidden");
  afterContextMenu.setAttribute("aria-hidden", "true");
}

function hideBeforeContextMenu() {
  beforeContextMenu.classList.add("hidden");
  beforeContextMenu.setAttribute("aria-hidden", "true");
}

function showAfterContextMenu(x: number, y: number) {
  const menuWidth = 152;
  const menuHeight = 112;
  const nextX = Math.min(Math.max(8, x), window.innerWidth - menuWidth - 8);
  const nextY = Math.min(Math.max(8, y), window.innerHeight - menuHeight - 8);
  afterContextMenu.style.left = `${nextX}px`;
  afterContextMenu.style.top = `${nextY}px`;
  afterContextMenu.classList.remove("hidden");
  afterContextMenu.setAttribute("aria-hidden", "false");
  const hasSelection = state.selectedOutputPaths.size > 0;
  const hasResults = state.results.length > 0;
  afterContextCopyFilesButton.disabled = !hasSelection;
  afterContextSelectAllButton.disabled = !hasResults;
  afterContextCopyPathsButton.disabled = !hasSelection;
}

function showBeforeContextMenu(x: number, y: number) {
  const menuWidth = 152;
  const menuHeight = 80;
  const nextX = Math.min(Math.max(8, x), window.innerWidth - menuWidth - 8);
  const nextY = Math.min(Math.max(8, y), window.innerHeight - menuHeight - 8);
  beforeContextMenu.style.left = `${nextX}px`;
  beforeContextMenu.style.top = `${nextY}px`;
  beforeContextMenu.classList.remove("hidden");
  beforeContextMenu.setAttribute("aria-hidden", "false");

  const hasBeforeFiles = getSelectedBeforeFileCount() > 0;
  const hasConvertible = getSelectedBeforeConvertibleCount() > 0;
  beforeContextClearButton.disabled = state.beforeItems.length === 0;
  beforeContextConvertButton.disabled = !hasBeforeFiles || !hasConvertible || state.busy;
}

function appendStatusLog(message: string, tone: "idle" | "error" | "success" = "idle") {
  const time = new Date();
  const stamp = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(
    time.getSeconds()
  ).padStart(2, "0")}`;
  const line = document.createElement("p");
  line.className =
    tone === "error"
      ? "text-violet-700"
      : tone === "success"
        ? "text-sky-700"
        : "text-stone-600";
  line.textContent = `[${stamp}] ${message}`;
  statusLog.appendChild(line);
  if (statusLog.childElementCount > 500) {
    statusLog.removeChild(statusLog.firstElementChild as Node);
  }
  statusLog.scrollTop = statusLog.scrollHeight;
}

const pathTooltip = document.createElement("div");
pathTooltip.className =
  "theme-path-tooltip pointer-events-none fixed z-[120] max-w-[760px] rounded-md border border-stone-300 bg-white px-2 py-1 text-[11px] leading-4 text-stone-700 shadow-lg opacity-0 transition-opacity duration-75";
pathTooltip.style.left = "0px";
pathTooltip.style.top = "0px";
document.body.appendChild(pathTooltip);

let tooltipTarget: HTMLElement | null = null;

function hidePathTooltip() {
  tooltipTarget = null;
  pathTooltip.style.opacity = "0";
  pathTooltip.textContent = "";
}

function movePathTooltip(event: MouseEvent) {
  if (!tooltipTarget) {
    return;
  }
  const margin = 14;
  const maxX = window.innerWidth - pathTooltip.offsetWidth - 8;
  const maxY = window.innerHeight - pathTooltip.offsetHeight - 8;
  const nextX = Math.min(maxX, event.clientX + margin);
  const nextY = Math.min(maxY, event.clientY + margin);
  pathTooltip.style.left = `${Math.max(8, nextX)}px`;
  pathTooltip.style.top = `${Math.max(8, nextY)}px`;
}

document.addEventListener("mouseover", (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-path-tooltip]");
  if (!target) {
    hidePathTooltip();
    return;
  }
  const message = target.getAttribute("data-path-tooltip");
  if (!message) {
    hidePathTooltip();
    return;
  }
  tooltipTarget = target;
  pathTooltip.textContent = message;
  pathTooltip.style.opacity = "1";
});

document.addEventListener("mousemove", (event) => {
  movePathTooltip(event);
});

document.addEventListener("mouseout", (event) => {
  if (!tooltipTarget) {
    return;
  }
  const related = event.relatedTarget as HTMLElement | null;
  if (related && related.closest("[data-path-tooltip]") === tooltipTarget) {
    return;
  }
  const leaving = event.target as HTMLElement | null;
  if (leaving && leaving.closest("[data-path-tooltip]") === tooltipTarget) {
    hidePathTooltip();
  }
});

function getFilePaths(fileList: FileList): string[] {
  return Array.from(fileList)
    .map((file) => window.desktopBridge.getPathForFile(file))
    .filter((value): value is string => Boolean(value));
}

function setBusy(nextBusy: boolean) {
  state.busy = nextBusy;
  beforeList.classList.toggle("dropzone-busy", nextBusy);
  beforeList.querySelectorAll<HTMLButtonElement>("[data-before-picker]").forEach((button) => {
    button.disabled = nextBusy;
  });
  beforeList.querySelectorAll<HTMLButtonElement>(".before-remove-button").forEach((button) => {
    button.disabled = nextBusy;
  });
  centerConvertButton.disabled = nextBusy || !hasBeforeConvertibleFiles();
  centerRefreshButton.disabled = nextBusy || (state.beforeItems.length === 0 && state.results.length === 0);
}

function setStatus(message: string, tone: "idle" | "error" | "success" = "idle") {
  statusText.textContent = message;
  statusText.classList.remove("status-idle", "status-error", "status-success");
  statusText.classList.add(`status-${tone}`);
  appendStatusLog(message, tone);
}

function setProgress(processed: number, total: number) {
  stopIndeterminateProgress();
  progressTrack.classList.remove("hidden");
  const safeTotal = total > 0 ? total : 1;
  const clampedProcessed = Math.max(0, Math.min(processed, safeTotal));
  const percent = Math.round((clampedProcessed / safeTotal) * 100);
  state.progressBaseLabel = `파일처리중 (${clampedProcessed}/${safeTotal})`;
  const dots = ".".repeat((state.progressDotStep % 3) + 1);
  progressLabel.textContent = `${state.progressBaseLabel}${dots}`;
  progressPercent.textContent = `${percent}%`;
  progressBar.style.transform = `scaleX(${clampedProcessed / safeTotal})`;
}

function hideProgress() {
  stopProgressAnimation();
  stopIndeterminateProgress();
  progressTrack.classList.add("hidden");
  progressLabel.textContent = "작업 대기 중...";
  progressPercent.textContent = "";
  progressBar.style.transform = "scaleX(0)";
}

function startIndeterminateProgress() {
  stopIndeterminateProgress();
  progressTrack.classList.remove("hidden");
  progressPercent.textContent = "...";
  let width = 12;
  let direction = 1;
  progressBar.style.transform = `scaleX(${width / 100})`;
  state.progressPulseTimerId = window.setInterval(() => {
    width += direction * 6;
    if (width >= 88) {
      width = 88;
      direction = -1;
    } else if (width <= 12) {
      width = 12;
      direction = 1;
    }
    progressBar.style.transform = `scaleX(${width / 100})`;
  }, 90);
}

function stopIndeterminateProgress() {
  if (state.progressPulseTimerId !== 0) {
    window.clearInterval(state.progressPulseTimerId);
    state.progressPulseTimerId = 0;
  }
}

function startProgressAnimation() {
  stopProgressAnimation();
  state.progressDotStep = 0;
  state.progressTimerId = window.setInterval(() => {
    if (progressTrack.classList.contains("hidden")) {
      return;
    }
    state.progressDotStep = (state.progressDotStep + 1) % 3;
    const dots = ".".repeat(state.progressDotStep + 1);
    progressLabel.textContent = `${state.progressBaseLabel}${dots}`;
  }, 360);
}

function stopProgressAnimation() {
  if (state.progressTimerId !== 0) {
    window.clearInterval(state.progressTimerId);
    state.progressTimerId = 0;
  }
}

function waitNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

function toWindowsPreviewBefore(value: string, changed: boolean) {
  if (!changed) {
    return value.normalize("NFC");
  }

  return Array.from(value.normalize("NFD")).join(" ");
}

function toWindowsPreviewAfter(value: string) {
  return value.normalize("NFC");
}

function toCompactPath(rawPath: string) {
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

function getDirectoryPath(rawPath: string) {
  const normalizedPath = rawPath.replace(/\\/g, "/");
  const isAbsolute = normalizedPath.startsWith("/");
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return isAbsolute ? "/" : segments[0] ?? "";
  }
  const parent = segments.slice(0, -1).join("/");
  return `${isAbsolute ? "/" : ""}${parent}`;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendAfterItems(items: NormalizeResult[]) {
  for (const item of items) {
    const bySourceIndex = state.results.findIndex((entry) => entry.sourcePath === item.sourcePath);
    if (bySourceIndex >= 0) {
      state.results[bySourceIndex] = item;
      continue;
    }
    if (state.results.some((entry) => entry.outputPath === item.outputPath)) {
      continue;
    }
    state.results.push(item);
  }
}

function updateSelectionCount() {
  const total = state.results.length;
  const count = state.selectedOutputPaths.size;
  const allSelected = total > 0 && count === total;
  selectAllAfterButton.textContent = allSelected ? "선택해제" : "전체선택";
  selectAllAfterButton.disabled = total === 0;
  copySelectionButton.disabled = count === 0;
  copyPathsButton.disabled = count === 0;
}

function updateListCounts() {
  beforeCount.textContent = `(${getBeforeVisibleFileCount()}개)`;
  afterCount.textContent = `(${state.results.length}개)`;
}

function getBeforeFileCount() {
  return state.beforeItems.filter((item) => !item.isDirectory).length;
}

function hasBeforeConvertibleFiles() {
  return state.beforeItems.some((item) => item.changed);
}

function getSelectedBeforeItems() {
  return state.beforeItems.filter((item) => state.selectedBeforePaths.has(item.sourcePath));
}

function getSelectedBeforeConvertibleItems() {
  return getSelectedBeforeItems().filter((item) => item.changed);
}

function getSelectedBeforeFileCount() {
  return getSelectedBeforeItems().length;
}

function getSelectedBeforeConvertibleCount() {
  return getSelectedBeforeConvertibleItems().length;
}

function getBeforeVisibleFileCount() {
  if (!state.beforeNfdOnly) {
    return getBeforeFileCount();
  }
  return state.beforeItems.filter((item) => !item.isDirectory && item.sourceNormalization === "NFD").length;
}

function normalizePathForCompare(value: string) {
  return value.replace(/\\/g, "/");
}

function isPathInFolderTree(targetPath: string, folderPath: string) {
  const normalizedTarget = normalizePathForCompare(targetPath);
  const normalizedFolder = normalizePathForCompare(folderPath);
  return normalizedTarget === normalizedFolder || normalizedTarget.startsWith(`${normalizedFolder}/`);
}

function toggleOrSelectOutputPath(outputPath: string, append: boolean) {
  if (append) {
    if (state.selectedOutputPaths.has(outputPath)) {
      state.selectedOutputPaths.delete(outputPath);
    } else {
      state.selectedOutputPaths.add(outputPath);
    }
    return;
  }

  state.selectedOutputPaths.clear();
  state.selectedOutputPaths.add(outputPath);
}

function toggleOrSelectBeforePath(sourcePath: string, append: boolean) {
  if (append) {
    if (state.selectedBeforePaths.has(sourcePath)) {
      state.selectedBeforePaths.delete(sourcePath);
    } else {
      state.selectedBeforePaths.add(sourcePath);
    }
    return;
  }
  state.selectedBeforePaths.clear();
  state.selectedBeforePaths.add(sourcePath);
}

function applyCardSelectionClass(card: HTMLElement, selected: boolean) {
  const unselectedClasses = (card.dataset.unselectedClass ?? "")
    .split(" ")
    .map((v) => v.trim())
    .filter(Boolean);
  if (selected) {
    for (const className of unselectedClasses) {
      card.classList.remove(className);
    }
    card.classList.add(...SELECTED_CARD_CLASSES);
    return;
  }
  card.classList.remove(...SELECTED_CARD_CLASSES);
  if (unselectedClasses.length > 0) {
    card.classList.add(...unselectedClasses);
  }
}

function refreshBeforeSelectionVisuals() {
  beforeList.querySelectorAll<HTMLElement>(".before-card").forEach((card) => {
    const sourcePath = card.dataset.sourcePath;
    if (!sourcePath) {
      return;
    }
    applyCardSelectionClass(card, state.selectedBeforePaths.has(sourcePath));
  });
  centerConvertButton.disabled = state.busy || !hasBeforeConvertibleFiles();
}

function refreshAfterSelectionVisuals() {
  afterCardElementMap.forEach((card, outputPath) => {
    const selected = state.selectedOutputPaths.has(outputPath);
    applyCardSelectionClass(card, selected);
    const meta = card.querySelector<HTMLElement>("[data-after-meta=\"true\"]");
    if (meta) {
      meta.classList.toggle("text-sky-700", selected);
      meta.classList.toggle("text-stone-500", !selected);
    }
  });
  updateSelectionCount();
}

function refreshAfterSelectionByPaths(paths: Iterable<string>) {
  for (const outputPath of new Set(paths)) {
    const card = afterCardElementMap.get(outputPath);
    if (!card) {
      continue;
    }
    const selected = state.selectedOutputPaths.has(outputPath);
    applyCardSelectionClass(card, selected);
    const meta = card.querySelector<HTMLElement>("[data-after-meta=\"true\"]");
    if (meta) {
      meta.classList.toggle("text-sky-700", selected);
      meta.classList.toggle("text-stone-500", !selected);
    }
  }
  updateSelectionCount();
}

function renderEmptyList(target: HTMLDivElement, message: string, showPickerButton = false) {
  target.className = LIST_CLASS_EMPTY;
  const emptyPanelAttr = showPickerButton ? 'data-before-drop-panel="true"' : "";
  target.innerHTML = `
    <div ${emptyPanelAttr} class="flex h-[460px] min-h-[460px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 text-center text-sm text-stone-400 transition-colors duration-150">
      <p>${message}</p>
      ${
        showPickerButton
          ? `
      <button
        data-before-picker="true"
        class="inline-flex items-center whitespace-nowrap rounded-md bg-stone-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
        type="button"
      >
        파일 추가
      </button>
      `
          : ""
      }
    </div>
  `;
}

function setBeforeListLoadingOverlay(active: boolean, message = "파일 목록 추가중...") {
  const overlayId = "before-list-loading-overlay";
  const current = beforeListHost.querySelector<HTMLDivElement>(`#${overlayId}`);
  if (!active) {
    if (current) {
      current.remove();
    }
    return;
  }

  if (current) {
    const text = current.querySelector<HTMLParagraphElement>("[data-loading-text]");
    if (text) {
      text.textContent = message;
    }
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = overlayId;
  overlay.className =
    "absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-stone-900/20 backdrop-blur-[1px] pointer-events-none";
  overlay.innerHTML = `
    <div class="flex items-center gap-2 rounded-xl border border-stone-200 bg-white/95 px-4 py-2 shadow-sm">
      <svg viewBox="0 0 20 20" aria-hidden="true" class="h-4 w-4 animate-spin text-sky-600 fill-none stroke-current stroke-[2]">
        <circle cx="10" cy="10" r="7" class="opacity-25" />
        <path d="M10 3a7 7 0 0 1 7 7" stroke-linecap="round" class="opacity-100" />
      </svg>
      <p data-loading-text class="text-xs font-semibold text-stone-700">${message}</p>
    </div>
  `;
  beforeListHost.appendChild(overlay);
}

function setBeforeDropActive(active: boolean) {
  const dropPanel = beforeList.querySelector<HTMLElement>("[data-before-drop-panel]");
  const overlayId = "before-list-drop-overlay";
  const existingOverlay = beforeListHost.querySelector<HTMLDivElement>(`#${overlayId}`);
  if (dropPanel) {
    if (existingOverlay) {
      existingOverlay.remove();
    }
    dropPanel.classList.toggle("before-drop-active", active);
    beforeList.classList.remove("before-list-drop-active");
    return;
  }

  beforeList.classList.toggle("before-list-drop-active", active);
  if (!active) {
    if (existingOverlay) {
      existingOverlay.remove();
    }
    return;
  }

  if (!existingOverlay) {
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.className = "before-list-drop-overlay";
    beforeListHost.appendChild(overlay);
  }
}

function pingBeforeDropActive() {
  setBeforeDropActive(true);
  if (state.beforeDragHoverTimerId !== 0) {
    window.clearTimeout(state.beforeDragHoverTimerId);
  }
  state.beforeDragHoverTimerId = window.setTimeout(() => {
    setBeforeDropActive(false);
    state.beforeDragHoverTimerId = 0;
  }, 140);
}

function getBeforeDropZoneElement() {
  return (beforeList.querySelector<HTMLElement>("[data-before-drop-panel]") ?? beforeList) as HTMLElement;
}

let beforeDropZoneBound: HTMLElement | null = null;

function isExternalFileDrag(event: DragEvent) {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).includes("Files");
}

function handleBeforeDragEnter(event: DragEvent) {
  if (!isExternalFileDrag(event)) {
    return;
  }
  event.preventDefault();
  state.beforeDragDepth += 1;
  setBeforeDropActive(true);
}

function handleBeforeDragOver(event: DragEvent) {
  if (!isExternalFileDrag(event)) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  pingBeforeDropActive();
}

function handleBeforeDragLeave(event: DragEvent) {
  if (!isExternalFileDrag(event)) {
    return;
  }
  event.preventDefault();
  state.beforeDragDepth = Math.max(0, state.beforeDragDepth - 1);
  if (state.beforeDragDepth === 0) {
    setBeforeDropActive(false);
  }
}

function handleBeforeDrop(event: DragEvent) {
  if (!isExternalFileDrag(event)) {
    return;
  }
  event.preventDefault();
  state.beforeDragDepth = 0;
  setBeforeDropActive(false);

  const files = event.dataTransfer?.files;
  if (files) {
    void enqueuePaths(getFilePaths(files));
  }
}

function bindBeforeDropZoneEvents() {
  const nextDropZone = getBeforeDropZoneElement();
  if (beforeDropZoneBound === nextDropZone) {
    return;
  }

  if (beforeDropZoneBound) {
    beforeDropZoneBound.removeEventListener("dragenter", handleBeforeDragEnter);
    beforeDropZoneBound.removeEventListener("dragover", handleBeforeDragOver);
    beforeDropZoneBound.removeEventListener("dragleave", handleBeforeDragLeave);
    beforeDropZoneBound.removeEventListener("drop", handleBeforeDrop);
  }

  beforeDropZoneBound = nextDropZone;
  beforeDropZoneBound.addEventListener("dragenter", handleBeforeDragEnter);
  beforeDropZoneBound.addEventListener("dragover", handleBeforeDragOver);
  beforeDropZoneBound.addEventListener("dragleave", handleBeforeDragLeave);
  beforeDropZoneBound.addEventListener("drop", handleBeforeDrop);
}

function renderLists() {
  const existingBeforePaths = new Set(state.beforeItems.map((item) => item.sourcePath));
  state.selectedBeforePaths.forEach((sourcePath) => {
    if (!existingBeforePaths.has(sourcePath)) {
      state.selectedBeforePaths.delete(sourcePath);
    }
  });
  updateListCounts();
  updateSelectionCount();
  beforeFilterToggleButton.setAttribute("aria-pressed", state.beforeNfdOnly ? "true" : "false");
  beforeFilterTogglePill.classList.toggle("bg-sky-500", state.beforeNfdOnly);
  beforeFilterTogglePill.classList.toggle("bg-stone-300", !state.beforeNfdOnly);
  beforeFilterToggleKnob.classList.toggle("translate-x-4", state.beforeNfdOnly);
  centerConvertButton.disabled = state.busy || !hasBeforeConvertibleFiles();
  centerRefreshButton.disabled = state.busy || (state.beforeItems.length === 0 && state.results.length === 0);

  const beforeVisibleEntries = state.beforeItems
    .map((item, originalIndex) => ({ item, originalIndex }))
    .filter(({ item }) => {
      if (!state.beforeNfdOnly) {
        return true;
      }
      return !item.isDirectory && item.sourceNormalization === "NFD";
    });

  if (beforeVisibleEntries.length === 0) {
    const emptyMessage =
      state.beforeItems.length === 0
        ? "원본 파일 목록이 여기에 표시됩니다."
        : state.beforeNfdOnly
          ? "NFD 파일이 없습니다."
          : "원본 파일 목록이 여기에 표시됩니다.";
    renderEmptyList(beforeList, emptyMessage, true);
  } else {
    beforeList.className = LIST_CLASS;
    beforeList.innerHTML = beforeVisibleEntries
    .map(({ item, originalIndex }, displayIndex) => {
      const isSelected = state.selectedBeforePaths.has(item.sourcePath);
      const selectedCardClass = isSelected
        ? "border-sky-300 bg-sky-50 text-stone-900 shadow-md shadow-sky-100"
        : "";
      if (item.isDirectory) {
        const currentFolderFileCount = state.beforeItems.filter(
          (entry) => !entry.isDirectory && isPathInFolderTree(entry.sourcePath, item.sourcePath)
        ).length;
        const folderPathDisplay = toCompactPath(getDirectoryPath(item.sourcePath));
        const folderPathTitle = escapeHtmlAttribute(item.sourcePath.normalize("NFC"));
        const folderCardClass = isSelected ? selectedCardClass : "border-rose-200/80 bg-rose-100/70";
        return `
        <article class="before-card flex min-h-10 items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-1.5 ${folderCardClass}" data-source-path="${item.sourcePath}" data-unselected-class="border-rose-200/80 bg-rose-100/70" data-path-tooltip="${folderPathTitle}">
          <span class="inline-flex min-w-7 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-stone-500">
            ${displayIndex + 1}
          </span>
          <span class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rose-300 bg-rose-200 text-rose-800">
            <svg viewBox="0 0 20 20" aria-hidden="true" class="h-3.5 w-3.5 fill-current">
              <path d="M2.5 5.5a2 2 0 0 1 2-2h3.2a1.4 1.4 0 0 1 1.1.5l.8 1h5.9a2 2 0 0 1 2 2v.6H2.5v-2.1Zm0 3.6h15v5.4a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V9.1Z" />
            </svg>
          </span>
          <div class="min-w-0 flex-1">
            <p class="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-stone-800">${item.sourceName.normalize("NFC")}</p>
            <p class="truncate text-[11px] text-stone-400" data-path-tooltip="${folderPathTitle}">폴더(${currentFolderFileCount}개): ${folderPathDisplay}</p>
          </div>
          <button
            class="before-remove-button ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center bg-transparent text-stone-500 transition hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
            data-before-index="${originalIndex}"
            type="button"
            aria-label="before 항목 삭제"
            title="삭제"
            ${state.busy ? "disabled" : ""}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" class="h-3.5 w-3.5 fill-none stroke-current stroke-[2]">
              <path d="M5.5 5.5 14.5 14.5" stroke-linecap="round" />
              <path d="M14.5 5.5 5.5 14.5" stroke-linecap="round" />
            </svg>
          </button>
        </article>
      `;
      }

      const isNfd = item.sourceNormalization === "NFD" || item.sourceNormalization === "MIXED";
      const sourceDisplayName = toWindowsPreviewBefore(item.sourceName, isNfd);
      const sourceDirectoryPath = getDirectoryPath(item.sourcePath);
      const sourceCompactPath = toCompactPath(sourceDirectoryPath);
      const sourcePathTitle = escapeHtmlAttribute(item.sourcePath.normalize("NFC"));
      const beforeCardClass = isNfd
        ? "border-stone-200 bg-white"
        : "border-stone-200 bg-stone-50";
      const inChipClass = isNfd
        ? "bg-violet-100 text-violet-700"
        : "bg-stone-200 text-stone-500";
      const inChipIcon = isNfd
        ? `
          <svg viewBox="0 0 20 20" aria-hidden="true" class="h-3.5 w-3.5 fill-current">
            <path d="M12.8 9.8c0-1.7.9-2.8 2.2-3.5-.8-1.2-2.1-1.8-3.4-1.9-1.4-.1-2.4.7-3 .7-.7 0-1.6-.7-2.7-.6-2.2.1-4.2 1.8-4.2 4.9 0 1.2.2 2.5.8 3.8.8 1.7 2 3.5 3.6 3.4.9 0 1.5-.6 2.5-.6 1.1 0 1.6.6 2.6.6 1.5 0 2.6-1.7 3.3-3.3.4-.8.6-1.4.7-1.7-2-.8-2.4-2.7-2.4-3.8Z"/>
            <path d="M11.7 3.1c.5-.6.9-1.5.8-2.3-.8.1-1.8.6-2.3 1.2-.5.6-.9 1.4-.8 2.2.9.1 1.8-.4 2.3-1.1Z"/>
          </svg>
        `
        : `
          <svg viewBox="0 0 20 20" aria-hidden="true" class="h-3.5 w-3.5 fill-current">
            <path d="M2 3.2 9.2 2v7H2V3.2Zm8.8-1.5L18 0.8v8.1h-7.2V1.7ZM2 10.1h7.2V17L2 15.8v-5.7Zm8.8 0H18v8.1l-7.2-1.1v-7Z"/>
          </svg>
        `;
      return `
        <article class="before-card flex min-h-10 items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-1.5 ${isSelected ? selectedCardClass : beforeCardClass}" data-source-path="${item.sourcePath}" data-unselected-class="${beforeCardClass}" data-path-tooltip="${sourcePathTitle}">
          <span class="inline-flex min-w-7 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-stone-500">
            ${displayIndex + 1}
          </span>
          <span class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${inChipClass}">
            ${inChipIcon}
          </span>
          <div class="min-w-0 flex-1">
            <p class="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-stone-800">${sourceDisplayName}</p>
            <p class="truncate text-[11px] text-stone-400" data-path-tooltip="${sourcePathTitle}">${sourceCompactPath}</p>
          </div>
          <button
            class="before-remove-button ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center bg-transparent text-stone-500 transition hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
            data-before-index="${originalIndex}"
            type="button"
            aria-label="before 항목 삭제"
            title="삭제"
            ${state.busy ? "disabled" : ""}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" class="h-3.5 w-3.5 fill-none stroke-current stroke-[2]">
              <path d="M5.5 5.5 14.5 14.5" stroke-linecap="round" />
              <path d="M14.5 5.5 5.5 14.5" stroke-linecap="round" />
            </svg>
          </button>
        </article>
      `;
    })
    .join("");

    beforeList.querySelectorAll<HTMLButtonElement>(".before-remove-button").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state.busy) {
          return;
        }
        const indexText = button.dataset.beforeIndex;
        if (indexText === undefined) {
          return;
        }
        const targetIndex = Number.parseInt(indexText, 10);
        if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= state.beforeItems.length) {
          return;
        }
        const targetItem = state.beforeItems[targetIndex];
        if (targetItem.isDirectory) {
          state.selectedBeforePaths.forEach((sourcePath) => {
            if (isPathInFolderTree(sourcePath, targetItem.sourcePath)) {
              state.selectedBeforePaths.delete(sourcePath);
            }
          });
          state.beforeItems = state.beforeItems.filter(
            (item) => !isPathInFolderTree(item.sourcePath, targetItem.sourcePath)
          );
          renderLists();
          setStatus("폴더와 하위 파일 항목을 함께 삭제했습니다.", "success");
          return;
        }
        state.selectedBeforePaths.delete(targetItem.sourcePath);
        state.beforeItems.splice(targetIndex, 1);
        renderLists();
        setStatus("원본 파일 목록 항목 1개를 삭제했습니다.", "success");
      });
    });

    beforeList.querySelectorAll<HTMLElement>(".before-card").forEach((element) => {
      element.addEventListener("click", (event) => {
        const sourcePath = element.dataset.sourcePath;
        if (!sourcePath) {
          return;
        }
        const mouseEvent = event as MouseEvent;
        toggleOrSelectBeforePath(sourcePath, mouseEvent.metaKey || mouseEvent.ctrlKey);
        refreshBeforeSelectionVisuals();
      });

      element.addEventListener("dblclick", () => {
        const sourcePath = element.dataset.sourcePath;
        if (!sourcePath) {
          return;
        }
        void window.desktopBridge.openItem(sourcePath).catch((error) => {
          const message = error instanceof Error ? error.message : "항목을 열지 못했습니다.";
          setStatus(message, "error");
        });
      });
    });
  }

  if (state.results.length === 0) {
    afterCardElementMap.clear();
    renderEmptyList(afterList, "변환된 파일 목록이 여기에 표시됩니다.");
  } else {
    afterList.className = LIST_CLASS;
    afterList.innerHTML = state.results
    .map((item, index) => {
      const outputDisplayName = toWindowsPreviewAfter(item.outputName);
      const outputDirectoryPath = getDirectoryPath(item.outputPath);
      const outputCompactPath = toCompactPath(outputDirectoryPath);
      const isSelected = state.selectedOutputPaths.has(item.outputPath);
      const stateClasses = isSelected
        ? "border-sky-300 bg-sky-50 text-stone-900 shadow-md shadow-sky-100"
        : "border-stone-200 bg-white text-stone-900";
      const metaTextClass = isSelected ? "text-sky-700" : "text-stone-500";

      return `
        <article
          class="after-card flex min-h-10 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-1.5 transition ${stateClasses}"
          data-output-path="${item.outputPath}"
          data-unselected-class="border-stone-200 bg-white text-stone-900"
        >
          <span class="inline-flex min-w-7 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-stone-500">
            ${index + 1}
          </span>
          <span class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-500">
            <svg viewBox="0 0 20 20" aria-hidden="true" class="h-3.5 w-3.5 fill-current">
              <path d="M2 3.2 9.2 2v7H2V3.2Zm8.8-1.5L18 0.8v8.1h-7.2V1.7ZM2 10.1h7.2V17L2 15.8v-5.7Zm8.8 0H18v8.1l-7.2-1.1v-7Z"/>
            </svg>
          </span>
          <div class="min-w-0 flex-1">
            <p class="max-w-full truncate text-sm font-medium">${outputDisplayName}</p>
            <p class="truncate text-[11px] ${metaTextClass}" data-after-meta="true">${outputCompactPath}</p>
          </div>
        </article>
      `;
    })
    .join("");

    afterCardElementMap.clear();
    afterList.querySelectorAll<HTMLElement>(".after-card").forEach((element) => {
      const outputPath = element.dataset.outputPath;
      if (outputPath) {
        afterCardElementMap.set(outputPath, element);
      }
      element.setAttribute("draggable", "true");
      element.addEventListener("click", (event) => {
        const outputPath = element.dataset.outputPath;
        if (!outputPath) {
          return;
        }

        const mouseEvent = event as MouseEvent;
        if (mouseEvent.metaKey || mouseEvent.ctrlKey) {
          toggleOrSelectOutputPath(outputPath, true);
          refreshAfterSelectionByPaths([outputPath]);
          return;
        }
        if (state.selectedOutputPaths.size === 1 && state.selectedOutputPaths.has(outputPath)) {
          return;
        }
        const changedPaths = Array.from(state.selectedOutputPaths);
        state.selectedOutputPaths.clear();
        state.selectedOutputPaths.add(outputPath);
        changedPaths.push(outputPath);
        refreshAfterSelectionByPaths(changedPaths);
      });

      element.addEventListener("dblclick", () => {
        const outputPath = element.dataset.outputPath;
        if (!outputPath) {
          return;
        }
        void window.desktopBridge.openItem(outputPath).catch((error) => {
          const message = error instanceof Error ? error.message : "항목을 열지 못했습니다.";
          setStatus(message, "error");
        });
      });

      element.addEventListener("dragstart", (event) => {
        event.preventDefault();
        const outputPath = element.dataset.outputPath;
        if (!outputPath) {
          return;
        }

        if (!state.selectedOutputPaths.has(outputPath)) {
          const changedPaths = Array.from(state.selectedOutputPaths);
          state.selectedOutputPaths.clear();
          state.selectedOutputPaths.add(outputPath);
          changedPaths.push(outputPath);
          refreshAfterSelectionByPaths(changedPaths);
        }

        const dragPaths = state.results
          .map((item) => item.outputPath)
          .filter((path) => state.selectedOutputPaths.has(path));
        void window.desktopBridge.startFileDrag(dragPaths).catch((error) => {
          const message = error instanceof Error ? error.message : "파일 드래그 시작에 실패했습니다.";
          setStatus(message, "error");
        });
      });
    });
  }

  updateScrollFades();
  bindBeforeDropZoneEvents();
}

function scrollListsToBottom() {
  beforeList.scrollTop = beforeList.scrollHeight;
  afterList.scrollTop = afterList.scrollHeight;
  updateScrollFades();
}

function updateScrollFadeState(list: HTMLDivElement) {
  const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
  const hasOverflow = maxScrollTop > 1;
  const hasTopOverflow = hasOverflow && list.scrollTop > 1;
  const hasBottomOverflow = hasOverflow && list.scrollTop < maxScrollTop - 1;

  list.classList.toggle("scroll-fade-enabled", hasOverflow);
  list.classList.toggle("scroll-fade-top", hasTopOverflow);
  list.classList.toggle("scroll-fade-bottom", hasBottomOverflow);
}

function updateScrollFades() {
  updateScrollFadeState(beforeList);
  updateScrollFadeState(afterList);
}

async function enqueuePaths(filePaths: string[]) {
  if (filePaths.length === 0) {
    setStatus("파일 경로를 읽지 못했습니다. Finder에서 실제 파일을 드롭해 주세요.", "error");
    return;
  }

  const existing = new Set(state.beforeItems.map((item) => item.sourcePath));
  const uniquePaths = filePaths.filter((filePath) => !existing.has(filePath));
  if (uniquePaths.length === 0) {
    setStatus("이미 원본 파일 목록에 있는 파일입니다.", "idle");
    return;
  }

  setBusy(true);
  setBeforeListLoadingOverlay(true, "파일 목록 추가중... (파일 0개)");
  setStatus("폴더/파일 목록을 분석 중입니다...");
  let unsubscribeInspect: (() => void) | null = null;

  try {
    unsubscribeInspect = await window.desktopBridge.onInspectProgress((progress) => {
      setBeforeListLoadingOverlay(true, `파일 목록 추가중... (파일 ${progress.fileCount}개)`);
    });
    await waitNextPaint();
    const inspectedItems = await window.desktopBridge.inspectSourceFiles(uniquePaths);
    const mergedItems = inspectedItems.filter((item) => {
      if (existing.has(item.sourcePath)) {
        return false;
      }
      existing.add(item.sourcePath);
      return true;
    });
    if (mergedItems.length === 0) {
      setStatus("이미 원본 파일 목록에 있는 항목입니다.", "idle");
      return;
    }
    state.beforeItems.push(...mergedItems);
    renderLists();
    window.requestAnimationFrame(() => {
      beforeList.scrollTop = beforeList.scrollHeight;
      updateScrollFadeState(beforeList);
    });

    const addedFolderCount = mergedItems.filter((item) => item.isDirectory).length;
    const addedFileCount = mergedItems.length - addedFolderCount;
    const skippedCount = inspectedItems.length - mergedItems.length + (filePaths.length - uniquePaths.length);
    if (skippedCount > 0) {
      setStatus(
        `원본 파일 목록에 파일 ${addedFileCount}개, 폴더 ${addedFolderCount}개 추가 (${skippedCount}개 중복 제외)`,
        "success"
      );
      return;
    }
    setStatus(`원본 파일 목록에 파일 ${addedFileCount}개, 폴더 ${addedFolderCount}개를 추가했습니다.`, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "파일 정보를 확인하는 중 오류가 발생했습니다.";
    setStatus(message, "error");
  } finally {
    if (unsubscribeInspect) {
      unsubscribeInspect();
    }
    setBeforeListLoadingOverlay(false);
    setBusy(false);
  }
}

async function convertSourcePaths(sourcePaths: string[]) {
  if (state.busy) {
    return;
  }
  const uniqueSourcePaths = Array.from(new Set(sourcePaths));
  if (uniqueSourcePaths.length === 0) {
    setStatus("변환할 파일이 없습니다.", "error");
    return;
  }
  let unsubscribe: (() => void) | null = null;
  let unsubscribeItem: (() => void) | null = null;

  try {
    setBusy(true);
    startProgressAnimation();
    setProgress(0, uniqueSourcePaths.length);
    setStatus(`${uniqueSourcePaths.length}개 항목을 변환 중입니다...`);

    unsubscribe = await window.desktopBridge.onNormalizeProgress((progress) => {
      setProgress(progress.processed, progress.total);
    });
    unsubscribeItem = await window.desktopBridge.onNormalizeItem((item) => {
      appendAfterItems([item]);
      renderLists();
      window.requestAnimationFrame(() => {
        afterList.scrollTop = afterList.scrollHeight;
        updateScrollFadeState(afterList);
      });
    });

    const finalResults = await window.desktopBridge.normalizeFileNames(uniqueSourcePaths);
    appendAfterItems(finalResults);
    const convertedSourcePathSet = new Set(uniqueSourcePaths);
    const convertedDirectoryPaths = new Set(
      state.beforeItems
        .filter((item) => item.isDirectory && convertedSourcePathSet.has(item.sourcePath))
        .map((item) => item.sourcePath)
    );
    state.beforeItems = state.beforeItems.filter((item) => {
      if (convertedSourcePathSet.has(item.sourcePath)) {
        return false;
      }
      for (const directoryPath of convertedDirectoryPaths) {
        if (isPathInFolderTree(item.sourcePath, directoryPath)) {
          return false;
        }
      }
      return true;
    });
    state.selectedBeforePaths.forEach((sourcePath) => {
      if (convertedSourcePathSet.has(sourcePath)) {
        state.selectedBeforePaths.delete(sourcePath);
        return;
      }
      for (const directoryPath of convertedDirectoryPaths) {
        if (isPathInFolderTree(sourcePath, directoryPath)) {
          state.selectedBeforePaths.delete(sourcePath);
          return;
        }
      }
    });
    state.selectedOutputPaths.clear();
    renderLists();

    setProgress(uniqueSourcePaths.length, uniqueSourcePaths.length);
    const changedCount = finalResults.filter((item) => item.changed).length;
    setStatus(
      `${finalResults.length}개 출력 파일을 만들었습니다. ${changedCount}개는 NFD에서 NFC로 변경되었습니다.`,
      "success"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    setStatus(message, "error");
  } finally {
    if (unsubscribe) {
      unsubscribe();
    }
    if (unsubscribeItem) {
      unsubscribeItem();
    }
    window.setTimeout(() => {
      if (!state.busy) {
        hideProgress();
      }
    }, 250);
    setBusy(false);
    renderLists();
  }
}

async function convertBeforeItems() {
  const selectedItems = getSelectedBeforeConvertibleItems();
  const sourcePaths = selectedItems.map((item) => item.sourcePath);
  if (sourcePaths.length === 0) {
    setStatus("선택한 항목 중 변환 대상(NFD)이 없습니다.", "error");
    return;
  }
  await convertSourcePaths(sourcePaths);
}

async function convertAllBeforeConvertibleItems() {
  const sourcePaths = state.beforeItems.filter((item) => item.changed).map((item) => item.sourcePath);
  if (sourcePaths.length === 0) {
    setStatus("원본 파일 목록에 변환할 항목(NFD)이 없습니다.", "idle");
    return;
  }
  await convertSourcePaths(sourcePaths);
}

function clearAllItems() {
  if (state.busy) {
    return;
  }
  const beforeCount = state.beforeItems.length;
  const afterCount = state.results.length;
  if (beforeCount === 0 && afterCount === 0) {
    setStatus("원본 파일 목록/변환된 파일 목록이 모두 비어 있습니다.", "idle");
    return;
  }

  state.beforeItems = [];
  state.selectedBeforePaths.clear();
  state.results = [];
  state.selectedOutputPaths.clear();
  renderLists();
  setStatus(`원본 파일 목록 ${beforeCount}개, 변환된 파일 목록 ${afterCount}개를 초기화했습니다.`, "success");
}

function formatClipboardFailureReason(reason?: string) {
  if (!reason) {
    return "unknown";
  }
  if (reason.includes("jxa-file-urls-partial-")) {
    return "JXA 처리 중 일부 파일만 file-url로 등록됨";
  }
  if (reason.includes("applescript-partial-")) {
    return "AppleScript 처리 중 일부 파일만 file-url로 등록됨";
  }
  if (reason.includes("jxa-no-file-url")) {
    return "JXA에서 file-url 작성 실패";
  }
  if (reason.includes("applescript-no-file-url")) {
    return "AppleScript에서 file-url 작성 실패";
  }
  if (reason.includes("Not authorized")) {
    return "macOS 자동화 권한(AppleScript) 미허용";
  }
  if (reason.includes("jxa:")) {
    return "JXA 스크립트 오류";
  }
  if (reason.includes("applescript:")) {
    return "AppleScript 실행 오류";
  }
  if (reason.includes("file-clipboard-failed")) {
    return "파일 타입 클립보드 쓰기 실패";
  }
  return reason;
}

function formatMissingFileSummary(missingPaths?: string[]) {
  if (!missingPaths || missingPaths.length === 0) {
    return "";
  }
  const names = missingPaths.map((filePath) => {
    const segments = filePath.split(/[\\/]/);
    return segments[segments.length - 1] ?? filePath;
  });
  const preview = names.slice(0, 3).join(", ");
  if (names.length <= 3) {
    return ` 실패 파일: ${preview}`;
  }
  return ` 실패 파일: ${preview} 외 ${names.length - 3}개`;
}

function formatErrorCodeMessage(errorCode?: string, errorMessage?: string) {
  if (!errorCode && !errorMessage) {
    return "";
  }
  const codeText = errorCode ?? "UNKNOWN";
  const messageText = errorMessage ?? "unknown";
  return `에러코드: ${codeText}, 에러메시지: ${messageText}`;
}

function getSelectedResults() {
  return state.results.filter((item) => state.selectedOutputPaths.has(item.outputPath));
}

async function copySelectedFiles() {
  const selectedResults = getSelectedResults();
  const selectedPaths = selectedResults.map((item) => item.outputPath);
  if (selectedPaths.length === 0) {
    setStatus("먼저 오른쪽 목록에서 복사할 파일을 선택해 주세요.", "error");
    return;
  }

  try {
    const result = await window.desktopBridge.copyFilesToClipboard(selectedPaths);
    if (result.mode === "file") {
      if (result.copiedCount < selectedPaths.length) {
        const reasonText = formatClipboardFailureReason(result.reason);
        const missingSummary = formatMissingFileSummary(result.missingPaths);
        const errorSummary = formatErrorCodeMessage(result.errorCode, result.errorMessage);
        const detailParts = [`원인: ${reasonText}`];
        if (missingSummary) {
          detailParts.push(missingSummary.trim());
        }
        if (errorSummary) {
          detailParts.push(errorSummary);
        }
        setStatus(
          `선택 ${selectedPaths.length}개 중 ${result.copiedCount}개만 복사됨 (실패 ${result.missingCount}개). ${detailParts.join(" / ")}`,
          "error"
        );
        return;
      }
      setStatus(
        `${result.copiedCount}개 파일을 첨부용 클립보드에 복사했습니다. 텍스트 입력창에서는 비어 보일 수 있습니다.`,
        "success"
      );
      showCopyToast(`파일 ${result.copiedCount}개 복사됨`, selectedResults.map((item) => item.outputName.normalize("NFC")));
      return;
    }

    if (result.mode === "text") {
      const reasonText = formatClipboardFailureReason(result.reason);
      const errorSummary = formatErrorCodeMessage(result.errorCode, result.errorMessage);
      const detailText = errorSummary ? `원인: ${reasonText} / ${errorSummary}` : `원인: ${reasonText}`;
      setStatus(
        `${result.copiedCount}개 파일 경로를 텍스트로만 복사했습니다. 파일 첨부 복사 실패 ${detailText}`,
        "error"
      );
      return;
    }

    const errorSummary = formatErrorCodeMessage(result.errorCode, result.errorMessage);
    const detailText = errorSummary
      ? `원인: ${formatClipboardFailureReason(result.reason)} / ${errorSummary}`
      : `원인: ${formatClipboardFailureReason(result.reason)}`;
    setStatus(`복사할 파일이 없습니다. ${detailText}`, "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "클립보드 복사 중 오류가 발생했습니다.";
    if (message.includes("No handler registered for 'copy-files-to-clipboard'")) {
      setStatus("앱을 완전히 재시작해 주세요. 메인 프로세스 IPC 핸들러가 아직 반영되지 않았습니다.", "error");
      return;
    }
    setStatus(message, "error");
  }
}

async function copySelectedPathsAsText() {
  const selectedResults = getSelectedResults();
  const selectedPaths = selectedResults.map((item) => item.outputPath);
  if (selectedPaths.length === 0) {
    setStatus("먼저 오른쪽 목록에서 파일을 선택해 주세요.", "error");
    return;
  }

  try {
    const result = await window.desktopBridge.copyPathTextToClipboard(selectedPaths);
    setStatus(`${result.copiedCount}개 파일 경로를 텍스트로 복사했습니다.`, "success");
    showCopyToast(`경로 ${result.copiedCount}개 복사됨`, selectedResults.map((item) => item.outputName.normalize("NFC")));
  } catch (error) {
    const message = error instanceof Error ? error.message : "경로 텍스트 복사 중 오류가 발생했습니다.";
    setStatus(message, "error");
  }
}

async function setupTauriFileDrop() {
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const webviewWindow = getCurrentWebviewWindow();
    const isInsideBeforeDropZone = (position: { x: number; y: number }) => {
      const dropZone = getBeforeDropZoneElement();
      const rect = dropZone.getBoundingClientRect();
      const clientX = position.x;
      const clientY = position.y;
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    };
    await webviewWindow.onDragDropEvent((event) => {
      switch (event.payload.type) {
        case "enter":
        case "over": {
          const active = isInsideBeforeDropZone(event.payload.position);
          setBeforeDropActive(active);
          break;
        }
        case "leave":
        case "cancel":
          state.beforeDragDepth = 0;
          setBeforeDropActive(false);
          break;
        case "drop": {
          state.beforeDragDepth = 0;
          setBeforeDropActive(false);
          if (!isInsideBeforeDropZone(event.payload.position)) {
            break;
          }
          const paths = event.payload.paths ?? [];
          if (paths.length > 0) {
            void enqueuePaths(paths);
          }
          break;
        }
      }
    });
  } catch {
    // Non-Tauri runtime or API unavailable.
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target?.closest("#after-context-menu")) {
    hideAfterContextMenu();
  }
  if (!target?.closest("#before-context-menu")) {
    hideBeforeContextMenu();
  }
  const pickerButton = target?.closest<HTMLButtonElement>("[data-before-picker]");
  if (!pickerButton) {
    return;
  }
  if (pickerButton.disabled) {
    return;
  }
  void window.desktopBridge.pickFiles().then((filePaths) => {
    void enqueuePaths(filePaths);
  });
});

centerConvertButton.addEventListener("click", () => {
  void convertAllBeforeConvertibleItems();
});

centerRefreshButton.addEventListener("click", () => {
  clearAllItems();
});

beforeFilterToggleButton.addEventListener("click", () => {
  state.beforeNfdOnly = !state.beforeNfdOnly;
  renderLists();
});

themeToggleButton.addEventListener("click", () => {
  applyTheme(!state.darkMode, true);
});

copySelectionButton.addEventListener("click", () => {
  void copySelectedFiles();
});

copyPathsButton.addEventListener("click", () => {
  void copySelectedPathsAsText();
});

selectAllAfterButton.addEventListener("click", () => {
  if (state.results.length === 0) {
    return;
  }
  const allSelected = state.selectedOutputPaths.size === state.results.length;
  if (allSelected) {
    state.selectedOutputPaths.clear();
  } else {
    state.selectedOutputPaths = new Set(state.results.map((item) => item.outputPath));
  }
  refreshAfterSelectionVisuals();
});

beforeList.addEventListener("scroll", () => {
  updateScrollFadeState(beforeList);
  hideBeforeContextMenu();
});

afterList.addEventListener("scroll", () => {
  updateScrollFadeState(afterList);
  hideAfterContextMenu();
});

window.addEventListener("resize", () => {
  updateScrollFades();
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
    if (state.selectedOutputPaths.size > 0) {
      event.preventDefault();
      hideAfterContextMenu();
      hideBeforeContextMenu();
      void copySelectedFiles();
    }
  }
});

afterList.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (state.results.length === 0) {
    hideAfterContextMenu();
    return;
  }
  hideBeforeContextMenu();
  const target = event.target as HTMLElement | null;
  const card = target?.closest<HTMLElement>(".after-card");
  if (card) {
    const outputPath = card.dataset.outputPath;
    if (outputPath && !state.selectedOutputPaths.has(outputPath)) {
      const changedPaths = Array.from(state.selectedOutputPaths);
      state.selectedOutputPaths.clear();
      state.selectedOutputPaths.add(outputPath);
      changedPaths.push(outputPath);
      refreshAfterSelectionByPaths(changedPaths);
    }
  }
  showAfterContextMenu(event.clientX, event.clientY);
});

afterContextCopyFilesButton.addEventListener("click", () => {
  hideAfterContextMenu();
  void copySelectedFiles();
});

afterContextSelectAllButton.addEventListener("click", () => {
  hideAfterContextMenu();
  if (state.results.length === 0) {
    return;
  }
  state.selectedOutputPaths = new Set(state.results.map((item) => item.outputPath));
  renderLists();
  setStatus(`변환된 파일 목록 ${state.selectedOutputPaths.size}개를 전체 선택했습니다.`, "success");
});

afterContextCopyPathsButton.addEventListener("click", () => {
  hideAfterContextMenu();
  void copySelectedPathsAsText();
});

window.addEventListener("blur", () => {
  hideAfterContextMenu();
  hideBeforeContextMenu();
});

beforeList.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (state.beforeItems.length === 0) {
    hideBeforeContextMenu();
    return;
  }
  hideAfterContextMenu();
  const target = event.target as HTMLElement | null;
  const card = target?.closest<HTMLElement>(".before-card");
  if (card) {
    const sourcePath = card.dataset.sourcePath;
    if (sourcePath && !state.selectedBeforePaths.has(sourcePath)) {
      state.selectedBeforePaths.clear();
      state.selectedBeforePaths.add(sourcePath);
      refreshBeforeSelectionVisuals();
    }
  }
  showBeforeContextMenu(event.clientX, event.clientY);
});

beforeContextConvertButton.addEventListener("click", () => {
  hideBeforeContextMenu();
  void convertBeforeItems();
});

beforeContextClearButton.addEventListener("click", () => {
  hideBeforeContextMenu();
  if (state.busy || state.beforeItems.length === 0) {
    return;
  }
  const beforeCount = state.beforeItems.length;
  state.beforeItems = [];
  state.selectedBeforePaths.clear();
  renderLists();
  setStatus(`원본 파일 목록 ${beforeCount}개를 전체 삭제했습니다.`, "success");
});

renderLists();
updateScrollFades();
initializeTheme();
setupSystemThemeWatcher();
void setupTauriFileDrop();
appendStatusLog("앱이 준비되었습니다.");

import "./styles.css";
import pretendardStylesheetUrl from "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css?url";
import heroDocumentArrowUp from "./icons/hero/document-arrow-up.svg?raw";
import heroSun from "./icons/hero/sun.svg?raw";
import heroMoon from "./icons/hero/moon.svg?raw";
import heroChevronDown from "./icons/hero/chevron-down.svg?raw";
import heroMagnifyingGlass from "./icons/hero/magnifying-glass.svg?raw";
import heroFolderPlus from "./icons/hero/folder-plus.svg?raw";
import heroFolderMinus from "./icons/hero/folder-minus.svg?raw";
import heroArrowRight from "./icons/hero/arrow-right.svg?raw";
import heroArrowPath from "./icons/hero/arrow-path.svg?raw";
import heroCheckCircle from "./icons/hero/check-circle.svg?raw";
import heroLink from "./icons/hero/link.svg?raw";
import heroDocumentDuplicate from "./icons/hero/document-duplicate.svg?raw";
import heroFolder from "./icons/hero/folder.svg?raw";
import heroSparkles from "./icons/hero/sparkles.svg?raw";
import heroWindow from "./icons/hero/window.svg?raw";
import heroXMark from "./icons/hero/x-mark.svg?raw";
import heroListBullet from "./icons/hero/list-bullet.svg?raw";
import {
  desktopBridge,
  type DesktopBridge,
  type AutoConvertHistoryEntry,
  type BeforeItem as RawBeforeItem,
  type InspectProgress,
  type PickedMonitorDirectory,
  type MonitorStateEntry,
  type MonitorSnapshotEntry,
  type NormalizeProgress,
  type NormalizeResult as RawNormalizeResult
} from "./desktopBridge";
import {
  AUTO_MONITOR_CONVERT_STORAGE_KEY,
  AUTO_CONVERT_FILES_STORAGE_KEY,
  LIST_CLASS,
  LIST_CLASS_EMPTY,
  LIST_CLASS_VIRTUAL,
  MONITOR_SNAPSHOT_CHECK_INTERVAL_MS,
  MONITOR_SNAPSHOT_STALE_MS,
  MONITOR_START_DELAY_MS,
  MONITOR_WATCH_DEBOUNCE_MS,
  SELECTED_CARD_CLASSES,
  THEME_STORAGE_KEY,
  VIRTUAL_LIST_THRESHOLD,
  VIRTUAL_OVERSCAN,
  VIRTUAL_ROW_HEIGHT
} from "./constants";
import type {
  AppState,
  BeforeItem,
  MonitorBaseline,
  MonitorDirectoryInfo,
  NormalizeResult,
  StatusTone
} from "./types";
import {
  buildMonitorBaseline,
  collapseMonitorChangedPaths,
  collapseMonitorPendingEntries,
  dedupeMonitorEntriesByPath,
  getMonitorCandidateEntries,
  replaceMonitorBaselineEntries
} from "./utils/monitor";
import {
  escapeHtml,
  escapeHtmlAttribute,
  formatSnapshotTime,
  getDirectoryPath,
  getErrorMessage,
  isPathInFolderTree,
  normalizePathForCompare,
  toCompactPath,
  toMonitorPermissionGuidance
} from "./utils/path";

declare global {
  interface Window {
    desktopBridge: DesktopBridge;
  }
}

window.desktopBridge = desktopBridge;

const state: AppState = {
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
  afterInternalDragActive: false,
  busy: false,
  darkMode: false,
  mainWindowVisible: true,
  monitorDirectoryPaths: [] as string[],
  monitorPendingPaths: new Set<string>(),
  monitorPendingFileCount: 0,
  monitorPendingDirectoryCount: 0,
  monitorProgressMessage: "",
  launchAtLoginEnabled: false,
  autoMonitorConvertEnabled: false,
  autoConvertFilesEnabled: false,
  monitorAutoConvertRunning: false
};

function asHeroIcon(svgRaw: string, className: string) {
  return svgRaw
    .replace("<svg", `<svg aria-hidden="true" class="${className}"`)
    .replace(/<\/?title[^>]*>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const ICON_APP = asHeroIcon(heroDocumentArrowUp, "h-6 w-6");
const ICON_THEME_SUN = asHeroIcon(heroSun, "h-[22px] w-[22px]");
const ICON_THEME_MOON = asHeroIcon(heroMoon, "h-[22px] w-[22px]");
const ICON_CHEVRON_DOWN = asHeroIcon(
  heroChevronDown,
  "pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400"
);
const ICON_MONITOR_APPLY = asHeroIcon(heroMagnifyingGlass, "h-[18px] w-[18px] shrink-0");
const ICON_MONITOR_ADD = asHeroIcon(heroFolderPlus, "h-[18px] w-[18px] shrink-0");
const ICON_MONITOR_REMOVE = asHeroIcon(heroFolderMinus, "h-[18px] w-[18px] shrink-0");
const ICON_CENTER_CONVERT = asHeroIcon(heroArrowRight, "h-[22px] w-[22px]");
const ICON_CENTER_REFRESH = asHeroIcon(heroArrowPath, "h-[22px] w-[22px]");
const ICON_SELECT_ALL = asHeroIcon(heroCheckCircle, "h-[18px] w-[18px] shrink-0");
const ICON_COPY_PATHS = asHeroIcon(heroLink, "h-[18px] w-[18px] shrink-0");
const ICON_COPY_FILES = asHeroIcon(heroDocumentDuplicate, "h-[18px] w-[18px] shrink-0");
const ICON_AUTO_CONVERT_HISTORY = asHeroIcon(heroListBullet, "h-[18px] w-[18px]");
const ICON_FOLDER_CHIP = asHeroIcon(heroFolder, "h-3.5 w-3.5");
const ICON_NFD_CHIP = asHeroIcon(heroSparkles, "h-3.5 w-3.5");
const ICON_NFC_CHIP = asHeroIcon(heroWindow, "h-3.5 w-3.5");
const ICON_REMOVE = asHeroIcon(heroXMark, "h-3 w-3");

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container not found.");
}

app.innerHTML = `
  <main class="flex h-full w-full flex-col gap-3 overflow-hidden p-3">
    <section id="top-header-card" class="rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-soft backdrop-blur">
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-100 via-white to-violet-100 text-sky-700 shadow-sm">
            ${ICON_APP}
          </div>
          <div class="min-w-0">
            <h1 class="truncate text-xl font-extrabold tracking-tight text-stone-900 sm:text-2xl">File Path Renamer</h1>
            <p class="mt-0.5 truncate text-[11px] font-medium text-stone-500">macOS에서 한글 경로를 정리해 Windows 호환 첨부 파일로 바꿉니다.</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-3">
            <label class="inline-flex items-center gap-1.5 text-[12px] font-medium text-stone-600">
              <input id="launch-at-login-toggle" type="checkbox" class="h-4 w-4 rounded border-stone-300 text-violet-600 focus:ring-violet-400" />
              <span>로그인시 자동 실행</span>
            </label>
            <label class="inline-flex items-center gap-1.5 text-[12px] font-medium text-stone-600">
              <input id="auto-monitor-convert-toggle" type="checkbox" class="h-4 w-4 rounded border-stone-300 text-violet-600 focus:ring-violet-400" />
              <span>백그라운드 자동 감지</span>
            </label>
            <label class="inline-flex items-center gap-1.5 text-[12px] font-medium text-stone-600 ml-1 opacity-100 transition-opacity" id="auto-convert-files-label">
              <input id="auto-convert-files-toggle" type="checkbox" class="h-4 w-4 rounded border-stone-300 text-violet-600 focus:ring-violet-400 disabled:cursor-not-allowed" />
              <span>자동 변환</span>
            </label>
          </div>
          <div class="flex items-center gap-2">
            <button
              id="auto-convert-history-button"
              class="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 bg-stone-50 text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
              type="button"
              aria-label="자동 변환 내역"
              title="자동 변환 내역"
            >
              ${ICON_AUTO_CONVERT_HISTORY}
              <span
                id="auto-convert-history-badge"
                class="absolute -right-1 -top-1 hidden min-w-4 rounded-full bg-violet-600 px-1 text-center text-[10px] font-semibold leading-4 text-white"
              ></span>
            </button>
            <button
              id="theme-toggle"
              class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 bg-stone-50 text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
              type="button"
              aria-pressed="false"
              aria-label="다크 모드 켜기"
              title="다크 모드 켜기"
            >
              ${ICON_THEME_SUN}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section id="top-monitor-card" class="rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-soft backdrop-blur">
      <div class="mb-2 flex items-center gap-4">
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">Monitoring</p>
          <p id="monitor-directory-label" class="truncate text-sm font-semibold text-stone-900">모니터링 디렉토리를 선택해 주세요.</p>
        </div>
        <div class="flex shrink-0 items-center justify-end gap-2">
          <span
            id="monitor-activity-count"
            class="inline-flex min-w-[88px] items-center justify-end text-right text-[12px] font-semibold tabular-nums text-stone-500"
            aria-hidden="true"
          >대기중</span>
          <span
            id="monitor-activity-indicator"
            class="inline-flex h-3.5 w-3.5 shrink-0 rounded-full border border-stone-400/70 bg-stone-300 ring-2 ring-white/70"
            aria-label="모니터링 백그라운드 작업 없음"
            title="모니터링 백그라운드 작업 없음"
          ></span>
          <div class="relative">
            <select
              id="monitor-directory-list"
              class="h-9 min-w-[340px] max-w-[420px] appearance-none rounded-md border border-stone-300 bg-white pl-3 pr-8 text-[12px] font-medium leading-none text-stone-700 transition hover:border-stone-400"
            ></select>
            ${ICON_CHEVRON_DOWN}
          </div>
          <button
            id="monitor-apply"
            class="relative inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-violet-300 bg-violet-50 px-3 text-[12px] font-medium text-violet-700 transition hover:border-violet-400 hover:bg-violet-100 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-50 disabled:text-stone-300"
            type="button"
            aria-label="변환 대상 찾기"
            title="변환 대상 찾기"
            disabled
          >
            ${ICON_MONITOR_APPLY}
            <span id="monitor-apply-label">변환 대상 찾기</span>
            <span
              id="monitor-apply-badge"
              class="absolute -right-1 -top-1 hidden min-w-4 rounded-full bg-violet-600 px-1 text-center text-[10px] font-semibold leading-4 text-white"
            ></span>
          </button>
          <button
            id="monitor-directory-pick"
            class="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-stone-300 bg-white px-3 text-[12px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
            type="button"
            aria-label="모니터링 추가"
            title="모니터링 추가"
          >
            ${ICON_MONITOR_ADD}
            <span>모니터링 추가</span>
          </button>
          <button
            id="monitor-directory-clear"
            class="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-stone-300 bg-white px-3 text-[12px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            aria-label="모니터링 해제"
            title="모니터링 해제"
          >
            ${ICON_MONITOR_REMOVE}
            <span>모니터링 해제</span>
          </button>
        </div>
      </div>
      <div>
        <p id="status-text" class="status-idle hidden h-0 text-xs leading-5">아직 처리된 파일이 없습니다.</p>
        <div
          id="status-log"
          class="h-20 overflow-y-auto rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] leading-4 text-stone-600"
        ></div>
      </div>
    </section>

    <section class="relative grid gap-4 lg:grid-cols-2">
      <div class="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <button
          id="center-convert"
          class="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-sm font-semibold text-stone-600 shadow transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-200"
          type="button"
          aria-label="before 변환 실행"
          title="변환"
        >
          <span
            id="center-convert-badge"
            class="pointer-events-none absolute -right-1 -top-1 hidden min-w-4 rounded-full bg-violet-600 px-1 py-0.5 text-[9px] font-semibold leading-none text-white"
          ></span>
          ${ICON_CENTER_CONVERT}
        </button>
        <button
          id="center-refresh"
          class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-sm font-semibold text-stone-600 shadow transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-200"
          type="button"
          aria-label="before/after 전체 초기화"
          title="전체 초기화"
        >
          ${ICON_CENTER_REFRESH}
        </button>
      </div>
      <section id="before-section" class="relative rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-soft backdrop-blur">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <p class="text-[12px] font-semibold uppercase tracking-[0.18em] text-stone-400">Before</p>
            <h2 class="flex items-center gap-2 text-sm font-semibold text-stone-900">
              원본 파일 목록
              <span id="before-count" class="text-[12px] font-medium text-stone-400">(0개)</span>
            </h2>
          </div>
          <button
            id="before-filter-toggle"
            class="inline-flex items-center gap-2 self-end whitespace-nowrap rounded-md border border-stone-300 bg-stone-50 px-3 py-1.5 text-[12px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
            type="button"
            aria-pressed="false"
            aria-label="NFD만 보기"
            title="NFD만 보기"
          >
            <span class="text-[12px]">전체 보기</span>
            <span id="before-filter-toggle-pill" class="relative inline-flex h-4 w-9 rounded-full bg-stone-300 transition-colors">
              <span id="before-filter-toggle-knob" class="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform"></span>
            </span>
            <span id="before-filter-toggle-text" class="text-left text-[12px]">NFD만 보기</span>
          </button>
        </div>
        <div id="before-list-host" class="relative h-[460px] overflow-hidden rounded-2xl">
          <div id="before-list" class="grid content-start auto-rows-max h-[460px] max-h-[460px] min-h-[460px] gap-1 overflow-y-auto overflow-x-hidden pl-0 pr-0 py-0 [scrollbar-gutter:stable]">
            <div class="flex h-[444px] min-h-[444px] items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 text-center text-sm text-stone-400">
              원본 파일 목록이 여기에 표시됩니다.
            </div>
          </div>
        </div>
      </section>

      <section id="after-section" class="relative rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-soft backdrop-blur">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <p class="text-[12px] font-semibold uppercase tracking-[0.18em] text-stone-400">After</p>
            <h2 class="flex items-center gap-2 text-sm font-semibold text-stone-900">
              변환된 파일 목록
              <span id="after-count" class="text-[12px] font-medium text-stone-400">(0개)</span>
            </h2>
          </div>
          <div class="flex items-center gap-2 self-end">
            <button
              id="select-all-after"
              class="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-stone-300 bg-stone-50 px-3 text-[12px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              aria-label="전체 선택"
              title="전체 선택"
            >
              ${ICON_SELECT_ALL}
              <span id="select-all-after-label">전체 선택</span>
            </button>
            <button
              id="copy-paths"
              class="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-stone-300 bg-stone-50 px-3 text-[12px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              aria-label="경로 복사"
              title="경로 복사"
            >
              ${ICON_COPY_PATHS}
              <span>경로 복사</span>
            </button>
            <button
              id="copy-selection"
              class="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-stone-300 bg-stone-50 px-3 text-[12px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              aria-label="파일 복사"
              title="파일 복사"
            >
              ${ICON_COPY_FILES}
              <span>파일 복사</span>
            </button>
          </div>
        </div>
        <div id="after-list" class="grid content-start auto-rows-max h-[460px] max-h-[460px] min-h-[460px] gap-1 overflow-y-auto overflow-x-hidden pl-0 pr-0 py-0 [scrollbar-gutter:stable]">
          <div class="flex h-[444px] min-h-[444px] items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 text-center text-sm text-stone-400">
            변환된 파일 목록이 여기에 표시됩니다.
          </div>
        </div>
      </section>
    </section>

    <section id="convert-progress-card" class="rounded-2xl border border-stone-200/80 bg-white/90 px-4 py-3 shadow-soft backdrop-blur">
      <div id="progress-wrap" class="h-8">
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
      class="flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      전체 선택
    </button>
    <button
      id="after-context-copy-paths"
      class="mt-0.5 flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      경로 복사
    </button>
    <button
      id="after-context-copy-files"
      class="mt-0.5 flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      파일 복사
    </button>
  </div>
  <div
    id="copy-toast"
    class="pointer-events-none fixed bottom-3 right-3 z-[150] hidden w-[min(380px,calc(100vw-1.5rem))] rounded-xl border border-sky-200 bg-white p-3 shadow-[0_18px_42px_rgba(15,23,42,0.18),0_6px_16px_rgba(15,23,42,0.1)]"
    aria-live="polite"
  >
    <p id="copy-toast-title" class="text-[12px] font-semibold"></p>
    <div id="copy-toast-list" class="mt-1 max-h-36 overflow-y-auto text-[12px] leading-4"></div>
  </div>
  <div
    id="before-context-menu"
    class="fixed z-[140] hidden min-w-[140px] rounded-md border border-stone-300 bg-white p-1 shadow-lg"
    role="menu"
    aria-hidden="true"
  >
    <button
      id="before-context-convert"
      class="flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      변환 하기
    </button>
    <button
      id="before-context-clear"
      class="mt-0.5 flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      role="menuitem"
    >
      전체 삭제
    </button>
  </div>
  <div
    id="app-loading-overlay"
    class="pointer-events-none fixed inset-0 z-[160] hidden items-center justify-center bg-stone-900/18 backdrop-blur-[1px]"
    aria-hidden="true"
  >
    <div class="rounded-xl border border-stone-200 bg-white/95 px-4 py-2 shadow-lg">
      <p id="app-loading-message" class="text-[12px] font-medium text-stone-700">작업을 처리하고 있습니다...</p>
    </div>
  </div>
`;

const beforeList = document.querySelector<HTMLDivElement>("#before-list")!;
const beforeListHost = document.querySelector<HTMLDivElement>("#before-list-host")!;
const beforeSection = document.querySelector<HTMLElement>("#before-section")!;
const afterList = document.querySelector<HTMLDivElement>("#after-list")!;
const statusText = document.querySelector<HTMLParagraphElement>("#status-text")!;
const beforeCount = document.querySelector<HTMLSpanElement>("#before-count")!;
const beforeFilterToggleButton = document.querySelector<HTMLButtonElement>("#before-filter-toggle")!;
const beforeFilterTogglePill = document.querySelector<HTMLSpanElement>("#before-filter-toggle-pill")!;
const beforeFilterToggleKnob = document.querySelector<HTMLSpanElement>("#before-filter-toggle-knob")!;
const beforeFilterToggleText = document.querySelector<HTMLSpanElement>("#before-filter-toggle-text")!;
const afterCount = document.querySelector<HTMLSpanElement>("#after-count")!;
const progressWrap = document.querySelector<HTMLDivElement>("#progress-wrap")!;
const progressLabel = document.querySelector<HTMLSpanElement>("#progress-label")!;
const progressPercent = document.querySelector<HTMLSpanElement>("#progress-percent")!;
const progressTrack = document.querySelector<HTMLDivElement>("#progress-track")!;
const progressBar = document.querySelector<HTMLDivElement>("#progress-bar")!;
const monitorDirectoryLabel = document.querySelector<HTMLParagraphElement>("#monitor-directory-label")!;
const monitorDirectoryList = document.querySelector<HTMLSelectElement>("#monitor-directory-list")!;
const monitorApplyButton = document.querySelector<HTMLButtonElement>("#monitor-apply")!;
const monitorApplyBadge = document.querySelector<HTMLSpanElement>("#monitor-apply-badge")!;
const monitorApplyLabel = document.querySelector<HTMLSpanElement>("#monitor-apply-label")!;
const monitorDirectoryPickButton = document.querySelector<HTMLButtonElement>("#monitor-directory-pick")!;
const monitorDirectoryClearButton = document.querySelector<HTMLButtonElement>("#monitor-directory-clear")!;
const monitorActivityIndicator = document.querySelector<HTMLSpanElement>("#monitor-activity-indicator")!;
const monitorActivityCount = document.querySelector<HTMLSpanElement>("#monitor-activity-count")!;
const statusLog = document.querySelector<HTMLDivElement>("#status-log")!;
const launchAtLoginToggle = document.querySelector<HTMLInputElement>("#launch-at-login-toggle")!;
const autoMonitorConvertToggle = document.querySelector<HTMLInputElement>("#auto-monitor-convert-toggle")!;
const autoConvertFilesToggle = document.querySelector<HTMLInputElement>("#auto-convert-files-toggle")!;
const autoConvertFilesLabel = document.querySelector<HTMLLabelElement>("#auto-convert-files-label")!;
const selectAllAfterButton = document.querySelector<HTMLButtonElement>("#select-all-after")!;
const selectAllAfterLabel = document.querySelector<HTMLSpanElement>("#select-all-after-label")!;
const copySelectionButton = document.querySelector<HTMLButtonElement>("#copy-selection")!;
const copyPathsButton = document.querySelector<HTMLButtonElement>("#copy-paths")!;
const centerConvertButton = document.querySelector<HTMLButtonElement>("#center-convert")!;
const centerConvertBadge = document.querySelector<HTMLSpanElement>("#center-convert-badge")!;
const centerRefreshButton = document.querySelector<HTMLButtonElement>("#center-refresh")!;
const autoConvertHistoryButton = document.querySelector<HTMLButtonElement>("#auto-convert-history-button")!;
const autoConvertHistoryBadge = document.querySelector<HTMLSpanElement>("#auto-convert-history-badge")!;
const afterContextMenu = document.querySelector<HTMLDivElement>("#after-context-menu")!;
const afterContextCopyFilesButton = document.querySelector<HTMLButtonElement>("#after-context-copy-files")!;
const afterContextSelectAllButton = document.querySelector<HTMLButtonElement>("#after-context-select-all")!;
const afterContextCopyPathsButton = document.querySelector<HTMLButtonElement>("#after-context-copy-paths")!;
const copyToast = document.querySelector<HTMLDivElement>("#copy-toast")!;
const copyToastTitle = document.querySelector<HTMLParagraphElement>("#copy-toast-title")!;
const copyToastList = document.querySelector<HTMLDivElement>("#copy-toast-list")!;
const beforeContextMenu = document.querySelector<HTMLDivElement>("#before-context-menu")!;
const beforeContextConvertButton = document.querySelector<HTMLButtonElement>("#before-context-convert")!;
const beforeContextClearButton = document.querySelector<HTMLButtonElement>("#before-context-clear")!;
const themeToggleButton = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
const appLoadingOverlay = document.querySelector<HTMLDivElement>("#app-loading-overlay")!;
const appLoadingMessage = document.querySelector<HTMLParagraphElement>("#app-loading-message")!;

if (
  !beforeList ||
  !beforeListHost ||
  !beforeSection ||
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
  !monitorDirectoryLabel ||
  !monitorDirectoryList ||
  !monitorApplyButton ||
  !monitorApplyBadge ||
  !monitorApplyLabel ||
  !monitorDirectoryPickButton ||
  !monitorDirectoryClearButton ||
  !monitorActivityIndicator ||
  !monitorActivityCount ||
  !statusLog ||
  !launchAtLoginToggle ||
  !autoMonitorConvertToggle ||
  !autoConvertFilesToggle ||
  !autoConvertFilesLabel ||
  !selectAllAfterButton ||
  !selectAllAfterLabel ||
  !copySelectionButton ||
  !copyPathsButton ||
  !centerConvertButton ||
  !centerConvertBadge ||
  !centerRefreshButton ||
  !autoConvertHistoryButton ||
  !autoConvertHistoryBadge ||
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
  !themeToggleButton ||
  !appLoadingOverlay ||
  !appLoadingMessage
) {
  throw new Error("Failed to initialize UI.");
}

beforeList.dataset.loadingLabel = "로딩중...";
afterList.dataset.loadingLabel = "로딩중...";

let copyToastTimerId = 0;
let lastTaskToastMessage = "";
let lastTaskToastAt = 0;
const afterCardElementMap = new Map<string, HTMLElement>();
const resultIndexBySourcePath = new Map<string, number>();
const resultIndexByOutputPath = new Map<string, number>();
let latestInspectFileCount = 0;
let beforeScrollRafId = 0;
let afterScrollRafId = 0;
let currentBeforeVisibleEntries: Array<{ item: BeforeItem; originalIndex: number }> = [];
let currentAfterVisibleItems: NormalizeResult[] = [];
let listRenderGeneration = 0;
let monitorBaselines = new Map<string, MonitorBaseline>();
let monitorLastSnapshotAt = new Map<string, number>();
let monitorPendingEntriesByDirectory = new Map<string, MonitorSnapshotEntry[]>();
let monitorDirectoryBookmarks = new Map<string, string>();
let lastMonitorStatusMessage = "";
let monitorStartTimerId = 0;
let monitorSnapshotCheckTimerId = 0;
let monitorStartGeneration = 0;
const ENABLE_MONITOR_BG_UI_BLOCKER = false;
const MONITOR_STATE_SAVE_DEBOUNCE_MS = 1500;
type MonitorPendingWorkerRequest = {
  requestId: number;
  retainedPendingEntries: MonitorSnapshotEntry[];
  candidateEntries: MonitorSnapshotEntry[];
  changedPaths: string[];
  isIncrementalRefresh: boolean;
};

type MonitorPendingWorkerResponse = {
  requestId: number;
  pendingEntries: MonitorSnapshotEntry[];
};

let monitorPendingWorker: Worker | null = null;
let monitorPendingWorkerRequestId = 0;
const monitorPendingWorkerResolvers = new Map<
  number,
  { resolve: (entries: MonitorSnapshotEntry[]) => void; reject: (reason?: unknown) => void }
>();
let monitorBackgroundTaskCount = 0;
let monitorBackgroundError = false;
let monitorBackgroundErrorMessage = "";
let monitorAutoSnapshotRunning = false;
let monitorWatchListenersReady = false;
let monitorWatchEventUnsubscribe: (() => void) | null = null;
let monitorWatchErrorUnsubscribe: (() => void) | null = null;
let mainWindowVisibilityUnsubscribe: (() => void) | null = null;
const monitorWatchDebounceTimerIds = new Map<string, number>();
const monitorWatchPendingPathsByRoot = new Map<string, Set<string>>();
const monitorWatchRefreshRunningRoots = new Set<string>();
let pretendardLoaded = false;
let monitorStateSaveTimerId = 0;
let monitorStateSaveInFlight = false;
let monitorStateSaveQueued = false;
let trayBackgroundConvertedCount = 0;
let autoConvertHistoryCount = 0;
let beforeVirtualLoadingTimerId = 0;
let afterVirtualLoadingTimerId = 0;
const systemThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

function ensureMonitorPendingWorker() {
  if (monitorPendingWorker) {
    return monitorPendingWorker;
  }

  try {
    monitorPendingWorker = new Worker(
      new URL("./workers/monitorPending.worker.ts", import.meta.url),
      { type: "module" }
    );
  } catch {
    monitorPendingWorker = null;
    return null;
  }

  monitorPendingWorker.onmessage = (event: MessageEvent<MonitorPendingWorkerResponse>) => {
    const payload = event.data;
    const resolver = monitorPendingWorkerResolvers.get(payload.requestId);
    if (!resolver) {
      return;
    }
    monitorPendingWorkerResolvers.delete(payload.requestId);
    resolver.resolve(payload.pendingEntries);
  };

  monitorPendingWorker.onerror = (event) => {
    const error = event.error ?? new Error(event.message || "monitor pending worker failed");
    for (const [, resolver] of monitorPendingWorkerResolvers) {
      resolver.reject(error);
    }
    monitorPendingWorkerResolvers.clear();
    if (monitorPendingWorker) {
      monitorPendingWorker.terminate();
      monitorPendingWorker = null;
    }
  };

  return monitorPendingWorker;
}

function terminateMonitorPendingWorker() {
  if (monitorPendingWorker) {
    monitorPendingWorker.terminate();
    monitorPendingWorker = null;
  }
  for (const [, resolver] of monitorPendingWorkerResolvers) {
    resolver.reject(new Error("monitor pending worker terminated"));
  }
  monitorPendingWorkerResolvers.clear();
}

async function calculatePendingEntries(
  retainedPendingEntries: MonitorSnapshotEntry[],
  candidateEntries: MonitorSnapshotEntry[],
  changedPaths: string[],
  isIncrementalRefresh: boolean
) {
  const worker = ensureMonitorPendingWorker();
  if (!worker) {
    const changedPathSet = new Set(changedPaths);
    const inspectedPendingEntries = candidateEntries.filter((entry) =>
      changedPathSet.has(entry.path)
    );
    const merged = isIncrementalRefresh
      ? [...retainedPendingEntries, ...inspectedPendingEntries]
      : inspectedPendingEntries;
    return collapseMonitorPendingEntries(merged);
  }

  const requestId = ++monitorPendingWorkerRequestId;
  const payload: MonitorPendingWorkerRequest = {
    requestId,
    retainedPendingEntries,
    candidateEntries,
    changedPaths,
    isIncrementalRefresh
  };

  return await new Promise<MonitorSnapshotEntry[]>((resolve, reject) => {
    monitorPendingWorkerResolvers.set(requestId, { resolve, reject });
    try {
      worker.postMessage(payload);
    } catch (error) {
      monitorPendingWorkerResolvers.delete(requestId);
      reject(error);
    }
  });
}

function isRelevantMonitorWatchKind(kind: string) {
  return kind === "create" || kind === "modify" || kind === "remove";
}

function getMonitorWatchDebounceDelay(kind: string) {
  if (kind === "create" || kind === "remove") {
    return 120;
  }
  return MONITOR_WATCH_DEBOUNCE_MS;
}

function persistAutoMonitorConvertEnabled(enabled: boolean) {
  window.localStorage.setItem(AUTO_MONITOR_CONVERT_STORAGE_KEY, enabled ? "true" : "false");
}

function loadAutoMonitorConvertEnabled() {
  return window.localStorage.getItem(AUTO_MONITOR_CONVERT_STORAGE_KEY) === "true";
}

function persistAutoConvertFilesEnabled(enabled: boolean) {
  window.localStorage.setItem(AUTO_CONVERT_FILES_STORAGE_KEY, enabled ? "true" : "false");
}

function loadAutoConvertFilesEnabled() {
  return window.localStorage.getItem(AUTO_CONVERT_FILES_STORAGE_KEY) === "true";
}

function syncAutoConvertFilesUI() {
  if (state.autoMonitorConvertEnabled) {
    autoConvertFilesLabel.classList.remove("opacity-40");
    autoConvertFilesToggle.disabled = state.busy;
  } else {
    autoConvertFilesLabel.classList.add("opacity-40");
    autoConvertFilesToggle.disabled = true;
  }
}

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
  themeToggleButton.innerHTML = darkMode ? ICON_THEME_MOON : ICON_THEME_SUN;
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
  (systemThemeMediaQuery as any).addListener(handleSystemThemeChange);
}

async function initializeLaunchAtLoginSetting() {
  try {
    state.launchAtLoginEnabled = await window.desktopBridge.isLaunchAtLoginEnabled();
  } catch (error) {
    state.launchAtLoginEnabled = false;
    appendStatusLog(
      `로그인시 자동 실행 설정을 읽지 못했습니다. 원인: ${getErrorMessage(error, "설정 읽기 실패")}`,
      "error"
    );
  }
  launchAtLoginToggle.checked = state.launchAtLoginEnabled;
}

function initializeAutoMonitorConvertSetting() {
  state.autoMonitorConvertEnabled = loadAutoMonitorConvertEnabled();
  autoMonitorConvertToggle.checked = state.autoMonitorConvertEnabled;
  
  state.autoConvertFilesEnabled = loadAutoConvertFilesEnabled();
  autoConvertFilesToggle.checked = state.autoConvertFilesEnabled;
  
  syncAutoConvertFilesUI();
}

function syncAutomationSettingControls() {
  launchAtLoginToggle.disabled = state.busy;
  autoMonitorConvertToggle.disabled = state.busy;
  syncAutoConvertFilesUI();
}

function updateAutoConvertHistoryBadge() {
  autoConvertHistoryBadge.textContent = autoConvertHistoryCount > 99 ? "99+" : String(autoConvertHistoryCount);
  autoConvertHistoryBadge.classList.toggle("hidden", autoConvertHistoryCount <= 0);
}

function clearMonitorPendingEntriesByPaths(paths: string[]) {
  if (monitorPendingEntriesByDirectory.size === 0 || paths.length === 0) {
    return;
  }

  const normalizedPaths = Array.from(new Set(paths.map((path) => normalizePathForCompare(path))));
  let changed = false;
  for (const [rootPath, entries] of monitorPendingEntriesByDirectory.entries()) {
    const nextEntries = entries.filter((entry) => {
      const entryPath = normalizePathForCompare(entry.path);
      return !normalizedPaths.some(
        (pendingPath) => entryPath === pendingPath || isPathInFolderTree(entryPath, pendingPath)
      );
    });
    if (nextEntries.length !== entries.length) {
      monitorPendingEntriesByDirectory.set(rootPath, nextEntries);
      changed = true;
    }
  }

  if (changed) {
    recomputeMonitorPendingState();
    updateMonitorLabels();
    schedulePersistMonitorState();
  }
}

type MonitorPendingFilterResult = {
  pathsToEnqueue: string[];
  excludedPaths: string[];
};

async function filterAlreadyHandledMonitorPendingPaths(
  pendingPaths: string[]
): Promise<MonitorPendingFilterResult> {
  if (pendingPaths.length === 0) {
    return { pathsToEnqueue: [], excludedPaths: [] };
  }

  const normalizedPending = pendingPaths.map((path) => ({
    original: path,
    normalized: normalizePathForCompare(path)
  }));

  const excludeExactSet = new Set<string>();
  const addExcludePath = (path: string) => {
    const normalized = normalizePathForCompare(path);
    excludeExactSet.add(normalized);
  };

  // 이미 before/after 목록에 있는 항목은 다시 enqueue 하지 않는다.
  for (const item of state.beforeItems) {
    addExcludePath(item.sourcePath);
  }
  for (const item of state.results) {
    addExcludePath(item.sourcePath);
    addExcludePath(item.outputPath);
  }

  // 백그라운드 자동 변환 내역에 있는 항목도 변환 대상 찾기에서는 제외한다.
  try {
    const backgroundHistory = await window.desktopBridge.loadAutoConvertHistory();
    for (const entry of backgroundHistory) {
      addExcludePath(entry.sourcePath);
      addExcludePath(entry.outputPath);
    }
  } catch (error) {
    appendStatusLog(
      `자동 변환 내역 기반 중복 제외를 건너뜁니다. 원인: ${getErrorMessage(error, "내역 조회 실패")}`,
      "error"
    );
  }

  const pathsToEnqueue: string[] = [];
  const excludedPaths: string[] = [];
  for (const entry of normalizedPending) {
    if (excludeExactSet.has(entry.normalized)) {
      excludedPaths.push(entry.original);
      continue;
    }
    pathsToEnqueue.push(entry.original);
  }

  return { pathsToEnqueue, excludedPaths };
}

async function scheduleAutoMonitorConvertIfNeeded() {
  if (
    !state.autoMonitorConvertEnabled ||
    state.monitorPendingPaths.size === 0 ||
    state.busy ||
    state.monitorAutoConvertRunning
  ) {
    return;
  }

  state.monitorAutoConvertRunning = true;
  updateAutoConvertForegroundOverlay();
  try {
    const pendingEntries = getUniquePendingEntries();
    if (pendingEntries.length === 0) {
      return;
    }

    // 자동 감지 + 자동 변환은 앱이 백그라운드일 때만 수행한다.
    if (state.autoMonitorConvertEnabled && state.autoConvertFilesEnabled && !state.mainWindowVisible) {
      appendStatusLog(
        `자동 감지: ${pendingEntries.length}개 항목 변환을 시도합니다.`,
        "idle"
      );
      await convertSourcePaths(
        pendingEntries.map((entry) => entry.path),
        true
      );
    }
  } finally {
    state.monitorAutoConvertRunning = false;
    updateAutoConvertForegroundOverlay();
  }
}

function getUniquePendingEntries() {
  const pendingEntries: MonitorSnapshotEntry[] = [];
  const seenPendingPaths = new Set<string>();
  for (const entries of monitorPendingEntriesByDirectory.values()) {
    for (const entry of entries) {
      if (seenPendingPaths.has(entry.path)) {
        continue;
      }
      seenPendingPaths.add(entry.path);
      pendingEntries.push(entry);
    }
  }
  return pendingEntries;
}

function showCopyToast(title: string, names: string[]) {
  if (copyToastTimerId !== 0) {
    window.clearTimeout(copyToastTimerId);
    copyToastTimerId = 0;
  }
  copyToast.classList.remove("toast-success", "toast-error");
  copyToastTitle.textContent = title;
  copyToastTitle.className = "text-[12px] font-semibold";
  const previewNames = names
    .slice(0, 10)
    .map((name) => `<p class="truncate">• ${escapeHtml(name)}</p>`)
    .join("");
  const remain = names.length - Math.min(names.length, 10);
  const tail = remain > 0 ? `<p class="mt-0.5 toast-tail">외 ${remain}개</p>` : "";
  copyToastList.innerHTML = `${previewNames}${tail}`;
  copyToast.classList.remove("hidden");
  copyToastTimerId = window.setTimeout(() => {
    copyToast.classList.add("hidden");
    copyToastTimerId = 0;
  }, 3400);
}

function showTaskToast(message: string, tone: Exclude<StatusTone, "idle">) {
  const now = Date.now();
  if (lastTaskToastMessage === message && now - lastTaskToastAt < 1200) {
    return;
  }
  lastTaskToastMessage = message;
  lastTaskToastAt = now;

  if (copyToastTimerId !== 0) {
    window.clearTimeout(copyToastTimerId);
    copyToastTimerId = 0;
  }

  copyToast.classList.remove("toast-success", "toast-error");
  copyToast.classList.add(tone === "error" ? "toast-error" : "toast-success");
  copyToastTitle.textContent = tone === "error" ? "작업 실패" : "작업 완료";
  copyToastTitle.className = "text-[12px] font-semibold";
  copyToastList.innerHTML = `<p class="leading-4">${escapeHtml(message)}</p>`;
  copyToast.classList.remove("hidden");
  copyToastTimerId = window.setTimeout(() => {
    copyToast.classList.add("hidden");
    copyToastTimerId = 0;
  }, 3200);
}

function loadPretendardStylesheet() {
  if (pretendardLoaded) {
    return;
  }
  pretendardLoaded = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = pretendardStylesheetUrl;
  document.head.appendChild(link);
}

function updateTrayBackgroundBadge(count: number) {
  const normalized = Math.max(0, Math.floor(count));
  trayBackgroundConvertedCount = normalized;
  void window.desktopBridge.setTrayBadgeCount(normalized).catch(() => {
    // 트레이 배지 갱신 실패는 앱 동작에 영향을 주지 않도록 무시한다.
  });
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

function appendStatusLog(message: string, tone: StatusTone = "idle") {
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
  if (tone === "success" || tone === "error") {
    showTaskToast(message, tone);
  }
}

function beginMonitorBackgroundTask() {
  monitorBackgroundTaskCount += 1;
  monitorBackgroundError = false;
  monitorBackgroundErrorMessage = "";
  updateMonitorProgressDisplay();
  updateMonitorLabels();

  if (ENABLE_MONITOR_BG_UI_BLOCKER && monitorBackgroundTaskCount === 1) {
    setAppLoadingOverlay(true, state.monitorProgressMessage || "백그라운드 작업 중...");
  }
}

function endMonitorBackgroundTask(success = true, errorMessage = "") {
  monitorBackgroundTaskCount = Math.max(0, monitorBackgroundTaskCount - 1);
  if (!success) {
    monitorBackgroundError = true;
    monitorBackgroundErrorMessage = errorMessage.trim() || monitorBackgroundErrorMessage;
  } else if (monitorBackgroundTaskCount === 0) {
    monitorBackgroundError = false;
    monitorBackgroundErrorMessage = "";
  }
  if (ENABLE_MONITOR_BG_UI_BLOCKER && monitorBackgroundTaskCount === 0) {
    state.monitorProgressMessage = "";
    setAppLoadingOverlay(false);
  }
  updateMonitorProgressDisplay();
  updateMonitorLabels();
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
  centerRefreshButton.disabled = nextBusy || (state.beforeItems.length === 0 && state.results.length === 0);
  syncAutomationSettingControls();
  updateMonitorProgressDisplay();
  updateMonitorLabels();
  updateAutoConvertForegroundOverlay();
  if (!nextBusy) {
    resetBeforeDropInteractionState();
    void scheduleAutoMonitorConvertIfNeeded();
  }
}

function setStatus(message: string, tone: StatusTone = "idle") {
  statusText.textContent = message;
  statusText.classList.remove("status-idle", "status-error", "status-success");
  statusText.classList.add(`status-${tone}`);
  appendStatusLog(message, tone);
}

function updateMonitorProgressDisplay() {
  // 상단 상태 로그 아래 별도 진행 라벨 영역을 제거함.
  // 기존 호출부 호환을 위해 no-op 으로 유지한다.
}

function setMonitorProgressMessage(message: string) {
  if (!ENABLE_MONITOR_BG_UI_BLOCKER) {
    return;
  }
  state.monitorProgressMessage = message;
  updateMonitorProgressDisplay();
}

function setAppLoadingOverlay(
  active: boolean,
  message: string = "작업을 처리하고 있습니다...",
  force = false
) {
  if (!ENABLE_MONITOR_BG_UI_BLOCKER && !force) {
    appLoadingOverlay.classList.add("hidden");
    appLoadingOverlay.classList.remove("flex");
    appLoadingOverlay.setAttribute("aria-hidden", "true");
    return;
  }
  if (active) {
    appLoadingMessage.textContent = message;
    appLoadingOverlay.classList.remove("hidden");
    appLoadingOverlay.classList.add("flex");
    appLoadingOverlay.setAttribute("aria-hidden", "false");
  } else {
    appLoadingOverlay.classList.add("hidden");
    appLoadingOverlay.classList.remove("flex");
    appLoadingOverlay.setAttribute("aria-hidden", "true");
  }
}

function shouldShowAutoConvertForegroundOverlay() {
  return (
    state.mainWindowVisible &&
    state.monitorAutoConvertRunning &&
    state.busy &&
    state.autoMonitorConvertEnabled &&
    state.autoConvertFilesEnabled
  );
}

function updateAutoConvertForegroundOverlay() {
  if (shouldShowAutoConvertForegroundOverlay()) {
    setAppLoadingOverlay(
      true,
      "백그라운드에서 감지된 파일을 정책에 의해 자동 변환 중입니다 ...",
      true
    );
    return;
  }
  if (!ENABLE_MONITOR_BG_UI_BLOCKER) {
    setAppLoadingOverlay(false, "", true);
  }
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
  state.progressBaseLabel = "처리 중";
  state.progressDotStep = 0;
  updateMonitorProgressDisplay();
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

function withMonitorPermissionGuidance(message: string) {
  return toMonitorPermissionGuidance(message, {
    monitorDirectoryPaths: state.monitorDirectoryPaths,
    monitorDirectoryBookmarks,
    isDev: import.meta.env.DEV
  });
}

function toBeforeUnselectedCardClass(isDirectory: boolean, isNfdLike: boolean) {
  if (isDirectory) {
    return "border-sky-300 bg-sky-50 text-stone-900";
  }
  return isNfdLike
    ? "nfd-card border-stone-200 bg-white"
    : "nfc-card border-stone-200 bg-stone-100";
}

function getFolderSelectedCardClass() {
  return "border-2 border-violet-500 bg-violet-100 text-stone-900";
}

function getSelectedCardClass() {
  return "border-2 border-violet-500 bg-violet-100 text-stone-900";
}

function getFolderChipClass(isSelected: boolean) {
  return isSelected
    ? "border-violet-300 bg-violet-200 text-violet-800"
    : "border-sky-300 bg-sky-200 text-sky-800";
}

function getFolderMetaTextClass(isSelected: boolean) {
  return isSelected ? "text-violet-700" : "text-sky-700";
}

async function persistMonitorState() {
  const uniqueValues = Array.from(new Set(state.monitorDirectoryPaths.filter((value) => value.trim().length > 0)));
  const entries: MonitorStateEntry[] = uniqueValues.map((path) => ({
    path,
    lastSnapshotAt: monitorLastSnapshotAt.get(path) ?? null,
    snapshotEntries: Array.from(monitorBaselines.get(path)?.byPath.values() ?? []),
    pendingEntries: monitorPendingEntriesByDirectory.get(path) ?? [],
    bookmarkData: monitorDirectoryBookmarks.get(path) ?? null
  }));
  await window.desktopBridge.saveMonitorState(entries);
}

async function loadPersistedMonitorState() {
  monitorLastSnapshotAt.clear();
  monitorBaselines.clear();
  monitorPendingEntriesByDirectory.clear();
  monitorDirectoryBookmarks.clear();
  const entries = await window.desktopBridge.loadMonitorState();
  const nextPaths: string[] = [];
  for (const entry of entries) {
    if (!entry.path.trim()) {
      continue;
    }
    nextPaths.push(entry.path);
    if (entry.lastSnapshotAt) {
      monitorLastSnapshotAt.set(entry.path, entry.lastSnapshotAt);
    }
    if (entry.snapshotEntries.length > 0) {
      monitorBaselines.set(entry.path, buildMonitorBaseline(entry.snapshotEntries));
    }
    if (entry.pendingEntries.length > 0) {
      monitorPendingEntriesByDirectory.set(entry.path, collapseMonitorPendingEntries(entry.pendingEntries));
    } else {
      monitorPendingEntriesByDirectory.set(entry.path, []);
    }
    if (entry.bookmarkData) {
      monitorDirectoryBookmarks.set(entry.path, entry.bookmarkData);
    }
  }
  recomputeMonitorPendingState();
  return nextPaths;
}

async function persistMonitorStateSafely() {
  try {
    await persistMonitorState();
  } catch (error) {
    const message = getErrorMessage(error, "모니터링 상태 저장 중 오류가 발생했습니다.");
    monitorBackgroundErrorMessage = message;
    appendStatusLog(`모니터링 상태 저장에 실패했습니다. 원인: ${message}`, "error");
  }
}

function schedulePersistMonitorState(delay = MONITOR_STATE_SAVE_DEBOUNCE_MS) {
  if (monitorStateSaveTimerId !== 0) {
    window.clearTimeout(monitorStateSaveTimerId);
  }
  monitorStateSaveTimerId = window.setTimeout(() => {
    monitorStateSaveTimerId = 0;
    void persistMonitorStateCoalesced();
  }, Math.max(0, delay));
}

function cancelPersistMonitorStateSchedule() {
  if (monitorStateSaveTimerId !== 0) {
    window.clearTimeout(monitorStateSaveTimerId);
    monitorStateSaveTimerId = 0;
  }
}

async function persistMonitorStateCoalesced() {
  if (monitorStateSaveInFlight) {
    monitorStateSaveQueued = true;
    return;
  }
  monitorStateSaveInFlight = true;
  try {
    await yieldToEventLoop();
    await persistMonitorStateSafely();
  } finally {
    monitorStateSaveInFlight = false;
    if (monitorStateSaveQueued) {
      monitorStateSaveQueued = false;
      schedulePersistMonitorState(300);
    }
  }
}

function getMonitorDirectoryInfos(): MonitorDirectoryInfo[] {
  return state.monitorDirectoryPaths.map((path) => {
    const pendingEntries = monitorPendingEntriesByDirectory.get(path) ?? [];
    return {
      path,
      lastSnapshotAt: monitorLastSnapshotAt.get(path) ?? null,
      pendingFileCount: pendingEntries.filter((entry) => !entry.isDirectory).length,
      pendingDirectoryCount: pendingEntries.filter((entry) => entry.isDirectory).length,
      pendingCount: pendingEntries.length
    };
  });
}

function recomputeMonitorPendingState() {
  const uniquePaths = new Set<string>();
  let pendingFileCount = 0;
  let pendingDirectoryCount = 0;

  monitorPendingEntriesByDirectory.forEach((entries) => {
    for (const entry of entries) {
      if (uniquePaths.has(entry.path)) {
        continue;
      }
      uniquePaths.add(entry.path);
      if (entry.isDirectory) {
        pendingDirectoryCount += 1;
      } else {
        pendingFileCount += 1;
      }
    }
  });

  state.monitorPendingPaths = uniquePaths;
  state.monitorPendingFileCount = pendingFileCount;
  state.monitorPendingDirectoryCount = pendingDirectoryCount;
  
  checkMonitorStatusLog();
}

function areSamePendingEntries(
  currentEntries: MonitorSnapshotEntry[],
  nextEntries: MonitorSnapshotEntry[]
) {
  if (currentEntries.length !== nextEntries.length) {
    return false;
  }
  for (let index = 0; index < currentEntries.length; index += 1) {
    const current = currentEntries[index];
    const next = nextEntries[index];
    if (!next) {
      return false;
    }
    if (
      current.path !== next.path ||
      current.isDirectory !== next.isDirectory ||
      current.id !== next.id
    ) {
      return false;
    }
  }
  return true;
}

function hasCenterConvertAction() {
  return hasBeforeConvertibleFiles();
}

function updateCenterConvertButtonState() {
  centerConvertButton.disabled = state.busy || !hasCenterConvertAction();
  centerConvertBadge.textContent = "";
  centerConvertBadge.classList.add("hidden");
  centerConvertButton.classList.add("border-stone-300", "bg-white", "text-stone-600");
  centerConvertButton.classList.remove("border-violet-400", "bg-violet-50", "text-violet-700");
  centerConvertButton.title = "변환";
  centerConvertButton.setAttribute("aria-label", "before 변환 실행");
}

function getMonitorActivityState(): "busy" | "error" | "idle" {
  if (monitorBackgroundError) {
    return "error";
  }
  if (monitorBackgroundTaskCount > 0) {
    return "busy";
  }
  return "idle";
}

function checkMonitorStatusLog() {
  let monitorStatusMessage = "";
  if (state.monitorDirectoryPaths.length === 0) {
    monitorStatusMessage = "모니터링 디렉토리를 추가하면 기준 스냅샷을 백그라운드에서 자동으로 준비합니다.";
  } else if (state.monitorPendingPaths.size > 0) {
    monitorStatusMessage = `감지 항목: 마지막 스냅샷 이후 변경/생성된 NFD 경로 파일 ${state.monitorPendingFileCount}개, 폴더 ${state.monitorPendingDirectoryCount}개. 변환 대상 찾기 버튼을 누르면 원본 파일 목록에 추가합니다.`;
  } else if (getMonitorDirectoryInfos().some((info) => info.lastSnapshotAt !== null)) {
    monitorStatusMessage = "기준 스냅샷이 준비되었습니다. 이후 변경되거나 새로 생성된 NFD 경로 항목을 감지합니다.";
  } else {
    monitorStatusMessage = "기준 스냅샷이 없으면 백그라운드에서 자동으로 생성됩니다.";
  }
  
  if (monitorStatusMessage && monitorStatusMessage !== lastMonitorStatusMessage) {
    appendStatusLog(monitorStatusMessage, "idle");
    lastMonitorStatusMessage = monitorStatusMessage;
  }
}

function updateMonitorLabels() {
  const monitorInfos = getMonitorDirectoryInfos();
  monitorDirectoryLabel.textContent =
    state.monitorDirectoryPaths.length > 0
      ? `모니터링 디렉토리 ${state.monitorDirectoryPaths.length}개`
      : "모니터링 디렉토리를 선택해 주세요.";

  const previousValue = monitorDirectoryList.value;
  if (monitorInfos.length === 0) {
    monitorDirectoryList.innerHTML = `<option value="">등록된 모니터링 디렉토리가 없습니다.</option>`;
    monitorDirectoryList.value = "";
  } else {
    monitorDirectoryList.innerHTML = monitorInfos
      .map((info) => {
        const pendingText =
          info.pendingCount > 0 ? ` / NFD 감지 ${info.pendingFileCount}파일 ${info.pendingDirectoryCount}폴더` : "";
        const snapshotText = info.lastSnapshotAt ? `마지막 스냅샷 ${formatSnapshotTime(info.lastSnapshotAt)}` : "마지막 스냅샷 없음";
        return `<option value="${escapeHtmlAttribute(info.path)}">${escapeHtml(
          `${toCompactPath(info.path)} | ${snapshotText}${pendingText}`
        )}</option>`;
      })
      .join("");
    monitorDirectoryList.value = monitorInfos.some((info) => info.path === previousValue)
      ? previousValue
      : monitorInfos[0]?.path ?? "";
  }

  monitorDirectoryClearButton.disabled = state.busy || state.monitorDirectoryPaths.length === 0;
  monitorDirectoryPickButton.disabled = state.busy;
  monitorDirectoryList.disabled = state.busy || state.monitorDirectoryPaths.length === 0;
  
  const pendingBadgeCount = Math.max(0, state.monitorPendingPaths.size);
  monitorApplyButton.disabled = state.busy || state.monitorDirectoryPaths.length === 0;
  monitorApplyButton.setAttribute("aria-label", "변환 대상 찾기");
  monitorApplyButton.title = "변환 대상 찾기";
  monitorApplyLabel.textContent = "변환 대상 찾기";
  monitorApplyBadge.textContent = pendingBadgeCount > 99 ? "99+" : String(pendingBadgeCount);
  monitorApplyBadge.classList.toggle("hidden", pendingBadgeCount === 0);
  monitorActivityIndicator.classList.remove(
    "border-stone-400/70",
    "border-emerald-700/70",
    "border-red-700/70",
    "bg-stone-300",
    "bg-emerald-500",
    "bg-red-500",
    "monitor-activity-blink"
  );
  const monitorActivityState = getMonitorActivityState();
  if (monitorActivityState === "busy") {
    monitorActivityIndicator.classList.add("border-emerald-700/70", "bg-emerald-500", "monitor-activity-blink");
    monitorActivityIndicator.setAttribute("aria-label", "모니터링 백그라운드 작업 진행 중");
    monitorActivityIndicator.title = "모니터링 백그라운드 작업 진행 중";
    monitorActivityCount.textContent = `${monitorBackgroundTaskCount}개 작업중`;
  } else if (monitorActivityState === "error") {
    monitorActivityIndicator.classList.add("border-red-700/70", "bg-red-500");
    monitorActivityIndicator.setAttribute("aria-label", "모니터링 백그라운드 작업 오류");
    monitorActivityIndicator.title = "모니터링 백그라운드 작업 오류";
    monitorActivityCount.textContent = "오류";
  } else {
    monitorActivityIndicator.classList.add("border-stone-400/70", "bg-stone-300");
    monitorActivityIndicator.setAttribute("aria-label", "모니터링 백그라운드 작업 없음");
    monitorActivityIndicator.title = "모니터링 백그라운드 작업 없음";
    monitorActivityCount.textContent = "대기중";
  }
  updateCenterConvertButtonState();
}

function toBeforeChipVariant(isDirectory: boolean, isNfdLike: boolean): BeforeItem["chipVariant"] {
  if (isDirectory) {
    return "folder";
  }
  return isNfdLike ? "apple" : "window";
}

function toBeforeMetaLabel(item: Pick<BeforeItem, "isDirectory" | "folderFileCount" | "compactPath">) {
  if (item.isDirectory) {
    return `폴더(${item.folderFileCount}개): ${item.compactPath}`;
  }
  return item.compactPath;
}

function decorateBeforeItem(
  item: RawBeforeItem
): BeforeItem {
  const nextItem: BeforeItem = {
    ...item,
    tooltipPath: escapeHtmlAttribute(item.sourcePath.normalize("NFC")),
    metaLabel: "",
    unselectedCardClass: toBeforeUnselectedCardClass(item.isDirectory, item.isNfdLike),
    chipVariant: toBeforeChipVariant(item.isDirectory, item.isNfdLike)
  };
  nextItem.metaLabel = toBeforeMetaLabel(nextItem);
  return nextItem;
}

function decorateNormalizeResult(
  item: RawNormalizeResult,
  convertedInBackground = false
): NormalizeResult {
  return {
    ...item,
    convertedInBackground
  };
}

function appendAfterItems(items: NormalizeResult[]) {
  let changed = false;
  for (const item of items) {
    const bySourceIndex = resultIndexBySourcePath.get(item.sourcePath);
    if (bySourceIndex !== undefined) {
      const previous = state.results[bySourceIndex];
      if (previous.outputPath !== item.outputPath) {
        resultIndexByOutputPath.delete(previous.outputPath);
      }
      state.results[bySourceIndex] = item;
      resultIndexByOutputPath.set(item.outputPath, bySourceIndex);
      changed = true;
      continue;
    }
    if (resultIndexByOutputPath.has(item.outputPath)) {
      continue;
    }
    const index = state.results.length;
    state.results.push(item);
    resultIndexBySourcePath.set(item.sourcePath, index);
    resultIndexByOutputPath.set(item.outputPath, index);
    changed = true;
  }
  return changed;
}

function scheduleInspectOverlay(fileCount: number) {
  latestInspectFileCount = fileCount;
  setBeforeListLoadingOverlay(true, `파일 목록 추가중... (파일 ${latestInspectFileCount}개)`);
}

function updateSelectionCount() {
  const total = state.results.length;
  const count = state.selectedOutputPaths.size;
  const allSelected = total > 0 && count === total;
  const selectAllLabel = allSelected ? "선택 해제" : "전체 선택";
  selectAllAfterButton.setAttribute("aria-label", selectAllLabel);
  selectAllAfterButton.title = selectAllLabel;
  selectAllAfterLabel.textContent = selectAllLabel;
  selectAllAfterButton.disabled = total === 0;
  copySelectionButton.disabled = count === 0;
  copyPathsButton.disabled = count === 0;
}

function updateListCounts() {
  if (state.beforeNfdOnly) {
    const visibleCount = state.beforeItems.filter((item) => item.isNfdLike).length;
    beforeCount.textContent = `(${visibleCount}/${state.beforeItems.length}개)`;
  } else {
    beforeCount.textContent = `(${state.beforeItems.length}개)`;
  }
  afterCount.textContent = `(${state.results.length}개)`;
}

function getBeforeFileCount() {
  return state.beforeItems.length;
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

function getSelectedAfterDragPaths() {
  const selectedItems = state.results.filter((item) => state.selectedOutputPaths.has(item.outputPath));
  const selectedDirectoryPaths = selectedItems
    .filter((item) => item.isDirectory)
    .map((item) => item.outputPath);

  return selectedItems
    .filter((item) => {
      for (const directoryPath of selectedDirectoryPaths) {
        if (directoryPath === item.outputPath) {
          continue;
        }
        if (isPathInFolderTree(item.outputPath, directoryPath)) {
          return false;
        }
      }
      return true;
    })
    .map((item) => item.outputPath);
}

function getSelectedBeforeFileCount() {
  return getSelectedBeforeItems().length;
}

function getSelectedBeforeConvertibleCount() {
  return getSelectedBeforeConvertibleItems().length;
}

function recalculateFolderFileCounts() {
  const directoryMap = new Map<string, BeforeItem>();
  for (const item of state.beforeItems) {
    if (item.isDirectory) {
      item.folderFileCount = 0;
      directoryMap.set(item.sourcePath, item);
    }
  }
  for (const item of state.beforeItems) {
    if (item.isDirectory) {
      continue;
    }
    let currentParent = item.parentFolderPath;
    while (currentParent) {
      const parent = directoryMap.get(currentParent);
      if (!parent) {
        break;
      }
      parent.folderFileCount += 1;
      currentParent = parent.parentFolderPath;
    }
  }
  for (const item of state.beforeItems) {
    if (item.isDirectory) {
      item.metaLabel = toBeforeMetaLabel(item);
    }
  }
}

function getVirtualRange(scrollTop: number, itemCount: number) {
  const viewportHeight = 460;
  const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
  const endIndex = Math.min(itemCount, startIndex + visibleCount);
  return { startIndex, endIndex };
}

function renderBeforeCard(entry: { item: BeforeItem; originalIndex: number }, displayIndex: number) {
  const { item, originalIndex } = entry;
  const isSelected = state.selectedBeforePaths.has(item.sourcePath);
  const selectedCardClass = isSelected ? getSelectedCardClass() : "";
  if (item.isDirectory) {
    const folderCardClass = isSelected ? getFolderSelectedCardClass() : item.unselectedCardClass;
    const folderChipClass = getFolderChipClass(isSelected);
    const folderMetaTextClass = getFolderMetaTextClass(isSelected);
    return `
      <article class="before-card flex h-[42px] items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-0 ${folderCardClass}" data-source-path="${item.sourcePath}" data-unselected-class="${item.unselectedCardClass}" data-path-tooltip="${item.tooltipPath}">
        <span class="inline-flex min-w-6 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-stone-500">
          ${displayIndex + 1}
        </span>
        <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${folderChipClass}">
          ${ICON_FOLDER_CHIP}
        </span>
        <div class="min-w-0 flex-1">
          <p class="h-4 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-medium leading-4 text-stone-800">${item.displayName}</p>
          <p class="h-4 truncate text-[10px] leading-4 ${folderMetaTextClass}" data-path-tooltip="${item.tooltipPath}">${item.metaLabel}</p>
        </div>
        <button
          class="before-remove-button ml-auto inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center bg-transparent text-stone-500 transition hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
          data-before-index="${originalIndex}"
          type="button"
          aria-label="before 항목 삭제"
          title="삭제"
          ${state.busy ? "disabled" : ""}
        >
          ${ICON_REMOVE}
        </button>
      </article>
    `;
  }

  const inChipClass = "bg-stone-200 text-stone-500";
  const inChipIcon = item.chipVariant === "apple"
    ? `
      ${ICON_NFD_CHIP}
    `
    : `
      ${ICON_NFC_CHIP}
    `;
  return `
    <article class="before-card flex h-[42px] items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-0 ${isSelected ? selectedCardClass : item.unselectedCardClass}" data-source-path="${item.sourcePath}" data-unselected-class="${item.unselectedCardClass}" data-path-tooltip="${item.tooltipPath}">
      <span class="inline-flex min-w-6 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-stone-500">
        ${displayIndex + 1}
      </span>
      <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${inChipClass}">
        ${inChipIcon}
      </span>
      <div class="min-w-0 flex-1">
        <p class="h-4 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-medium leading-4 text-stone-800">
          ${item.displayName}${
            item.isNfdLike
              ? `<span class="ml-1 text-[10px] font-medium text-stone-400">(${escapeHtml(item.normalizedDisplayName)})</span>`
              : ""
          }
        </p>
        <p class="h-4 truncate text-[10px] leading-4 text-stone-400" data-path-tooltip="${item.tooltipPath}">${item.metaLabel}</p>
      </div>
      <button
        class="before-remove-button ml-auto inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center bg-transparent text-stone-500 transition hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
        data-before-index="${originalIndex}"
        type="button"
        aria-label="before 항목 삭제"
        title="삭제"
        ${state.busy ? "disabled" : ""}
      >
        ${ICON_REMOVE}
      </button>
    </article>
  `;
}

function renderAfterCard(item: NormalizeResult, index: number) {
  const isSelected = state.selectedOutputPaths.has(item.outputPath);
  const fileUnselectedClass = toBeforeUnselectedCardClass(false, item.changed);
  const stateClasses = item.isDirectory
    ? isSelected
      ? getFolderSelectedCardClass()
      : toBeforeUnselectedCardClass(true, false)
    : isSelected
      ? getSelectedCardClass()
      : fileUnselectedClass;
  const metaTextClass = item.isDirectory
    ? getFolderMetaTextClass(isSelected)
    : "text-stone-400";
  const chipClass = item.isDirectory
    ? getFolderChipClass(isSelected)
    : "bg-stone-200 text-stone-500";
  const icon = item.isDirectory
    ? `
      ${ICON_FOLDER_CHIP}
    `
    : `
      ${ICON_NFC_CHIP}
    `;
  const convertSourceBadgeClass = item.convertedInBackground
    ? "after-convert-source-bg"
    : "after-convert-source-manual";
  const convertSourceBadgeLabel = item.convertedInBackground ? "백그라운드 자동 변환" : "사용자 수동 변환";

  return `
    <article
      class="after-card flex h-[42px] w-full cursor-pointer items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-0 transition ${stateClasses}"
      data-output-path="${item.outputPath}"
      data-unselected-class="${item.isDirectory ? toBeforeUnselectedCardClass(true, false) : fileUnselectedClass}"
    >
      <span class="inline-flex min-w-6 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-stone-500">
        ${index + 1}
      </span>
      <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${chipClass}">
        ${icon}
      </span>
      <div class="min-w-0 flex-1">
        <p class="h-4 max-w-full truncate text-[12px] font-medium leading-4 text-stone-800">${item.displayName}</p>
        <p class="h-4 truncate text-[10px] leading-4 ${metaTextClass}" data-after-meta="true">${item.compactPath}</p>
      </div>
      <span class="ml-2 inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-semibold leading-none ${convertSourceBadgeClass}">
        ${convertSourceBadgeLabel}
      </span>
    </article>
  `;
}

function renderVirtualBeforeList(entries: Array<{ item: BeforeItem; originalIndex: number }>) {
  const totalHeight = entries.length * VIRTUAL_ROW_HEIGHT;
  const maxScrollTop = Math.max(0, totalHeight - beforeList.clientHeight);
  const scrollTop = Math.min(beforeList.scrollTop, maxScrollTop);
  if (scrollTop !== beforeList.scrollTop) {
    beforeList.scrollTop = scrollTop;
  }
  const { startIndex, endIndex } = getVirtualRange(scrollTop, entries.length);
  
  const rangeKey = `${startIndex}:${endIndex}:${listRenderGeneration}`;
  if (beforeList.dataset.rangeKey === rangeKey) {
    return;
  }
  beforeList.dataset.rangeKey = rangeKey;

  const visibleHtml = entries
    .slice(startIndex, endIndex)
    .map((entry, offset) => {
      const actualIndex = startIndex + offset;
      return `<div style="position:absolute;left:0;right:0;top:${actualIndex * VIRTUAL_ROW_HEIGHT}px;">${renderBeforeCard(entry, actualIndex)}</div>`;
    })
    .join("");

  beforeList.className = LIST_CLASS_VIRTUAL;
  beforeList.classList.remove("virtual-scroll-loading");
  beforeList.dataset.loadingLabel = "로딩중...";
  beforeList.innerHTML = `<div class="relative z-10" style="height:${totalHeight}px">${visibleHtml}</div>`;
}

function renderVirtualAfterList(items: NormalizeResult[]) {
  const totalHeight = items.length * VIRTUAL_ROW_HEIGHT;
  const maxScrollTop = Math.max(0, totalHeight - afterList.clientHeight);
  const scrollTop = Math.min(afterList.scrollTop, maxScrollTop);
  if (scrollTop !== afterList.scrollTop) {
    afterList.scrollTop = scrollTop;
  }
  const { startIndex, endIndex } = getVirtualRange(scrollTop, items.length);
  
  const rangeKey = `${startIndex}:${endIndex}:${listRenderGeneration}`;
  if (afterList.dataset.rangeKey === rangeKey) {
    return;
  }
  afterList.dataset.rangeKey = rangeKey;

  const visibleHtml = items
    .slice(startIndex, endIndex)
    .map((item, offset) => {
      const actualIndex = startIndex + offset;
      return `<div style="position:absolute;left:0;right:0;top:${actualIndex * VIRTUAL_ROW_HEIGHT}px;">${renderAfterCard(item, actualIndex)}</div>`;
    })
    .join("");

  afterList.className = LIST_CLASS_VIRTUAL;
  afterList.classList.remove("virtual-scroll-loading");
  afterList.dataset.loadingLabel = "로딩중...";
  afterList.innerHTML = `<div class="relative z-10" style="height:${totalHeight}px">${visibleHtml}</div>`;
  afterCardElementMap.clear();
  afterList.querySelectorAll<HTMLElement>(".after-card").forEach((element) => {
    const outputPath = element.dataset.outputPath;
    if (outputPath) {
      afterCardElementMap.set(outputPath, element);
    }
    element.setAttribute("draggable", "true");
  });
}

function showVirtualLoading(target: "before" | "after") {
  const list = target === "before" ? beforeList : afterList;
  const timerId = target === "before" ? beforeVirtualLoadingTimerId : afterVirtualLoadingTimerId;
  if (timerId !== 0) {
    return;
  }
  const nextTimerId = window.setTimeout(() => {
    list.classList.add("virtual-scroll-loading");
    if (target === "before") {
      beforeVirtualLoadingTimerId = 0;
      return;
    }
    afterVirtualLoadingTimerId = 0;
  }, 32);

  if (target === "before") {
    beforeVirtualLoadingTimerId = nextTimerId;
    return;
  }
  afterVirtualLoadingTimerId = nextTimerId;
}

function clearVirtualLoading(target: "before" | "after") {
  const list = target === "before" ? beforeList : afterList;
  const timerId = target === "before" ? beforeVirtualLoadingTimerId : afterVirtualLoadingTimerId;
  if (timerId !== 0) {
    window.clearTimeout(timerId);
    if (target === "before") {
      beforeVirtualLoadingTimerId = 0;
    } else {
      afterVirtualLoadingTimerId = 0;
    }
  }
  list.classList.remove("virtual-scroll-loading");
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
  updateCenterConvertButtonState();
}

function refreshAfterSelectionVisuals() {
  afterCardElementMap.forEach((card, outputPath) => {
    const selected = state.selectedOutputPaths.has(outputPath);
    applyCardSelectionClass(card, selected);
    const meta = card.querySelector<HTMLElement>("[data-after-meta=\"true\"]");
    if (meta) {
      meta.classList.toggle("text-violet-700", selected);
      meta.classList.toggle("text-stone-400", !selected);
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
      meta.classList.toggle("text-violet-700", selected);
      meta.classList.toggle("text-stone-400", !selected);
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
        aria-label="파일 추가"
        title="파일 추가"
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
    beforeList.classList.remove("pointer-events-none");
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
    "absolute inset-0 z-40 flex cursor-progress items-center justify-center rounded-2xl bg-stone-900/40 backdrop-blur-[1px]";
  overlay.innerHTML = `
    <div class="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-[12px] font-semibold text-stone-700 shadow-sm">
      <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-200 border-t-sky-500"></span>
      <span data-loading-text>${message}</span>
    </div>
  `;
  const blockOverlayEvent = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  overlay.addEventListener("click", blockOverlayEvent);
  overlay.addEventListener("mousedown", blockOverlayEvent);
  overlay.addEventListener("mouseup", blockOverlayEvent);
  overlay.addEventListener("pointerdown", blockOverlayEvent);
  overlay.addEventListener("pointerup", blockOverlayEvent);
  overlay.addEventListener("wheel", blockOverlayEvent, { passive: false });
  beforeList.classList.add("pointer-events-none");
  beforeListHost.appendChild(overlay);
}

function setBeforeDropActive(active: boolean) {
  const overlayId = "before-section-drop-overlay";
  const existingOverlay = beforeSection.querySelector<HTMLDivElement>(`#${overlayId}`);
  beforeList.classList.toggle("before-list-drop-active", active);
  if (!active) {
    if (existingOverlay) {
      existingOverlay.remove();
    }
    beforeSection.classList.remove("before-section-drop-active");
    return;
  }

  if (!existingOverlay) {
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.className = "before-section-drop-overlay";
    const blockEvent = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    overlay.addEventListener("click", blockEvent);
    overlay.addEventListener("mousedown", blockEvent);
    overlay.addEventListener("mouseup", blockEvent);
    overlay.addEventListener("pointerdown", blockEvent);
    overlay.addEventListener("pointerup", blockEvent);
    overlay.addEventListener("wheel", blockEvent, { passive: false });
    beforeSection.appendChild(overlay);
  }
  beforeSection.classList.add("before-section-drop-active");
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
  return beforeSection;
}

let beforeDropZoneBound: HTMLElement | null = null;

function isExternalFileDrag(event: DragEvent) {
  if (state.afterInternalDragActive) {
    return false;
  }
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

function resetBeforeDropInteractionState() {
  state.beforeDragDepth = 0;
  if (state.beforeDragHoverTimerId !== 0) {
    window.clearTimeout(state.beforeDragHoverTimerId);
    state.beforeDragHoverTimerId = 0;
  }
  setBeforeDropActive(false);
  setBeforeListLoadingOverlay(false);
  beforeList.classList.remove("pointer-events-none");
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

let renderListsRafId = 0;

function scheduleRenderLists() {
  if (renderListsRafId !== 0) {
    return;
  }
  renderListsRafId = window.requestAnimationFrame(() => {
    renderListsRafId = 0;
    renderLists();
  });
}

function renderListsSync() {
  if (renderListsRafId !== 0) {
    window.cancelAnimationFrame(renderListsRafId);
    renderListsRafId = 0;
  }
  renderLists();
}

function renderLists() {
  listRenderGeneration += 1;
  const existingBeforePaths = new Set(state.beforeItems.map((item) => item.sourcePath));
  state.selectedBeforePaths.forEach((sourcePath) => {
    if (!existingBeforePaths.has(sourcePath)) {
      state.selectedBeforePaths.delete(sourcePath);
    }
  });
  updateListCounts();
  updateSelectionCount();
  beforeFilterToggleButton.setAttribute("aria-pressed", state.beforeNfdOnly ? "true" : "false");
  const beforeFilterLabel = state.beforeNfdOnly ? "전체 보기" : "NFD만 보기";
  beforeFilterToggleButton.setAttribute("aria-label", beforeFilterLabel);
  beforeFilterToggleButton.title = beforeFilterLabel;
  beforeFilterTogglePill.classList.toggle("bg-sky-500", state.beforeNfdOnly);
  beforeFilterTogglePill.classList.toggle("bg-stone-300", !state.beforeNfdOnly);
  beforeFilterToggleKnob.classList.toggle("translate-x-5", state.beforeNfdOnly);
  beforeFilterToggleText.textContent = "NFD만 보기";
  centerRefreshButton.disabled = state.busy || (state.beforeItems.length === 0 && state.results.length === 0);
  updateMonitorLabels();

  const beforeVisibleEntries = state.beforeItems
    .map((item, originalIndex) => ({ item, originalIndex }))
    .filter(({ item }) => {
      if (!state.beforeNfdOnly) {
        return true;
      }
      return item.isNfdLike;
    });

  currentBeforeVisibleEntries = beforeVisibleEntries;

  if (beforeVisibleEntries.length === 0) {
    beforeList.dataset.largeList = "0";
    const emptyMessage =
      state.beforeItems.length === 0
        ? "원본 파일 목록이 여기에 표시됩니다."
        : state.beforeNfdOnly
          ? "NFD 파일이 없습니다."
          : "원본 파일 목록이 여기에 표시됩니다.";
    renderEmptyList(beforeList, emptyMessage, true);
  } else {
    beforeList.dataset.largeList = beforeVisibleEntries.length >= 1200 ? "1" : "0";
    if (beforeVisibleEntries.length >= VIRTUAL_LIST_THRESHOLD) {
      beforeList.dataset.virtualActive = "1";
      renderVirtualBeforeList(beforeVisibleEntries);
    } else {
      beforeList.dataset.virtualActive = "0";
      beforeList.className = LIST_CLASS;
      beforeList.innerHTML = beforeVisibleEntries.map((entry, index) => renderBeforeCard(entry, index)).join("");
    }
  }

  currentAfterVisibleItems = state.results;

  if (state.results.length === 0) {
    afterList.dataset.largeList = "0";
    afterList.dataset.virtualActive = "0";
    afterCardElementMap.clear();
    renderEmptyList(afterList, "변환된 파일 목록이 여기에 표시됩니다.");
  } else {
    afterList.dataset.largeList = state.results.length >= 1200 ? "1" : "0";
    if (state.results.length >= VIRTUAL_LIST_THRESHOLD) {
      afterList.dataset.virtualActive = "1";
      renderVirtualAfterList(state.results);
    } else {
      afterList.dataset.virtualActive = "0";
      afterList.className = LIST_CLASS;
      afterList.innerHTML = state.results.map((item, index) => renderAfterCard(item, index)).join("");
    }

    afterCardElementMap.clear();
    afterList.querySelectorAll<HTMLElement>(".after-card").forEach((element) => {
      const outputPath = element.dataset.outputPath;
      if (outputPath) {
        afterCardElementMap.set(outputPath, element);
      }
      element.setAttribute("draggable", "true");
    });
  }

  updateScrollFades();
  bindBeforeDropZoneEvents();
  resetBeforeDropInteractionState();
}

function updateScrollFadeState(list: HTMLDivElement) {
  const disableMaskForLargeList = list.dataset.largeList === "1";
  list.classList.toggle("scroll-fade-disabled", disableMaskForLargeList);
  if (disableMaskForLargeList) {
    list.classList.remove("scroll-fade-enabled", "scroll-fade-top", "scroll-fade-bottom");
    return;
  }

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

async function scanMonitorDirectorySnapshot(rootPath: string) {
  if (!rootPath) {
    return [];
  }
  return window.desktopBridge.scanMonitorDirectory(rootPath);
}

async function scanMonitorChangedPaths(changedPaths: string[]) {
  const collapsedPaths = collapseMonitorChangedPaths(changedPaths);
  if (collapsedPaths.length === 0) {
    return [];
  }
  return window.desktopBridge.scanMonitorPaths(collapsedPaths);
}

async function refreshMonitorBaselineForPath(path: string, reason: string, notify = true) {
  setMonitorProgressMessage(`스냅샷 생성 중: ${toCompactPath(path)}`);
  setAppLoadingOverlay(true, `스냅샷 생성 중: ${toCompactPath(path)}`);
  try {
    const snapshot = await scanMonitorDirectorySnapshot(path);
    monitorBaselines.set(path, buildMonitorBaseline(snapshot));
    monitorLastSnapshotAt.set(path, Date.now());
    monitorPendingEntriesByDirectory.set(path, []);
    recomputeMonitorPendingState();
    schedulePersistMonitorState();
    updateMonitorLabels();
    checkMonitorStatusLog();
    if (notify) {
      appendStatusLog(`${reason}: ${toCompactPath(path)} 기준 ${snapshot.length}개 항목을 갱신했습니다.`, "success");
    }
  } finally {
    setAppLoadingOverlay(false);
  }
}

async function recalculateMonitorPendingForPath(
  path: string,
  advanceSnapshotOnClear: boolean,
  changedPaths?: string[]
) {
  await yieldToEventLoop();
  const message = advanceSnapshotOnClear
    ? `스냅샷 재계산 중: ${toCompactPath(path)}`
    : `변경 감지 확인 중: ${toCompactPath(path)}`;
  setMonitorProgressMessage(message);
  if (advanceSnapshotOnClear) {
    setAppLoadingOverlay(true, message);
  }
  
  try {
    const isIncremental = changedPaths && changedPaths.length > 0;
    const pathsToScan = isIncremental ? collapseMonitorChangedPaths(changedPaths) : [path];
    const scannedEntries = await window.desktopBridge.daemonCollectPendingEntries(pathsToScan);
    
    const normalizedRoot = normalizePathForCompare(path);
    const validScannedEntries = scannedEntries.filter(
      (entry) => normalizePathForCompare(entry.path) !== normalizedRoot
    );

    let nextPending: MonitorSnapshotEntry[];
    if (isIncremental) {
      const currentPending = monitorPendingEntriesByDirectory.get(path) ?? [];
      const retained = currentPending.filter(
        (entry) => !pathsToScan.some((p) => entry.path === p || isPathInFolderTree(entry.path, p))
      );
      
      const candidateEntries = getMonitorCandidateEntries({
        path,
        entries: validScannedEntries,
        baseline: monitorBaselines.get(path),
        lastSnapshotAt: monitorLastSnapshotAt.get(path),
        previousPendingEntries: currentPending
      });

      nextPending = collapseMonitorPendingEntries([...retained, ...candidateEntries]);
    } else {
      const candidateEntries = getMonitorCandidateEntries({
        path,
        entries: validScannedEntries,
        baseline: monitorBaselines.get(path),
        lastSnapshotAt: monitorLastSnapshotAt.get(path),
        previousPendingEntries: monitorPendingEntriesByDirectory.get(path) ?? []
      });

      nextPending = collapseMonitorPendingEntries(candidateEntries);
    }
    
    monitorPendingEntriesByDirectory.set(path, nextPending);

    if (!monitorBaselines.has(path)) {
      const snapshot = await scanMonitorDirectorySnapshot(path);
      monitorBaselines.set(path, buildMonitorBaseline(snapshot));
      monitorLastSnapshotAt.set(path, Date.now());
    }

    await yieldToEventLoop();

    recomputeMonitorPendingState();
    schedulePersistMonitorState();
    updateMonitorLabels();
    void scheduleAutoMonitorConvertIfNeeded();
  } finally {
    if (advanceSnapshotOnClear) {
      setAppLoadingOverlay(false);
    }
  }
}

function clearMonitorWatchDebounceTimers() {
  for (const timerId of monitorWatchDebounceTimerIds.values()) {
    window.clearTimeout(timerId);
  }
  monitorWatchDebounceTimerIds.clear();
  monitorWatchPendingPathsByRoot.clear();
  monitorWatchRefreshRunningRoots.clear();
}

function stopMonitorPolling() {
  if (monitorStartTimerId !== 0) {
    window.clearTimeout(monitorStartTimerId);
    monitorStartTimerId = 0;
  }
  if (monitorSnapshotCheckTimerId !== 0) {
    window.clearTimeout(monitorSnapshotCheckTimerId);
    monitorSnapshotCheckTimerId = 0;
  }
  clearMonitorWatchDebounceTimers();
  void window.desktopBridge.stopMonitorWatch().catch((error) => {
    appendStatusLog(
      `모니터링 watcher 중지에 실패했습니다. 원인: ${getErrorMessage(
        error,
        "watcher 중지 실패"
      )}`,
      "error"
    );
  });
}

function getMonitorPathsNeedingAutoSnapshot(now = Date.now()) {
  return state.monitorDirectoryPaths.filter((path) => {
    const lastSnapshotAt = monitorLastSnapshotAt.get(path) ?? null;
    return lastSnapshotAt === null || now - lastSnapshotAt >= MONITOR_SNAPSHOT_STALE_MS;
  });
}

function scheduleMonitorSnapshotCheck(delay = MONITOR_SNAPSHOT_CHECK_INTERVAL_MS) {
  if (monitorSnapshotCheckTimerId !== 0) {
    window.clearTimeout(monitorSnapshotCheckTimerId);
  }
  if (state.monitorDirectoryPaths.length === 0) {
    monitorSnapshotCheckTimerId = 0;
    return;
  }
  monitorSnapshotCheckTimerId = window.setTimeout(() => {
    monitorSnapshotCheckTimerId = 0;
    void runAutoSnapshotRefresh(true);
  }, delay);
}

async function runAutoSnapshotRefresh(showToast = true) {
  if (monitorAutoSnapshotRunning || state.busy || state.monitorDirectoryPaths.length === 0) {
    scheduleMonitorSnapshotCheck();
    return;
  }

  const paths = getMonitorPathsNeedingAutoSnapshot();
  if (paths.length === 0) {
    scheduleMonitorSnapshotCheck();
    return;
  }

  monitorAutoSnapshotRunning = true;
  beginMonitorBackgroundTask();
  let success = true;
  let errorMessage = "";
  try {
    const compactTargets = paths.map((path) => toCompactPath(path));
    if (showToast) {
      showCopyToast(
        paths.some((path) => (monitorLastSnapshotAt.get(path) ?? null) === null)
          ? "기준 스냅샷을 자동 생성합니다"
          : "기준 스냅샷을 자동 갱신합니다",
        compactTargets
      );
    }
    appendStatusLog(
      paths.some((path) => (monitorLastSnapshotAt.get(path) ?? null) === null)
        ? `기준 스냅샷 ${paths.length}개를 백그라운드에서 자동 생성합니다.`
        : `12시간이 지나 기준 스냅샷 ${paths.length}개를 백그라운드에서 자동 갱신합니다.`,
      "idle"
    );
    for (const path of paths) {
      const hasSnapshot = (monitorLastSnapshotAt.get(path) ?? null) !== null;
      await refreshMonitorBaselineForPath(
        path,
        hasSnapshot ? "기준 스냅샷 자동 갱신 완료" : "기준 스냅샷 자동 생성 완료",
        false
      );
    }
    appendStatusLog(`모니터링 기준 스냅샷 ${paths.length}개를 자동으로 반영했습니다.`, "success");
    scheduleInitialMonitorPolling(false);
  } catch (error) {
    success = false;
    errorMessage = withMonitorPermissionGuidance(getErrorMessage(error, "자동 스냅샷 갱신에 실패했습니다."));
    appendStatusLog(`자동 스냅샷 갱신에 실패했습니다. 원인: ${errorMessage}`, "error");
  } finally {
    monitorAutoSnapshotRunning = false;
    endMonitorBackgroundTask(success, errorMessage);
    scheduleMonitorSnapshotCheck();
  }
}

async function runMonitorWatchRefresh(path: string, changedPaths: string[]) {
  if (!state.monitorDirectoryPaths.includes(path) || !monitorBaselines.has(path)) {
    return;
  }
  if (monitorWatchRefreshRunningRoots.has(path)) {
    scheduleMonitorWatchRefresh(path, changedPaths);
    return;
  }
  if (state.busy) {
    scheduleMonitorWatchRefresh(path, changedPaths);
    return;
  }
  // scheduleAutoMonitorConvertIfNeeded 가 진행 중이면 pending 집합이 변경될 수 있으므로,
  // 그 사이 추가 watch refresh 가 끼어들어 mid-flight 에 pending 을 재채우는 race 를 피한다.
  if (state.monitorAutoConvertRunning) {
    scheduleMonitorWatchRefresh(path, changedPaths);
    return;
  }

  monitorWatchRefreshRunningRoots.add(path);
  beginMonitorBackgroundTask();
  let success = true;
  let errorMessage = "";
  try {
    await recalculateMonitorPendingForPath(path, false, changedPaths);
  } catch (error) {
    success = false;
    errorMessage = withMonitorPermissionGuidance(
      getErrorMessage(error, "모니터링 폴더 확인 중 오류가 발생했습니다.")
    );
    appendStatusLog(errorMessage, "error");
  } finally {
    endMonitorBackgroundTask(success, errorMessage);
    monitorWatchRefreshRunningRoots.delete(path);
    if ((monitorWatchPendingPathsByRoot.get(path)?.size ?? 0) > 0) {
      scheduleMonitorWatchRefresh(path);
    }
  }
}

function scheduleMonitorWatchRefresh(path: string, changedPaths: string[] = [path], kind = "modify") {
  if (!path || !state.monitorDirectoryPaths.includes(path) || !monitorBaselines.has(path)) {
    return;
  }
  const pendingPaths = monitorWatchPendingPathsByRoot.get(path) ?? new Set<string>();
  for (const changedPath of changedPaths) {
    if (changedPath === path || isPathInFolderTree(changedPath, path)) {
      pendingPaths.add(changedPath);
    }
  }
  if (pendingPaths.size === 0) {
    pendingPaths.add(path);
  }
  monitorWatchPendingPathsByRoot.set(path, pendingPaths);
  const existingTimerId = monitorWatchDebounceTimerIds.get(path);
  if (existingTimerId) {
    window.clearTimeout(existingTimerId);
  }
  const debounceDelay = getMonitorWatchDebounceDelay(kind);
  const timerId = window.setTimeout(() => {
    monitorWatchDebounceTimerIds.delete(path);
    const queuedPaths = Array.from(monitorWatchPendingPathsByRoot.get(path) ?? [path]);
    monitorWatchPendingPathsByRoot.delete(path);
    void runMonitorWatchRefresh(path, queuedPaths);
  }, debounceDelay);
  monitorWatchDebounceTimerIds.set(path, timerId);
}

async function ensureMonitorWatchListeners() {
  if (monitorWatchListenersReady) {
    return;
  }
  monitorWatchEventUnsubscribe = await window.desktopBridge.onMonitorWatchEvent((event) => {
    if (!isRelevantMonitorWatchKind(event.kind)) {
      return;
    }
    // 감지 자체는 창 가시성과 무관하게 항상 동작해야 한다. 창이 떠 있을 때는 사용자가
    // "감지 항목" 버튼으로 수동으로 당겨오고, 창이 숨겨졌을 때는
    // scheduleAutoMonitorConvertIfNeeded() 가 (자체 visibility 가드로) 히스토리에 수집한다.
    for (const root of event.roots) {
      const changedPaths = event.paths.filter(
        (candidatePath) => candidatePath === root || isPathInFolderTree(candidatePath, root)
      );
      scheduleMonitorWatchRefresh(root, changedPaths.length > 0 ? changedPaths : [root], event.kind);
    }
  });
  monitorWatchErrorUnsubscribe = await window.desktopBridge.onMonitorWatchError((message) => {
    monitorBackgroundError = true;
    monitorBackgroundErrorMessage = message;
    updateMonitorLabels();
    appendStatusLog(`모니터링 watcher 오류: ${message}`, "error");
  });
  monitorWatchListenersReady = true;
}

async function startMonitorPolling(notify = true) {
  beginMonitorBackgroundTask();
  let success = true;
  let errorMessage = "";
  ++monitorStartGeneration;
  stopMonitorPolling();
  try {
    if (
      state.monitorDirectoryPaths.length === 0 ||
      !state.autoMonitorConvertEnabled
    ) {
      // 자동 감지가 꺼져 있거나 모니터링 경로가 없으면 Watcher 를 끕니다.
      await window.desktopBridge.stopMonitorWatch();
      
      if (state.monitorDirectoryPaths.length === 0) {
        monitorBaselines.clear();
        monitorLastSnapshotAt.clear();
        monitorPendingEntriesByDirectory.clear();
        monitorDirectoryBookmarks.clear();
      } else if (!state.autoMonitorConvertEnabled) {
        // 자동 감지 끔 -> 기존 Pending 목록과 뱃지를 초기화 (수동 '대상 찾기' 모드로 전환)
        monitorPendingEntriesByDirectory.clear();
        state.monitorDirectoryPaths.forEach(p => monitorPendingEntriesByDirectory.set(p, []));
      }
      
      recomputeMonitorPendingState();
      updateMonitorLabels();
      return;
    }

    const watchedPaths = state.monitorDirectoryPaths.filter((path) => monitorBaselines.has(path));
    if (watchedPaths.length === 0) {
      await window.desktopBridge.stopMonitorWatch();
      recomputeMonitorPendingState();
      updateMonitorLabels();
      scheduleMonitorSnapshotCheck(Math.min(MONITOR_START_DELAY_MS, 1000));
      return;
    }

    await ensureMonitorWatchListeners();

    if (notify) {
      appendStatusLog("저장된 기준 스냅샷을 기준으로 자동 모니터링 감지를 시작합니다.", "idle");
    }
    setMonitorProgressMessage("모니터링 감지 준비 중...");
    await window.desktopBridge.startMonitorWatch(watchedPaths);

    for (const path of watchedPaths) {
      await recalculateMonitorPendingForPath(path, false);
    }
    void scheduleAutoMonitorConvertIfNeeded();
    scheduleMonitorSnapshotCheck();
  } catch (error) {
    success = false;
    const message = withMonitorPermissionGuidance(getErrorMessage(error, "모니터링 폴더 초기화에 실패했습니다."));
    errorMessage = message;
    const shouldResetDirectory =
      message.includes("모니터링 폴더 확인 실패") ||
      message.includes("모니터링 대상은 폴더여야 합니다.") ||
      message.includes("No such file") ||
      message.includes("not found");

    if (shouldResetDirectory) {
      const previousPaths = [...state.monitorDirectoryPaths];
      state.monitorDirectoryPaths = [];
      monitorBaselines.clear();
      monitorLastSnapshotAt.clear();
      monitorPendingEntriesByDirectory.clear();
      monitorDirectoryBookmarks.clear();
      recomputeMonitorPendingState();
      schedulePersistMonitorState();
      updateMonitorLabels();
      appendStatusLog(
        previousPaths.length > 0
          ? `저장된 모니터링 디렉토리를 열 수 없어 모두 해제했습니다. 원인: ${message}`
          : `모니터링 폴더 초기화에 실패했습니다. 원인: ${message}`,
        "error"
      );
      return;
    }

    recomputeMonitorPendingState();
    updateMonitorLabels();
    appendStatusLog(`모니터링 폴더 초기화에 실패했습니다. 원인: ${message}`, "error");
  } finally {
    endMonitorBackgroundTask(success, errorMessage);
  }
}

function startMonitorPollingInBackground(notify = true) {
  void startMonitorPolling(notify);
}

function scheduleInitialMonitorPolling(notify = true) {
  stopMonitorPolling();
  updateMonitorLabels();
  monitorStartTimerId = window.setTimeout(() => {
    monitorStartTimerId = 0;
    void startMonitorPolling(notify);
  }, MONITOR_START_DELAY_MS);
}

async function chooseMonitorDirectory() {
  if (state.busy) {
    return;
  }
  const selected = await window.desktopBridge.pickMonitorDirectory();
  if (!selected?.path) {
    return;
  }
  if (state.monitorDirectoryPaths.includes(selected.path)) {
    appendStatusLog("이미 모니터링 목록에 있는 디렉토리입니다.", "idle");
    return;
  }
  state.monitorDirectoryPaths = [...state.monitorDirectoryPaths, selected.path];
  if (selected.bookmarkData) {
    monitorDirectoryBookmarks.set(selected.path, selected.bookmarkData);
  }
  monitorPendingEntriesByDirectory.set(selected.path, []);
  await persistMonitorStateSafely();
  updateMonitorLabels();
  appendStatusLog(`${toCompactPath(selected.path)} 모니터링 디렉토리를 추가했습니다. 첫 기준 스냅샷을 생성합니다...`, "idle");
  showCopyToast("모니터링 추가", [toCompactPath(selected.path)]);
  
  // 모니터링 폴더를 추가하면 즉시 스냅샷을 생성하여 대상 찾기나 자동 감지가 동작할 수 있는 기준을 만듭니다.
  void refreshMonitorBaselineForPath(selected.path, "새 모니터링 디렉토리 등록", true);
  
  // 자동 감지가 켜져 있다면 Watcher를 켜기 위해 Initial Polling 스케줄링
  if (state.autoMonitorConvertEnabled) {
    scheduleInitialMonitorPolling(true);
  }
}

function clearMonitorDirectory() {
  if (state.busy) {
    return;
  }
  stopMonitorPolling();
  state.monitorDirectoryPaths = [];
  monitorBaselines.clear();
  monitorLastSnapshotAt.clear();
  monitorPendingEntriesByDirectory.clear();
  monitorDirectoryBookmarks.clear();
  recomputeMonitorPendingState();
  checkMonitorStatusLog();
  void persistMonitorStateSafely();
  updateMonitorLabels();
  appendStatusLog("모니터링 디렉토리를 모두 해제했습니다.", "idle");
  showCopyToast("모니터링 해제", ["모든 모니터링 디렉토리"]);
}

async function removeMonitorDirectory(path: string) {
  if (state.busy) {
    return;
  }
  stopMonitorPolling();
  state.monitorDirectoryPaths = state.monitorDirectoryPaths.filter((value) => value !== path);
  monitorBaselines.delete(path);
  monitorLastSnapshotAt.delete(path);
  monitorPendingEntriesByDirectory.delete(path);
  monitorDirectoryBookmarks.delete(path);
  recomputeMonitorPendingState();
  await persistMonitorStateSafely();
  updateMonitorLabels();
  appendStatusLog(`${toCompactPath(path)} 모니터링을 해제했습니다.`, "idle");
  showCopyToast("모니터링 해제", [toCompactPath(path)]);
  if (state.monitorDirectoryPaths.some((value) => monitorBaselines.has(value))) {
    scheduleInitialMonitorPolling(false);
  } else {
    scheduleMonitorSnapshotCheck(500);
  }
}

async function applyPendingMonitorChanges() {
  if (state.monitorDirectoryPaths.length === 0) {
    setStatus("검색할 모니터링 대상 디렉토리가 없습니다.", "error");
    return;
  }

  const hasAnyBaseline = state.monitorDirectoryPaths.some((path) => monitorBaselines.has(path));
  if (!hasAnyBaseline) {
    setStatus("스냅샷 기준이 없습니다. 모니터링 디렉토리를 추가해 기준 스냅샷을 준비해 주세요.", "error");
    return;
  }

  setBusy(true);
  setBeforeListLoadingOverlay(true, "변환 대상을 찾는 중입니다...");

  try {
    const pendingPaths = Array.from(state.monitorPendingPaths);
    let { pathsToEnqueue, excludedPaths } = await filterAlreadyHandledMonitorPendingPaths(pendingPaths);

    if (pathsToEnqueue.length > 0) {
      appendStatusLog("자동 감지된 대기열이 있어 전체 스캔을 건너뛰고 즉시 수집합니다.", "idle");
    } else {
      appendStatusLog("스냅샷 기준으로 변환 대상을 다시 검색합니다.", "idle");
      for (const path of state.monitorDirectoryPaths) {
        if (!monitorBaselines.has(path)) {
          continue;
        }
        await recalculateMonitorPendingForPath(path, false);
      }

      recomputeMonitorPendingState();
      updateMonitorLabels();

      const newPendingPaths = Array.from(state.monitorPendingPaths);
      const newResult = await filterAlreadyHandledMonitorPendingPaths(newPendingPaths);
      pathsToEnqueue = newResult.pathsToEnqueue;
      excludedPaths = newResult.excludedPaths;
    }

    if (excludedPaths.length > 0) {
      clearMonitorPendingEntriesByPaths(excludedPaths);
      appendStatusLog(
        `변환 대상 검색: 이미 처리된 ${excludedPaths.length}개 항목은 제외했습니다.`,
        "idle"
      );
    }

    if (pathsToEnqueue.length > 0) {
      appendStatusLog(`변환 대상 검색 완료: ${pathsToEnqueue.length}개를 원본 파일 목록에 추가합니다.`, "success");
      await enqueuePaths(pathsToEnqueue, true, true);
    } else {
      appendStatusLog("변환 대상 검색 완료: 새로 추가할 항목이 없습니다.", "success");
    }
  } catch (error) {
    const message = getErrorMessage(error, "변환 대상 검색 중 오류 발생");
    appendStatusLog(message, "error");
  } finally {
    setMonitorProgressMessage("");
    setBeforeListLoadingOverlay(false);
    setBusy(false);
  }
}

async function enqueuePaths(filePaths: string[], nfdOnly = false, shallow = false) {
  if (filePaths.length === 0) {
    setStatus("파일 경로를 읽지 못했습니다. Finder에서 실제 파일을 드롭해 주세요.", "error");
    return;
  }

  const addedDuringInspect = new Set<string>();
  const excludePaths = [
    ...state.beforeItems.map((item) => item.sourcePath),
    ...state.results.map((item) => item.outputPath)
  ];

  setBusy(true);
  setBeforeListLoadingOverlay(true, "파일 목록 추가중... (파일 0개)");
  setStatus("폴더/파일 목록을 분석 중입니다...");
  let unsubscribeInspect: (() => void) | null = null;

  try {
    unsubscribeInspect = await window.desktopBridge.onInspectProgress((progress) => {
      scheduleInspectOverlay(progress.fileCount);
    });
    await waitNextPaint();
    
    let inspectedItems: BeforeItem[];
    let skippedCount = 0;
    
    if (shallow) {
      const items = await window.desktopBridge.inspectPathsShallow(filePaths);
      const excludeSet = new Set(excludePaths.map(p => normalizePathForCompare(p)));
      const filtered = items.filter(item => {
        const key = normalizePathForCompare(item.sourcePath);
        if (excludeSet.has(key)) {
          skippedCount++;
          return false;
        }
        return true;
      });
      inspectedItems = filtered.map(item => decorateBeforeItem(item));
    } else {
      const collected = await window.desktopBridge.daemonCollectTargets(filePaths, excludePaths);
      inspectedItems = collected.items.map((item) => decorateBeforeItem(item));
      skippedCount = Math.max(0, collected.skippedExistingCount + (collected.requestedCount - collected.inspectedCount));
    }
    
    const existing = new Set(state.beforeItems.map((item) => normalizePathForCompare(item.sourcePath)));
    for (const item of inspectedItems) {
      if (nfdOnly && !item.isNfdLike) {
        continue;
      }
      const compareKey = normalizePathForCompare(item.sourcePath);
      if (existing.has(compareKey)) {
        continue;
      }
      existing.add(compareKey);
      addedDuringInspect.add(item.sourcePath);
      state.beforeItems.push(item);
    }
    const addedCount = addedDuringInspect.size;
    if (addedCount === 0) {
      setStatus("이미 원본/변환 목록에 있는 항목입니다.", "idle");
      return;
    }
    recalculateFolderFileCounts();
    renderListsSync();
    window.requestAnimationFrame(() => {
      beforeList.scrollTop = beforeList.scrollHeight;
      updateScrollFadeState(beforeList);
    });

    const addedFolderCount = state.beforeItems.filter(
      (item) => addedDuringInspect.has(item.sourcePath) && item.isDirectory
    ).length;
    const addedFileCount = addedCount - addedFolderCount;
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

async function convertSourcePaths(sourcePaths: string[], isBackgroundAutoConvert = false) {
  if (state.busy) {
    return;
  }
  const uniqueSourcePaths = Array.from(new Set(sourcePaths.map((value) => value.trim()).filter((value) => value.length > 0)));
  if (uniqueSourcePaths.length === 0) {
    setStatus("변환할 파일이 없습니다.", "error");
    return;
  }
  let didRenderListInTry = false;

  try {
    setBusy(true);
    startProgressAnimation();
    setProgress(0, uniqueSourcePaths.length);
    setStatus(`${uniqueSourcePaths.length}개 항목을 변환 중입니다...`);
    const CONVERT_BATCH_SIZE = 50;
    const sortedSourcePaths = [...uniqueSourcePaths].sort((left, right) => {
      const leftDepth = left.split("/").filter((part) => part.length > 0).length;
      const rightDepth = right.split("/").filter((part) => part.length > 0).length;
      return rightDepth - leftDepth;
    });

    const requestedCount = sortedSourcePaths.length;
    let uniqueCount = 0;
    let processedCount = 0;
    const finalResults: NormalizeResult[] = [];
    const beforeListCountBefore = state.beforeItems.length;
    const afterListCountBefore = state.results.length;

    for (let offset = 0; offset < sortedSourcePaths.length; offset += CONVERT_BATCH_SIZE) {
      const batchPaths = sortedSourcePaths.slice(offset, offset + CONVERT_BATCH_SIZE);
      if (batchPaths.length === 0) {
        continue;
      }

      const converted = await window.desktopBridge.daemonConvertTargets(batchPaths);
      const batchResults = converted.results.map((item) =>
        decorateNormalizeResult(item, isBackgroundAutoConvert)
      );
      finalResults.push(...batchResults);
      appendAfterItems(batchResults);

      const batchConvertedSourcePathSet = new Set(batchResults.map((item) => item.sourcePath));
      const batchConvertedDirectoryPaths = new Set(
        state.beforeItems
          .filter((item) => item.isDirectory && batchConvertedSourcePathSet.has(item.sourcePath))
          .map((item) => item.sourcePath)
      );

      state.beforeItems = state.beforeItems.filter((item) => {
        if (batchConvertedSourcePathSet.has(item.sourcePath)) {
          return false;
        }
        for (const directoryPath of batchConvertedDirectoryPaths) {
          if (isPathInFolderTree(item.sourcePath, directoryPath)) {
            return false;
          }
        }
        return true;
      });

      state.selectedBeforePaths.forEach((sourcePath) => {
        if (batchConvertedSourcePathSet.has(sourcePath)) {
          state.selectedBeforePaths.delete(sourcePath);
          return;
        }
        for (const directoryPath of batchConvertedDirectoryPaths) {
          if (isPathInFolderTree(sourcePath, directoryPath)) {
            state.selectedBeforePaths.delete(sourcePath);
            return;
          }
        }
      });

      clearConvertedMonitorPendingEntries(batchConvertedSourcePathSet, batchConvertedDirectoryPaths);

      uniqueCount += converted.uniqueCount > 0 ? converted.uniqueCount : batchResults.length;
      processedCount = Math.min(requestedCount, processedCount + (converted.uniqueCount > 0 ? converted.uniqueCount : batchPaths.length));
      setProgress(processedCount, requestedCount);

      recalculateFolderFileCounts();
      state.selectedOutputPaths.clear();
      renderListsSync();
      didRenderListInTry = true;

      window.requestAnimationFrame(() => {
        afterList.scrollTop = afterList.scrollHeight;
        updateScrollFadeState(afterList);
      });

      if (isBackgroundAutoConvert && batchResults.length > 0) {
        updateTrayBackgroundBadge(trayBackgroundConvertedCount + batchResults.length);
        const historyEntries: AutoConvertHistoryEntry[] = batchResults.map((item) => ({
          timestamp: Date.now(),
          sourcePath: item.sourcePath,
          outputPath: item.outputPath,
          sourceName: item.sourceName,
          outputName: item.outputName,
          changed: item.changed,
          isDirectory: item.isDirectory,
          status: item.changed ? "변환됨" : "이미 NFC"
        }));
        try {
          autoConvertHistoryCount = await window.desktopBridge.appendAutoConvertHistory(historyEntries);
          updateAutoConvertHistoryBadge();
        } catch (error) {
          appendStatusLog(
            `자동 변환 내역 저장에 실패했습니다. 원인: ${getErrorMessage(error, "내역 저장 실패")}`,
            "error"
          );
        }
      }

      void batchResults;
    }

    const completedTotal = uniqueCount > 0 ? uniqueCount : uniqueSourcePaths.length;
    setProgress(completedTotal, completedTotal);
    const changedCount = finalResults.filter((item) => item.changed).length;
    const beforeRemovedCount = beforeListCountBefore - state.beforeItems.length;
    const afterAddedCount = state.results.length - afterListCountBefore;
    const requestedSummary =
      requestedCount !== uniqueCount
        ? `${requestedCount}개 요청(${uniqueCount}개 중복 제외)`
        : `${uniqueCount}개`;
    setStatus(
      `${requestedSummary} 기준으로 ${finalResults.length}개 결과를 처리했습니다. before ${beforeRemovedCount}개 제거, after ${afterAddedCount}개 추가. ${changedCount}개는 NFD에서 NFC로 변경되었습니다.`,
      "success"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    setStatus(message, "error");
  } finally {
    hideProgress();
    setBusy(false);
    if (!didRenderListInTry) {
      renderListsSync();
    }
  }
}

async function refreshMonitorStateAfterConversion(monitorPaths: string[]) {
  beginMonitorBackgroundTask();
  let success = true;
  let errorMessage = "";
  try {
    for (const path of monitorPaths) {
      if (!state.monitorDirectoryPaths.includes(path)) {
        continue;
      }
      setMonitorProgressMessage(`변환 후 스냅샷 재계산 중: ${toCompactPath(path)}`);
      await recalculateMonitorPendingForPath(path, false);
      
      // 변환이 완료된 후 해당 폴더의 pending 항목이 0개가 되었다면 스냅샷을 갱신합니다.
      const pendingEntries = monitorPendingEntriesByDirectory.get(path) ?? [];
      if (pendingEntries.length === 0) {
        monitorLastSnapshotAt.set(path, Date.now());
        schedulePersistMonitorState();
        updateMonitorLabels();
      }
    }
    if (state.monitorPendingPaths.size === 0) {
      appendStatusLog("모니터링 감지 항목이 모두 NFC로 정리되어 스냅샷 시간을 갱신했습니다.", "success");
    } else {
      appendStatusLog("모니터링 감지 항목이 남아 있어 기존 스냅샷 시간을 유지합니다.", "idle");
    }
  } catch (error) {
    success = false;
    errorMessage = withMonitorPermissionGuidance(getErrorMessage(error, "모니터링 상태 재계산에 실패했습니다."));
    appendStatusLog(`모니터링 상태 재계산에 실패했습니다. 원인: ${errorMessage}`, "error");
  } finally {
    endMonitorBackgroundTask(success, errorMessage);
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
  const sourcePaths = state.beforeItems.map((item) => item.sourcePath);
  if (sourcePaths.length === 0) {
    setStatus("원본 파일 목록에 항목이 없습니다.", "idle");
    return;
  }
  await convertSourcePaths(sourcePaths);
}

function clearConvertedMonitorPendingEntries(
  convertedSourcePathSet: Set<string>,
  convertedDirectoryPaths: Set<string>
) {
  if (monitorPendingEntriesByDirectory.size === 0) {
    return;
  }

  let changed = false;
  for (const [path, entries] of monitorPendingEntriesByDirectory.entries()) {
    const nextEntries = entries.filter((entry) => {
      if (convertedSourcePathSet.has(entry.path)) {
        return false;
      }
      for (const directoryPath of convertedDirectoryPaths) {
        if (isPathInFolderTree(entry.path, directoryPath)) {
          return false;
        }
      }
      return true;
    });

    if (nextEntries.length !== entries.length) {
      monitorPendingEntriesByDirectory.set(path, nextEntries);
      changed = true;
    }
  }

  if (changed) {
    recomputeMonitorPendingState();
    updateMonitorLabels();
    schedulePersistMonitorState();
  }
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
  resultIndexBySourcePath.clear();
  resultIndexByOutputPath.clear();
  state.selectedOutputPaths.clear();
  renderListsSync();
  
  // before 리스트가 비워졌으므로 모니터 감지 버튼(apply) 상태를 업데이트하여 활성화합니다.
  updateMonitorLabels();
  
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

beforeList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const removeButton = target?.closest<HTMLButtonElement>(".before-remove-button");
  if (removeButton) {
    event.preventDefault();
    event.stopPropagation();
    if (state.busy) {
      return;
    }
    const indexText = removeButton.dataset.beforeIndex;
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
      state.beforeItems = state.beforeItems.filter((item) => !isPathInFolderTree(item.sourcePath, targetItem.sourcePath));
      recalculateFolderFileCounts();
      renderListsSync();
      
      updateMonitorLabels();
      setStatus("폴더와 하위 파일 항목을 함께 삭제했습니다.", "success");
      return;
    }
    state.selectedBeforePaths.delete(targetItem.sourcePath);
    state.beforeItems.splice(targetIndex, 1);
    recalculateFolderFileCounts();
    renderListsSync();

    updateMonitorLabels();
    setStatus("원본 파일 목록 항목 1개를 삭제했습니다.", "success");
    return;
  }

  const card = target?.closest<HTMLElement>(".before-card");
  if (!card) {
    return;
  }
  const sourcePath = card.dataset.sourcePath;
  if (!sourcePath) {
    return;
  }
  const mouseEvent = event as MouseEvent;
  toggleOrSelectBeforePath(sourcePath, mouseEvent.metaKey || mouseEvent.ctrlKey);
  refreshBeforeSelectionVisuals();
});

beforeList.addEventListener("dblclick", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".before-remove-button")) {
    return;
  }
  const card = target?.closest<HTMLElement>(".before-card");
  const sourcePath = card?.dataset.sourcePath;
  if (!sourcePath) {
    return;
  }
  void window.desktopBridge.openItem(sourcePath).catch((error) => {
    const message = error instanceof Error ? error.message : "항목을 열지 못했습니다.";
    setStatus(message, "error");
  });
});

afterList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const card = target?.closest<HTMLElement>(".after-card");
  const outputPath = card?.dataset.outputPath;
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

afterList.addEventListener("dblclick", (event) => {
  const target = event.target as HTMLElement | null;
  const card = target?.closest<HTMLElement>(".after-card");
  const outputPath = card?.dataset.outputPath;
  if (!outputPath) {
    return;
  }
  void window.desktopBridge.openItem(outputPath).catch((error) => {
    const message = error instanceof Error ? error.message : "항목을 열지 못했습니다.";
    setStatus(message, "error");
  });
});

afterList.addEventListener("dragstart", (event) => {
  const dragEvent = event as DragEvent;
  const target = dragEvent.target as HTMLElement | null;
  const card = target?.closest<HTMLElement>(".after-card");
  const outputPath = card?.dataset.outputPath;
  if (!outputPath) {
    return;
  }

  dragEvent.preventDefault();
  if (!state.selectedOutputPaths.has(outputPath)) {
    const changedPaths = Array.from(state.selectedOutputPaths);
    state.selectedOutputPaths.clear();
    state.selectedOutputPaths.add(outputPath);
    changedPaths.push(outputPath);
    refreshAfterSelectionByPaths(changedPaths);
  }

  state.afterInternalDragActive = true;
  const dragPaths = getSelectedAfterDragPaths();
  void window.desktopBridge.startFileDrag(dragPaths).catch((error) => {
    const message = error instanceof Error ? error.message : "파일 드래그 시작에 실패했습니다.";
    setStatus(message, "error");
  });
});

afterList.addEventListener("dragend", () => {
  state.afterInternalDragActive = false;
});

centerConvertButton.addEventListener("click", () => {
  void convertAllBeforeConvertibleItems();
});

centerRefreshButton.addEventListener("click", () => {
  clearAllItems();
});

monitorDirectoryPickButton.addEventListener("click", () => {
  void chooseMonitorDirectory();
});

monitorApplyButton.addEventListener("click", () => {
  void applyPendingMonitorChanges();
});

monitorDirectoryClearButton.addEventListener("click", () => {
  const selectedPath = monitorDirectoryList.value;
  if (!selectedPath) {
    clearMonitorDirectory();
    return;
  }
  void removeMonitorDirectory(selectedPath);
});

beforeFilterToggleButton.addEventListener("click", () => {
  state.beforeNfdOnly = !state.beforeNfdOnly;
  renderListsSync();
});

themeToggleButton.addEventListener("click", () => {
  applyTheme(!state.darkMode, true);
});

launchAtLoginToggle.addEventListener("change", () => {
  const nextEnabled = launchAtLoginToggle.checked;
  launchAtLoginToggle.disabled = true;
  void window.desktopBridge
    .setLaunchAtLoginEnabled(nextEnabled)
    .then(() => {
      state.launchAtLoginEnabled = nextEnabled;
      appendStatusLog(
        nextEnabled ? "로그인시 자동 실행을 켰습니다." : "로그인시 자동 실행을 껐습니다.",
        "success"
      );
      showCopyToast("설정 변경", [nextEnabled ? "로그인시 자동 실행: ON" : "로그인시 자동 실행: OFF"]);
    })
    .catch((error) => {
      launchAtLoginToggle.checked = state.launchAtLoginEnabled;
      const errorMessage = getErrorMessage(error, "설정 변경 실패");
      appendStatusLog(
        `로그인시 자동 실행 설정에 실패했습니다. 원인: ${errorMessage}`,
        "error"
      );
      showCopyToast("설정 변경 실패", [`로그인시 자동 실행: ${errorMessage}`]);
    })
    .finally(() => {
      syncAutomationSettingControls();
    });
});

autoMonitorConvertToggle.addEventListener("change", () => {
  state.autoMonitorConvertEnabled = autoMonitorConvertToggle.checked;
  persistAutoMonitorConvertEnabled(state.autoMonitorConvertEnabled);
  syncAutoConvertFilesUI();
  
  appendStatusLog(
    state.autoMonitorConvertEnabled ? "자동 감지를 켰습니다." : "자동 감지를 껐습니다.",
    "success"
  );
  showCopyToast("설정 변경", [state.autoMonitorConvertEnabled ? "백그라운드 자동 감지: ON" : "백그라운드 자동 감지: OFF"]);
  
  // 자동 감지 토글 변경 시 Watcher 폴링 상태도 동기화합니다.
  if (state.autoMonitorConvertEnabled) {
    scheduleInitialMonitorPolling(true);
  } else {
    stopMonitorPolling();
    // 감지가 꺼지면 기존 대기열을 초기화하고 버튼을 "대상 찾기" 로 전환합니다.
    monitorPendingEntriesByDirectory.clear();
    state.monitorDirectoryPaths.forEach(p => monitorPendingEntriesByDirectory.set(p, []));
    recomputeMonitorPendingState();
    updateMonitorLabels();
  }
});

autoConvertFilesToggle.addEventListener("change", () => {
  state.autoConvertFilesEnabled = autoConvertFilesToggle.checked;
  persistAutoConvertFilesEnabled(state.autoConvertFilesEnabled);
  
  appendStatusLog(
    state.autoConvertFilesEnabled ? "자동 변환을 켰습니다." : "자동 변환을 껐습니다.",
    "success"
  );
  showCopyToast("설정 변경", [state.autoConvertFilesEnabled ? "자동 변환: ON" : "자동 변환: OFF"]);
  
  // 자동 변환이 켜졌고 자동 감지도 켜져있다면, 현재 대기 중인 항목들을 즉시 변환 시도합니다.
  if (state.autoMonitorConvertEnabled && state.autoConvertFilesEnabled) {
    void (async () => {
      try {
        const pendingPaths = Array.from(state.monitorPendingPaths);
        if (pendingPaths.length > 0) {
          appendStatusLog(`자동 변환 켜짐: 대기 중인 ${pendingPaths.length}개 항목을 변환합니다.`, "idle");
          await convertSourcePaths(pendingPaths, true);
        }
      } catch (e) {
        appendStatusLog(`자동 변환 시작 중 오류: ${getErrorMessage(e, "알 수 없는 오류")}`, "error");
      }
    })();
  }
});

autoConvertHistoryButton.addEventListener("click", () => {
  void window.desktopBridge.openAutoConvertHistoryWindow().catch((error) => {
    setStatus(`자동 변환 내역 창을 열지 못했습니다. 원인: ${getErrorMessage(error, "창 열기 실패")}`, "error");
  });
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
  if (beforeScrollRafId === 0) {
    if (beforeList.dataset.virtualActive === "1") {
      showVirtualLoading("before");
    }
    beforeScrollRafId = window.requestAnimationFrame(() => {
      beforeScrollRafId = 0;
      if (beforeList.dataset.virtualActive === "1") {
        renderVirtualBeforeList(currentBeforeVisibleEntries);
        clearVirtualLoading("before");
      }
      updateScrollFadeState(beforeList);
    });
  }
  hideBeforeContextMenu();
});

afterList.addEventListener("scroll", () => {
  if (afterScrollRafId === 0) {
    if (afterList.dataset.virtualActive === "1") {
      showVirtualLoading("after");
    }
    afterScrollRafId = window.requestAnimationFrame(() => {
      afterScrollRafId = 0;
      if (afterList.dataset.virtualActive === "1") {
        renderVirtualAfterList(currentAfterVisibleItems);
        clearVirtualLoading("after");
      }
      updateScrollFadeState(afterList);
    });
  }
  hideAfterContextMenu();
});

window.addEventListener("resize", () => {
  if (beforeList.dataset.virtualActive === "1") {
    renderVirtualBeforeList(currentBeforeVisibleEntries);
  }
  if (afterList.dataset.virtualActive === "1") {
    renderVirtualAfterList(currentAfterVisibleItems);
  }
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
  refreshAfterSelectionVisuals();
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

window.addEventListener("beforeunload", () => {
  cancelPersistMonitorStateSchedule();
  terminateMonitorPendingWorker();
  stopMonitorPolling();
  if (monitorWatchEventUnsubscribe) {
    monitorWatchEventUnsubscribe();
    monitorWatchEventUnsubscribe = null;
  }
  if (monitorWatchErrorUnsubscribe) {
    monitorWatchErrorUnsubscribe();
    monitorWatchErrorUnsubscribe = null;
  }
  if (mainWindowVisibilityUnsubscribe) {
    mainWindowVisibilityUnsubscribe();
    mainWindowVisibilityUnsubscribe = null;
  }
  monitorWatchListenersReady = false;
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
  renderListsSync();
  updateMonitorLabels();
  setStatus(`원본 파일 목록 ${beforeCount}개를 전체 삭제했습니다.`, "success");
});

renderListsSync();
updateScrollFades();
initializeTheme();
initializeAutoMonitorConvertSetting();
syncAutomationSettingControls();
updateTrayBackgroundBadge(0);
void initializeLaunchAtLoginSetting();
setupSystemThemeWatcher();
appendStatusLog("앱이 준비되었습니다.");
window.setTimeout(() => {
  loadPretendardStylesheet();
}, 0);

window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      void setupTauriFileDrop();
      void initializeMonitoring();
    }, 200);
  });
});

async function initializeMonitoring() {
  updateMonitorLabels();
  try {
    state.monitorDirectoryPaths = await loadPersistedMonitorState();
    updateMonitorLabels();
    void scheduleAutoMonitorConvertIfNeeded();
    if (state.monitorDirectoryPaths.some((path) => monitorBaselines.has(path))) {
      scheduleInitialMonitorPolling(false);
    }
    scheduleMonitorSnapshotCheck(Math.min(MONITOR_START_DELAY_MS, 1000));
  } catch (error) {
    state.monitorDirectoryPaths = [];
    monitorBaselines.clear();
    monitorLastSnapshotAt.clear();
    monitorPendingEntriesByDirectory.clear();
    monitorDirectoryBookmarks.clear();
    recomputeMonitorPendingState();
    updateMonitorLabels();
    const message = withMonitorPermissionGuidance(getErrorMessage(error, "모니터링 상태를 복원하지 못했습니다."));
    appendStatusLog(`모니터링 상태 복원에 실패했습니다. 원인: ${message}`, "error");
  }
}

void window.desktopBridge.onMainWindowVisibility((visible) => {
  const previousVisible = state.mainWindowVisible;
  state.mainWindowVisible = visible;
  updateAutoConvertForegroundOverlay();
  if (previousVisible === visible) {
    return;
  }
  if (!state.autoMonitorConvertEnabled) {
    return;
  }

  if (visible) {
    updateTrayBackgroundBadge(0);
  }
}).then((unsubscribe) => {
  mainWindowVisibilityUnsubscribe = unsubscribe;
}).catch((error) => {
  appendStatusLog(
    `메인 창 상태 이벤트 등록에 실패했습니다. 원인: ${getErrorMessage(error, "창 상태 이벤트 실패")}`,
    "error"
  );
});

void window.desktopBridge
  .getAutoConvertHistoryCount()
  .then((count) => {
    autoConvertHistoryCount = count;
    updateAutoConvertHistoryBadge();
  })
  .catch((error) => {
    appendStatusLog(
      `자동 변환 내역 개수 조회에 실패했습니다. 원인: ${getErrorMessage(error, "개수 조회 실패")}`,
      "error"
    );
  });

void window.desktopBridge
  .onAutoConvertHistoryCount((count) => {
    autoConvertHistoryCount = count;
    updateAutoConvertHistoryBadge();
  })
  .catch((error) => {
    appendStatusLog(
      `자동 변환 내역 이벤트 등록 실패. 원인: ${getErrorMessage(error, "이벤트 등록 실패")}`,
      "error"
    );
  });

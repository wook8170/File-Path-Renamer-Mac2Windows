import "./styles.css";
import { desktopBridge, type AutoConvertHistoryEntry } from "./desktopBridge";
import { getErrorMessage, toWindowsPreviewBefore } from "./utils/path";
import heroArrowRight from "./icons/hero/arrow-right.svg?raw";

const THEME_STORAGE_KEY = "file-path-renamer-theme";
const AUTO_CONVERT_HISTORY_WARN_THRESHOLD = 1000;
let clearHistoryInFlight = false;

function getAppElement() {
  const appElement = document.querySelector<HTMLDivElement>("#app");
  if (!appElement) {
    throw new Error("App container not found.");
  }
  return appElement;
}

function formatTime(timestamp: number) {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
    d.getSeconds()
  ).padStart(2, "0")}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function compactPathMiddle(pathValue: string) {
  const normalized = pathValue.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((part) => part.length > 0);
  if (segments.length <= 4) {
    return normalized;
  }
  const head = normalized.startsWith("/") ? "/" : "";
  const first = segments[0];
  const second = segments[1];
  const last = segments[segments.length - 1];
  return `${head}${first}/${second}/.../${last}`;
}

function resolveTheme() {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") {
    return saved;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme() {
  const theme = resolveTheme();
  document.body.classList.toggle("theme-dark", theme === "dark");
}

async function confirmHistoryClear() {
  const message = "자동 변환 내역을 모두 초기화할까요?";
  try {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    return await confirm(message, {
      title: "내역 초기화",
      kind: "warning",
      okLabel: "초기화",
      cancelLabel: "취소"
    });
  } catch {
    const fallback = window.confirm(message);
    if (typeof (fallback as unknown as Promise<boolean>)?.then === "function") {
      return await (fallback as unknown as Promise<boolean>);
    }
    return Boolean(fallback);
  }
}

function render(entries: AutoConvertHistoryEntry[]) {
  const sortedEntries = entries
    .slice()
    .reverse()
    .map((entry, idx) => ({ entry, idx }));

  const rows = sortedEntries
    .map(({ entry, idx }) => {
      const statusTone = entry.changed
        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
        : "border-stone-300 bg-stone-100 text-stone-600";
      const sourceNamePreview = toWindowsPreviewBefore(entry.sourceName, entry.changed);
      const sourcePathPreview = toWindowsPreviewBefore(entry.sourcePath, entry.changed);
      const beforePathShort = compactPathMiddle(sourcePathPreview);
      const afterPathShort = compactPathMiddle(entry.outputPath);
      return `
        <article
          class="auto-history-row flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 transition hover:border-violet-300 hover:bg-violet-50/40"
          data-target-path="${escapeHtml(entry.outputPath)}"
          title="${escapeHtml(entry.outputPath)}"
        >
          <span class="inline-flex min-w-8 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-stone-500">
            ${sortedEntries.length - idx}
          </span>
          <span class="shrink-0 text-[11px] font-semibold tabular-nums text-stone-500">${formatTime(entry.timestamp)}</span>
          <div class="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr),28px,minmax(0,1fr)] items-center gap-2">
            <div class="min-w-0">
              <p class="truncate text-[12px] font-semibold text-stone-800" title="${escapeHtml(sourceNamePreview)}">${escapeHtml(sourceNamePreview)}</p>
              <p class="truncate text-[11px] text-stone-500" title="${escapeHtml(sourcePathPreview)}">${escapeHtml(beforePathShort)}</p>
            </div>
            <span class="inline-flex h-4 w-4 items-center justify-center text-violet-600" aria-hidden="true">
              ${heroArrowRight}
            </span>
            <div class="min-w-0">
              <p class="truncate text-[12px] font-semibold text-sky-700" title="${escapeHtml(entry.outputName)}">${escapeHtml(entry.outputName)}</p>
              <p class="truncate text-[11px] text-sky-600" title="${escapeHtml(entry.outputPath)}">${escapeHtml(afterPathShort)}</p>
            </div>
          </div>
          <span class="inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[10px] font-semibold ${statusTone}">
            ${entry.status}
          </span>
        </article>
      `;
    });
  const rowsHtml = rows.join("");
  const hasRows = rowsHtml.length > 0;

  const empty = `
    <div class="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 text-center text-sm text-stone-400">
      백그라운드 자동 변환 내역이 없습니다.
    </div>
  `;

  const overLimitNotice = entries.length > AUTO_CONVERT_HISTORY_WARN_THRESHOLD
    ? `
      <div class="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">
        내역이 ${entries.length.toLocaleString("en-US")}개로 1,000개를 초과했습니다. 성능/용량 보호를 위해 내역 초기화를 권장합니다.
      </div>
    `
    : "";

  return `
    <main id="auto-history-root" class="flex h-screen flex-col gap-3 overflow-hidden bg-stone-100 p-3 text-stone-900">
      <section id="auto-history-header" class="rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-soft backdrop-blur">
        <div class="mb-0 flex items-start justify-between gap-3">
          <div>
            <p class="text-[12px] font-semibold uppercase tracking-[0.18em] text-stone-400">History</p>
            <h1 id="auto-history-title" class="text-sm font-semibold text-stone-900">백그라운드 자동 변환 내역</h1>
            <p class="mt-0.5 text-[11px] text-stone-500">내역은 사용자가 초기화할 때까지 유지됩니다.</p>
          </div>
          <button
            id="clear-history"
            class="inline-flex h-9 items-center rounded-md border border-stone-300 bg-stone-50 px-3 text-[12px] font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            ${hasRows ? "" : "disabled"}
          >
            확인 및 초기화
          </button>
        </div>
        ${overLimitNotice}
      </section>
      <section id="auto-history-list-card" class="min-h-0 flex-1 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-soft">
        <div
          id="auto-history-list"
          class="${hasRows
            ? "scroll-fade grid h-full content-start auto-rows-max gap-1 overflow-y-auto pr-3 [scrollbar-gutter:stable]"
            : "scroll-fade h-full overflow-y-auto"}"
        >
          ${rowsHtml || empty}
        </div>
      </section>
    </main>
  `;
}

async function loadAndRender() {
  applyTheme();
  const appElement = getAppElement();
  const entries = await desktopBridge.loadAutoConvertHistory();
  appElement.innerHTML = render(entries);

  const clearButton = document.querySelector<HTMLButtonElement>("#clear-history");
  const historyList = document.querySelector<HTMLDivElement>("#auto-history-list");

  historyList?.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest<HTMLElement>(".auto-history-row");
    if (!row) {
      return;
    }
    const filePath = row.dataset.targetPath ?? "";
    if (!filePath) {
      return;
    }
    try {
      await desktopBridge.showItemInFolder(filePath);
    } catch (error) {
      alert(`Finder 열기에 실패했습니다: ${getErrorMessage(error, "열기 실패")}`);
    }
  });

  clearButton?.addEventListener("click", async () => {
    if (clearHistoryInFlight) {
      return;
    }
    const latestEntries = await desktopBridge.loadAutoConvertHistory();
    if (latestEntries.length === 0) {
      await loadAndRender();
      return;
    }
    const confirmed = await confirmHistoryClear();
    if (!confirmed) {
      return;
    }
    try {
      clearHistoryInFlight = true;
      if (clearButton) {
        clearButton.disabled = true;
      }
      await desktopBridge.clearAutoConvertHistory();
      await loadAndRender();
    } catch (error) {
      alert(`내역 초기화에 실패했습니다: ${getErrorMessage(error, "초기화 실패")}`);
    } finally {
      clearHistoryInFlight = false;
    }
  });
}

void loadAndRender().catch((error) => {
  applyTheme();
  const appElement = getAppElement();
  appElement.innerHTML = `
    <main class="flex h-screen items-center justify-center bg-stone-100 p-3">
      <p class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        자동 변환 내역을 불러오지 못했습니다: ${String(getErrorMessage(error, "조회 실패"))}
      </p>
    </main>
  `;
});

window.addEventListener("storage", (event) => {
  if (event.key === THEME_STORAGE_KEY) {
    applyTheme();
  }
});

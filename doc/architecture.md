# File-Path-Renamer Architecture

## Concept

macOS 에서 한글 파일 경로의 유니코드 정규화 문제(NFD vs NFC)를 해결하는 데스크톱 앱.
Tauri v2 (Rust backend + HTML/TS frontend) 기반이며, Finder 에서 드래그&드롭하거나
모니터링 폴더를 지정하여 "대상 찾기(수동 스캔)" 또는 "자동 감지(실시간 Watcher)" 모드로 백그라운드 변환/수집 워크플로를 제공한다.

## Source Tree

```
src/
  main.ts                  # 메인 창 — UI, 상태 관리, 모니터링, 변환 흐름 전체
  backgroundHistory.ts     # 히스토리 팝업 창 — 감지/변환 이력 조회, 수동 변환, 삭제
  desktopBridge.ts         # Tauri IPC 래퍼 — Rust 커맨드/이벤트를 TS 타입으로 노출
  types.ts                 # 공유 타입 — AppState, BeforeItem, NormalizeResult 등
  constants.ts             # 상수 — 디바운스, 스토리지 키, UI 임계값
  styles.css               # Tailwind + 커스텀 스타일
  utils/
    monitor.ts             # 모니터링 유틸 — baseline 구축, pending 계산, 변경 판정
    path.ts                # 경로 유틸 — 정규화, compact 표시, escape, 에러 메시지

src-tauri/
  src/lib.rs               # Rust — 파일 rename, 디렉토리 스캔, fs watcher, tray, 히스토리 파일 IO
  tauri.conf.json          # Tauri 빌드 설정
  capabilities/default.json # 권한 — 창, dialog, drag, autostart
  entitlements.plist       # macOS entitlements

background-history.html    # 히스토리 팝업 진입점
index.html                 # 메인 창 진입점
doc/
  architecture.md          # 이 문서
```

## Core Data Flow

### 1. 자동 감지 (Auto Detection) — "자동 감지" ON 일 때만 동작

```
"자동 감지" 토글 ON 
  → startMonitorWatch (Rust notify watcher 시작)
  → [OS fs event] → Rust notify watcher
  → emit "monitor-watch-event"
  → JS onMonitorWatchEvent listener (창 가시성 무관, 항상 수신)
  → scheduleMonitorWatchRefresh (debounce 220ms, remove 는 120ms)
  → runMonitorWatchRefresh
  → recalculateMonitorPendingForPath
    - incremental: scanMonitorPaths (변경 경로만)
    - full: scanMonitorDirectorySnapshot (전체 재스캔)
    - inspectPathsShallow (NFD 판정)
  → monitorPendingEntriesByDirectory 갱신
  → recomputeMonitorPendingState → state.monitorPendingPaths
  → updateMonitorLabels → "감지 항목 (N개)" 뱃지 + 메뉴바 tray count 활성화
  → scheduleAutoMonitorConvertIfNeeded → 히스토리에 pending 으로 무조건 수집
  → pruneDeletedHistoryEntries → 삭제된 파일은 히스토리에서도 정리
```

### 1-1. 수동 감지 (Manual Detection) — "자동 감지" OFF 일 때

```
"자동 감지" 토글 OFF
  → stopMonitorWatch (Rust notify watcher 종료)
  → monitorPendingEntriesByDirectory 초기화 및 뱃지 숨김
  → "대상 찾기" 버튼 활성화

사용자가 "대상 찾기" 버튼 클릭
  → applyPendingMonitorChanges (수동 스캔 로직 진입)
  → 등록된 모니터링 디렉토리(monitorDirectoryPaths) 순회하며 scanMonitorDirectorySnapshot
  → getMonitorCandidateEntries 로 새 스냅샷과 비교
  → inspectPathsShallow 로 NFD 판정
  → 발견된 항목을 강제로 scheduleAutoMonitorConvertIfNeeded 태워서 히스토리(pending)에 수집
  → enqueuePaths 로 Before 목록에 일괄 렌더링
```

### 2. 파일 삭제 감지

```
파일이 물리적으로 삭제됨
  → remove watch event
  → recalculateMonitorPendingForPath (incremental)
    - scanMonitorPaths → 삭제된 파일은 결과에 없음
    - nextBaseline 에서 해당 경로 소멸
    - retainedPendingEntries / candidateEntries 에서 자동 필터 아웃
  → monitorPendingEntriesByDirectory 에서 해당 항목 제거
  → "감지 항목" 뱃지 개수 자동 감소 + tray count 감소
  → pruneDeletedHistoryEntries
    - 히스토리의 pending 항목 중 monitorPendingPaths 에 없는 것 제거
    - saveBackgroundConvertHistory 로 디스크 반영
    - converted/failed 항목은 이력이므로 보존
```

### 3. 수동 변환 (Manual Conversion) — 메인 창

```
사용자가 "감지 항목" 버튼 클릭
  → applyPendingMonitorChanges → enqueuePaths
  → inspectSourceFiles (Rust)
  → state.beforeItems 에 추가 (왼쪽 원본 목록)
  → clearMonitorPendingEntriesByPaths → "감지 항목" 뱃지 비움
  → 사용자가 "변환" 버튼 클릭
  → convertSourcePaths → normalizeFileNames (Rust, 실제 rename)
  → 결과를 state.results 에 추가 (오른쪽 변환 목록)
  → 결과를 히스토리에 converted 상태로 기록 (appendBackgroundConvertHistory)
  → clearConvertedMonitorPendingEntries → pending 에서 제거
```

### 4. 수동 변환 — 히스토리 창

```
사용자가 히스토리 창 열기
  → loadBackgroundConvertHistory
  → 목록 렌더링 (pending / converted / failed 상태별)
  → "전체 변환" or "선택 변환" 클릭
  → normalizeFileNames (Rust)
  → saveBackgroundConvertHistory (상태 갱신)
  → "히스토리 삭제" 클릭
  → Tauri ask() 네이티브 확인 다이얼로그
  → clearBackgroundConvertHistory
```

### 5. 히스토리 수집 및 자동 변환 (History & Auto Convert)

```
[항상] 감지된 NFD 항목 존재 시 (자동 감지든 대상 찾기 스캔이든 무관)
  → scheduleAutoMonitorConvertIfNeeded 호출
  → loadBackgroundConvertHistory (기존 이력 dedupe 처리)
  → appendBackgroundConvertHistory (status: "pending" 으로 무조건 수집)

[추가] "자동 변환" 토글 ON 인 경우
  → 수집 직후 (pending 된 항목들 대상)
  → 즉시 convertSourcePaths (백그라운드에서 조용히 파일명 변환 시도)
  → 성공 시 "converted", 실패 시 "failed" 로 상태 업데이트
  → saveBackgroundConvertHistory (덮어쓰되 race condition 방지를 위해 Merge 수행)
```

## Key State Variables (main.ts)

| 변수 | 유형 | 역할 |
|---|---|---|
| `state.beforeItems` | `BeforeItem[]` | 왼쪽 원본 파일 목록 |
| `state.results` | `NormalizeResult[]` | 오른쪽 변환 결과 목록 |
| `state.monitorPendingPaths` | `Set<string>` | 감지된 NFD 경로 ("감지 항목" 뱃지 + tray count 소스) |
| `state.monitorDirectoryPaths` | `string[]` | 감시 폴더 경로 |
| `state.autoMonitorConvertEnabled` | `boolean` | 자동 감지(Watcher) 토글 상태 |
| `state.autoConvertFilesEnabled` | `boolean` | 자동 변환(수집 즉시 Rename 수행) 토글 상태 |
| `state.monitorAutoConvertRunning` | `boolean` | 자동 수집 진행 중 재진입 방지 |
| `state.mainWindowVisible` | `boolean` | 메인 창 가시성 (Accessory 전환 시 false) |
| `state.busy` | `boolean` | 변환/inspect 진행 중 |
| `monitorBaselines` | `Map<string, MonitorBaseline>` | 경로별 기준 스냅샷 |
| `monitorLastSnapshotAt` | `Map<string, number>` | 경로별 마지막 스냅샷 시각 |
| `monitorPendingEntriesByDirectory` | `Map<string, MonitorSnapshotEntry[]>` | 경로별 감지된 pending 항목 |
| `pruneDeletedHistoryRunning` | `boolean` | 히스토리 정리 재진입 방지 |

## Rust IPC Commands

| Command | 역할 |
|---|---|
| `normalize_file_names` | NFD → NFC rename 실행, 결과 반환 |
| `inspect_source_files` | 파일 경로 목록을 깊이 탐색, BeforeItem 반환 |
| `inspect_paths_shallow` | 얕은 NFD 판정 (changed 여부). 삭제된 파일은 `continue` 로 skip |
| `scan_monitor_directory` | 폴더 전체 스냅샷 |
| `scan_monitor_paths` | 특정 경로들만 부분 스캔. 존재하지 않는 경로는 skip |
| `start_monitor_watch` / `stop_monitor_watch` | fs watcher 시작/중지 |
| `load_monitor_state` / `save_monitor_state` | 모니터링 상태 영속화 |
| `load_background_convert_history` | 히스토리 읽기 |
| `append_background_convert_history` | 히스토리 추가 (내부에서 tray 업데이트) |
| `save_background_convert_history` | 히스토리 전체 덮어쓰기 (내부에서 tray 업데이트) |
| `clear_background_convert_history` | 히스토리 전체 삭제 |
| `set_tray_history_count` | 메뉴바 tray 카운트/툴팁 갱신 |
| `pick_monitor_directory` | 네이티브 폴더 선택 다이얼로그 (NSOpenPanel + 북마크) |

## Tauri Events (Rust → JS)

| Event | Payload | 용도 |
|---|---|---|
| `monitor-watch-event` | `{ roots, paths, kind }` | fs 변경 감지 (create/modify/remove) |
| `monitor-watch-error` | `string` | watcher 오류 |
| `main-window-visibility` | `boolean` | 창 숨김/표시 전이 |
| `open-background-history` | `()` | tray 메뉴에서 히스토리 창 열기 |
| `normalize-progress` | `{ processed, total }` | 변환 진행률 |
| `normalize-item` | `NormalizeResult` | 변환 결과 스트리밍 |
| `inspect-progress` | `{ fileCount }` | inspect 진행률 |
| `inspect-batch` | `BeforeItem[]` | inspect 결과 배치 |

**제거된 이벤트**: `background-history-count` — 과거 무한 echo 루프의 원인. Rust `update_tray_history_count` 에서 emit 삭제됨. JS 가 단일 진실 공급원.

## Persistence

| 파일 | 위치 | 내용 |
|---|---|---|
| `monitor-state.json` | `app_data_dir` | 모니터링 경로, 스냅샷, pending |
| `background-convert-history.json` | `app_data_dir` | 감지/변환 히스토리 (pending/converted/failed) |
| `localStorage` | WebView | 테마(`file-path-renamer-theme`), 자동 감지 토글(`file-path-renamer-auto-monitor-convert`) |

## UI Components

### 메인 창 (main.ts)

- **헤더 카드**: 앱 타이틀, "로그인시 자동 실행" 토글, "자동 감지" 토글, 히스토리 버튼(뱃지 없음, 항상 활성), 테마 토글
- **모니터링 카드**: 감시 폴더 드롭다운(h-9), "감지 항목" 버튼(+개수 뱃지), "모니터링 추가/해제" 버튼, 상태 로그, 진행 표시
- **원본 목록 (before)**: 드래그&드롭 / 파일 선택 / "감지 항목" 버튼으로 추가, 가상 리스트(300개 이상)
- **변환 결과 목록 (after)**: 변환된 파일, 클립보드 복사, 드래그 내보내기

### 히스토리 창 (backgroundHistory.ts)

- **헤더**: 타이틀(메인 창 카드와 동일 스타일), 요약(text-[11px]), 버튼(h-9 font-medium)
- **버튼**: 전체 선택, 선택 변환, 전체 변환, 히스토리 삭제(rose 색상, Tauri ask() 확인)
- **목록**: 항목별 체크박스, 번호, 감지/변환 시각, 원본→변환 경로, 상태 뱃지(대기/완료/실패)

## macOS Integration

- **Tray icon**: 메뉴바 상주, 좌클릭으로 창 열기, 메뉴(창 열기/변환 파일 보기/종료)
- **Tray count**: `state.monitorPendingPaths.size` — `updateMonitorLabels` 에서 `setTrayHistoryCount` 호출
- **Activation Policy**: 창 닫기(X/Cmd+W) 시 `Accessory` (Dock 에서 사라짐), 열기 시 `Regular`
- **Dock icon**: `refresh_macos_dock_icon()` 로 `Accessory → Regular` 전환 시 번들 아이콘 명시 주입
- **Security scopes**: `NSOpenPanel` 북마크로 외장 볼륨 접근 권한 유지

## Known Design Decisions

1. **자동 감지와 자동 변환의 분리** — "자동 감지"는 백그라운드 Watcher 켜기/끄기를 담당하고, 감지된 파일은 무조건 히스토리에 수집됨. "자동 변환"은 이 옵션에 종속되어 켜져 있을 때만 수집 직후 백그라운드에서 조용히 파일명 Rename 수행.
2. **"대상 찾기" 수동 스캔 모드** — 자동 감지(Watcher)가 꺼져있을 때, 배터리 및 리소스 절약을 위해 이벤트 리스너를 내리고 메인 창의 "감지 항목" 버튼이 "대상 찾기" 버튼으로 바뀜. 사용자가 수동으로 스캔(전체 디렉토리 탐색)을 지시하도록 설계.
3. **감지는 창 가시성 무관** — Watcher가 켜져있다면, 포/백그라운드 모두 이벤트를 처리하며 가시성(visibility) 가드 없이 수집 및 변환 로직이 돌아감.
4. **대기열(Pending) 보호 가드** — "감지 항목/대상 찾기"로 Before 목록에 담았다고 해서 바로 Pending 상태를 지우지 않음. (실제 변환 성공 시점에만 삭제). 단, 모든 Pending 항목이 이미 Before 목록에 들어가면 중복 클릭을 방지하기 위해 버튼은 비활성화(Disabled)됨.
5. **삭제된 파일 자동 정리** — remove 워치 이벤트 시 `recalculateMonitorPendingForPath` 에서 pending 제거 + `pruneDeletedHistoryEntries` 에서 히스토리 pending 항목도 정리. converted/failed 이력은 보존.
6. **동시성(Race Condition) 병합** — 백그라운드에서 감지와 수동 변환이 동시에 겹치는 것을 막기 위해 `saveBackgroundConvertHistory` 직전에 디스크 최신 상태를 읽고 메모리와 `Map` 병합(Merge) 후 저장하여 새 파일 이력 유실 방지.
7. **히스토리 버튼과 가상 리스트** — 1000개 이상의 히스토리, 원본 리스트에서도 브라우저가 죽지 않도록 모든 목록 렌더링에 `Virtual Scrolling` 및 `Event Delegation`이 자체 구현되어 있음.
8. **Rust echo emit 제거** — `update_tray_history_count` 에서 `app.emit("background-history-count")` 삭제. 무한 루프 방지. 오직 JS 만이 `Single Source of Truth`를 가짐.

## Guard / Race Protection

| 보호 대상 | 메커니즘 |
|---|---|
| `scheduleAutoMonitorConvertIfNeeded` 재진입 | `state.monitorAutoConvertRunning` flag |
| `runMonitorWatchRefresh` 동일 root 재진입 | `monitorWatchRefreshRunningRoots` Set |
| `runMonitorWatchRefresh` 중 auto-convert 충돌 | `state.monitorAutoConvertRunning` 체크 → reschedule |
| `pruneDeletedHistoryEntries` 재진입 | `pruneDeletedHistoryRunning` flag |
| 워치 이벤트 burst | `scheduleMonitorWatchRefresh` 디바운스 (modify 220ms, create/remove 120ms) |
| tray count 무한 루프 | Rust `update_tray_history_count` 에서 JS 로의 echo emit 완전 제거 |

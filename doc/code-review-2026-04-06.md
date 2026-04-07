# File-Path-Renamer 코드 리뷰 (2026-04-06)

## 범위
- 프론트엔드: `src/main.ts`, `src/backgroundHistory.ts`, `src/desktopBridge.ts`, `src/utils/*`, `src/constants.ts`, `src/types.ts`
- 백엔드(Tauri/Rust): `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`

## 결론 요약
- 최근 변경 이후, **히스토리/카운트 동기화 흐름**과 **모니터링/스냅샷 흐름**에서 개념 충돌이 일부 남아 있습니다.
- 즉시 수정이 필요한 High 이슈가 존재합니다.
- 교착(Deadlock) 징후는 확인하지 못했지만, **livelock에 가까운 재시도 루프**와 **고비용 루프**는 존재합니다.

---

## 주요 이슈 (심각도 순)

### 1) High - 백그라운드 변환 히스토리 버튼 카운트/뱃지 로직이 사실상 비활성
- 증상:
  - 히스토리 버튼이 항상 활성화되고, 뱃지는 항상 숨김 처리됩니다.
  - 사용자는 “개수가 왔다 갔다 한다” 또는 “카운트가 안 맞는다”로 체감할 수 있습니다.
- 근거:
  - `updateBackgroundHistoryButton()`에서 `disabled=false` 고정, 뱃지 `hidden` 강제: `src/main.ts:743-748`
  - 초기화도 실제 히스토리 로드 없이 동일 함수만 호출: `src/main.ts:756-758`
- 영향:
  - UI가 실제 상태를 반영하지 못함.
  - 메뉴바 카운트/버튼 카운트 개념이 분리되어 UX 혼란.

### 2) High - 히스토리 저장 병합 로직이 상태 외 필드 변경을 유실
- 증상:
  - 메모리상의 엔트리 변경이 디스크 병합에서 누락될 수 있습니다.
- 근거:
  - 병합 조건이 `status` 변화만 반영:
    - `if (!diskEntry || memEntry.status !== diskEntry.status) diskMap.set(...)`
    - `src/backgroundHistory.ts:284-289`
- 영향:
  - 같은 상태 내 필드(`outputPath`, `outputName`, `convertedAt`, `errorMessage`) 갱신이 저장 누락될 가능성.
  - “변환됐는데 표시가 안 바뀜”, “에러메시지가 이전 값으로 남음” 형태로 나타날 수 있음.

### 3) High - Rust 측 `save_background_convert_history`가 모든 converted 경로를 매번 재방출
- 증상:
  - 히스토리 저장 시점마다 누적된 converted 전부가 다시 emit 됩니다.
  - 프론트는 이를 “새 변환”으로 오해해 before 목록을 과삭제할 수 있습니다.
- 근거:
  - `entries.iter().filter(status=="converted")` 전체 emit: `src-tauri/src/lib.rs:861-869`
  - 프론트 수신 시 before 제거 처리: `src/main.ts:2722-2761`
- 영향:
  - 반복 저장/재열기 시 before 목록이 예상보다 더 줄어드는 부작용 가능.

### 4) High - 스냅샷 생성 함수의 오버레이 해제 보장이 약함 (특히 fire-and-forget 호출)
- 증상:
  - 오류 시 오버레이(회색/로딩)가 남아 UI가 멈춘 것처럼 보일 수 있습니다.
- 근거:
  - `refreshMonitorBaselineForPath()`가 내부 `finally` 없이 직접 `setAppLoadingOverlay(true/false)`:
    - `src/main.ts:2391-2404`
  - `chooseMonitorDirectory()`에서 `void refreshMonitorBaselineForPath(...)`로 비동기 fire-and-forget:
    - `src/main.ts:2887`
- 영향:
  - 예외 전파 시 언밸런스 상태 가능.
  - 사용자 체감: “흰 화면 + macOS 스피너 계속 도는 느낌”.

### 5) High - 자동 감지 OFF 상태와 자동 수집 함수 책임 경계가 불명확
- 증상:
  - `scheduleAutoMonitorConvertIfNeeded()`가 `autoMonitorConvertEnabled`를 선행 조건으로 체크하지 않습니다.
- 근거:
  - 가드에 `autoMonitorConvertEnabled` 없음: `src/main.ts:794-800`
  - 함수 내부에서 히스토리 append 수행: `src/main.ts:823-853`
- 영향:
  - 기능 토글 의미가 흐려지고, 수동 검색 로직에서 임시 토글 트릭(`state.autoMonitorConvertEnabled = true`)이 섞여 개념적으로 취약:
    - `src/main.ts:2974-2977`

---

## 중간 이슈

### 6) Medium - 렌더 함수가 상태 로직/로그 로직까지 수행 (부수효과 과다)
- 근거:
  - `renderLists()` 내부에서 `updateMonitorLabels()` 호출: `src/main.ts:2285`
  - `updateMonitorLabels()`는 로그 append까지 수행: `src/main.ts:1418-1421`
- 영향:
  - 렌더링 빈도 증가 시 불필요한 상태/로그 처리 동반.
  - 디버깅 난이도 상승, 성능 추적 어려움.

### 7) Medium - 가상 리스트 스크롤 시 매 프레임 `innerHTML` 전체 교체
- 근거:
  - 스크롤 rAF마다 가상 리스트 전체 DOM 재생성:
    - before: `src/main.ts:3875-3885`, `1882-1898`
    - after: `src/main.ts:3892-3901`, `1900-1924`
- 영향:
  - 고속 스크롤 시 빈 화면/깜빡임 가능.
  - 대규모 리스트(수천 건)에서 CPU/GPU 부하 증가.

### 8) Medium - 후보 검사 O(n²) 경향
- 근거:
  - `candidateEntries.filter` 내부에서 `inspectResults.some` 반복:
    - `src/main.ts:2491-2499`
- 영향:
  - 변경 후보가 큰 경우 급격히 느려짐.

### 9) Medium - watch 이벤트 중 busy/autoConvertRunning 시 재스케줄 반복 (livelock성)
- 근거:
  - 실행 중이면 다시 `scheduleMonitorWatchRefresh`:
    - `src/main.ts:2634-2646`, `2662-2666`
- 영향:
  - 장시간 busy 시 타이머 재등록이 누적적으로 이어져 체감 버벅임 가능.

### 10) Medium - 디렉토리 변경 이벤트에서 하위 신생 파일 누락 가능성
- 근거:
  - 부분 스캔에서 디렉토리일 때 children 미포함 (`include_children=false`):
    - `src-tauri/src/lib.rs:737`
- 영향:
  - 파일시스템/스토리지 타입에 따라 “새 파일 감지가 안 됨” 재현 가능.

---

## 낮은 우선순위/정리 이슈

### 11) Low - 브리지에 사용되지 않는 이벤트 계약 잔존
- 근거:
  - `onBackgroundHistoryCount` 정의되어 있으나 메인에서 구독 안 함:
    - `src/desktopBridge.ts:121,367-374`
- 영향:
  - 유지보수 시 혼동.

### 12) Low - 버튼 라벨 의미 불일치 (닫기 vs 삭제)
- 근거:
  - `history-close` 버튼 텍스트는 “히스토리 삭제”, 동작도 삭제:
    - `src/backgroundHistory.ts:57-62,401-430`
- 영향:
  - 사용자 기대(닫기)와 실제 동작(전체삭제) 불일치 가능.

---

## 데드락/무한루프 관점 점검 결과

### 데드락
- Rust mutex 사용부(BookmarkStore, MonitorWatchState)에서 즉시 해제 패턴이며, 동일 mutex 중첩 잠금 경로는 명확히 보이지 않았습니다.
- 현재 검토 범위에서는 **전형적 deadlock 징후는 미발견**.

### 무한루프
- 명시적 무한 루프(`while true`)는 없음.
- 다만 다음은 **무한 재시도에 가까운 상태**를 만들 수 있습니다:
  - monitor watch refresh 재스케줄 루프 (`busy`/`monitorAutoConvertRunning` 지속 시): `src/main.ts:2634-2646`, `2670-2695`

---

## 시스템 부하 관점 핵심 포인트

1. 대규모 렌더링 시 가상 리스트의 full DOM 재생성 비용 큼 (`innerHTML` 치환 방식).
2. 모니터링 스냅샷 생성은 디렉토리 전체 재귀 + 정렬 비용이 큼:
   - `collect_monitor_snapshot_entries`: `src-tauri/src/lib.rs:621-663`
3. 스냅샷/pending 계산 시 inspect shallow + 후보 필터의 비효율(O(n²))이 존재.

---

## 권장 수정 순서 (실행 우선순위)

1. **히스토리 카운트 단일 진실원 확정**
   - 버튼/뱃지/메뉴바 카운트의 소스 하나로 통일.
2. **히스토리 병합 로직 수정**
   - status 외 필드 변경도 반영.
3. **converted 이벤트 델타 전송으로 변경**
   - save 시 “이번에 바뀐 항목”만 emit.
4. **스냅샷 오버레이 안전화**
   - `refreshMonitorBaselineForPath`에 `try/finally`로 overlay 보장 해제.
5. **가상리스트 렌더 최적화**
   - row 재사용(키드 DOM 재배치) 또는 DocumentFragment 기반 부분 갱신.
6. **watch 부분 스캔 보강**
   - 디렉토리 이벤트 시 shallow + 필요한 경우 하위 재귀 fallback.

---

## 검토 메모
- 이번 리뷰는 정적 코드 분석 기반입니다.
- 런타임 재현(대용량 폴더, 외장 SSD, OneDrive 등) 시나리오 테스트를 병행하면 재현성 높은 개선 우선순위를 더 정확히 잡을 수 있습니다.

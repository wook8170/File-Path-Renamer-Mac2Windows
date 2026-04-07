# Gaea AI Pro+ 코드 및 아키텍처 분석 보고서

**작성일:** 2026년 4월 7일

## 1. 프로젝트 개요 및 현재 구조

Gaea AI Pro+ 프로젝트는 데스크톱 환경에서 동작하는 애플리케이션으로, 다음과 같은 기술 스택과 구조를 가지고 있습니다.

*   **프론트엔드 스택:** Vite, TypeScript, HTML/CSS (바닐라 기반 또는 경량 프레임워크 사용 추정)
*   **백엔드/데스크톱 스택:** Tauri, Rust
*   **주요 특징:**
    *   현재 프론트엔드의 주요 비즈니스 로직과 UI 렌더링 로직이 `src/main.ts` 파일에 집중되어 있는 **Monolithic(단일 파일) 구조**를 띠고 있습니다.
    *   Tauri를 통해 Rust 백엔드와 통신하며 파일 시스템 접근 및 데스크톱 네이티브 기능을 수행합니다.

## 2. 식별된 주요 문제점 및 원인 분석

현재 아키텍처 및 코드베이스에서 다음과 같은 주요 문제점들이 식별되었습니다.

1.  **가상 스크롤 렌더링 병목 (Virtual Scroll Rendering Bottleneck):**
    *   대량의 데이터(1000개 이상)를 화면에 표시할 때 스크롤 프레임마다 `innerHTML` 전체를 재할당하여 DOM을 교체하고 있어, 스크롤 버벅임(징크) 현상 등 렌더링 성능 저하가 발생합니다.
2.  **렌더링과 상태 로직의 강한 결합 (Tight Coupling):**
    *   `main.ts` 내의 `renderLists` 등 UI 렌더링 함수가 `updateMonitorLabels` 등 상태 변경과 무관한 시점에서도 반복 호출되고, 그 과정에서 상태 로그를 누적하는 부수 효과(side-effect)를 일으킵니다.
3.  **비동기 예외 처리 누락 (Missing Async Exception Handling):**
    *   주요 비동기 흐름인 `recalculateMonitorPendingForPath` 등에서 로딩 오버레이 렌더링을 시작(`setAppLoadingOverlay(true)`)한 뒤, 통신이나 처리 에러가 날 경우 `finally` 구문 부재로 락(Lock)을 풀지 않아 앱이 멈춘 것처럼 보일 수 있습니다.
4.  **O(n²) 알고리즘 복잡도 (Algorithm Complexity):**
    *   `src/utils/monitor.ts`의 `collapseMonitorPendingEntries` 등에서 상위/하위 디렉토리 포함 여부를 판별하기 위해 배열의 `some()`을 중첩 루프 구조로 사용하여, 감지 대상 경로가 커질수록 기하급수적 성능 저하가 일어납니다.
5.  **히스토리 동기화 비효율성 (History Sync Inefficiency):**
    *   이전 버전 코드에서 히스토리 상태 갱신이 비효율적이던 구조는 현재 어느 정도 단방향(Append Only)로 개선되었으나, 잦은 이벤트 전송을 유발할 수 있는 구조적 델타 최적화 여부가 남아 있습니다.
6.  **디렉토리 감지 누락 위험 (Directory Watch Missing Risk):**
    *   Rust 단의 폴더 부분 스캔(`scan_monitor_paths_sync`)이 하위 디렉토리를 무시(`include_children=false`)하도록 되어 있어, 폴더 생성/변경 이벤트 발생 시 내부에 포함된 NFD 파일을 누락하는 중대 결함이 존재합니다. 이를 피하기 위해 JS 단에서 증분 스캔 로직을 끄고 전체 폴더를 매번 풀스캔하여 성능 낭비를 유발하고 있습니다.

## 3. 구체적인 개선 방안 및 계획

식별된 문제점들을 해결하고 Gaea AI Pro+의 성능과 안정성을 높이기 위해 다음과 같이 개선을 진행합니다.

1.  **가상 스크롤 최적화 (Virtual Scroll Optimization):**
    *   `main.ts`의 가상 리스트 렌더링 로직에서, 화면에 보이는 뷰포트 인덱스 범위(`startIndex`, `endIndex`)와 상태 변경 세대(`renderGeneration` 등)를 캐싱 키로 활용하여 내용 변화나 뷰포트 이동이 있을 때만 DOM을 교체하도록 수정합니다.
2.  **모듈 및 상태 렌더링 로직 분리 (Separation of Concerns):**
    *   화면을 갱신하는 렌더링 로직(`renderLists`)과, 메시지를 판단하고 로깅을 추가하는 상태 업데이트 로직(`updateMonitorLabels`) 간 불필요한 결합을 끊고 의도된 상태 변화 시에만 부수 효과가 동작하게 제어합니다.
3.  **비동기 예외 처리 및 오버레이 안전성 확보:**
    *   모든 로딩 오버레이 렌더링을 수반하는 비동기 함수에 `try-finally` 블록을 의무적으로 적용해, 예외(Exception) 발생 상황에서도 UI 락을 안전하게 풀 수 있도록 방어합니다.
4.  **O(N²) -> O(N) 알고리즘 복잡도 완화:**
    *   `collapseMonitorPendingEntries` 등 중복 검사 로직을 수정합니다. 경로 문자열을 알파벳순 정렬(O(n log n))하면 자식 파일이 부모 폴더 바로 뒤에 연달아 위치하므로, 단일 루프(O(n))만으로 상/하위 경로를 걷어내는 효율적 알고리즘으로 대체합니다.
5.  **이벤트 델타 전송 및 동기화 (Event Delta Transmission):**
    *   히스토리 저장 등에서 전체 목록 동기화가 아닌 최소한의 증분(Delta) 데이터만 송수신하도록 IPC 메시지를 단순화 및 관리합니다.
6.  **디렉토리 Watcher 보강 (증분 스캔 복원):**
    *   Rust 백엔드 `scan_monitor_paths_sync`에서 폴더일 경우 `include_children=true`로 스캔하도록 변경하여 하위 파일 누락을 완벽히 방지합니다.
    *   이를 기반으로, 프론트엔드 `main.ts`의 `recalculateMonitorPendingForPath`에서 전체 풀스캔 방식을 제거하고, 이벤트로 수신된 변경 경로(`changedPaths`)만 검사하여 기존 상태 배열과 부분 병합하는 **고속 증분 스캔 로직**으로 복원합니다.

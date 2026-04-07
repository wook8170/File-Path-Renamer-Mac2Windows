# File-Path-Renamer

macOS에서 로컬로 실행되는 Tauri 기반 유틸리티입니다.  
Finder에서 파일이나 폴더를 추가하면 파일명 경로의 Unicode 정규화 상태를 검사하고, `NFD` 경로를 `NFC` 경로로 바꿔 Outlook, Windows 환경, 외부 협업 전달 시 발생하는 한글 자소 분리 문제를 줄이는 목적의 앱입니다.

이 프로젝트는 단순 변환기이면서 동시에 다음 역할을 함께 수행합니다.

- 원본 파일/폴더의 정규화 상태 검사
- `NFD -> NFC` 일괄 변환
- 변환 결과 목록 관리
- 파일/경로 클립보드 복사
- 모니터링 디렉토리 감지
- 수동 스냅샷 생성 및 이후 변경 감지

## 1. 프로젝트 목표

macOS에서는 파일명 경로가 내부적으로 `NFD` 형태로 저장되는 경우가 있고, 이 파일이 Windows, Outlook, 일부 외부 시스템으로 전달될 때 한글이 `ᄒ ᅡ ᆫ ᄀ ᅳ ᆯ`처럼 자소 분리되어 보일 수 있습니다.

이 앱은 다음 문제를 해결하기 위해 만들어졌습니다.

- macOS에서 정상처럼 보이는 파일명이 Windows/Outlook에서는 깨져 보이는 문제
- 폴더 단위로 대량 파일을 검사하고 변환해야 하는 번거로움
- 변환 결과를 다시 첨부/복사하는 흐름의 불편함
- 특정 작업 폴더를 계속 지켜보다가 새로 생긴 `NFD` 항목만 골라내고 싶은 요구

## 2. 주요 기능

### 파일/폴더 추가

- Finder 드래그 앤 드롭
- 파일 선택 다이얼로그
- 폴더 선택 및 재귀 탐색

폴더를 추가하면 하위 폴더/파일을 재귀적으로 수집합니다.

### NFD/NFC 검사

- 각 파일/폴더 경로의 정규화 상태를 검사
- `NFD` 계열 항목은 before 목록에서 Windows에서 깨져 보이는 형태를 미리보기로 표시
- `NFC` 항목은 정상 이름으로 표시

### 파일명 변환

- before 목록에 쌓인 항목을 기준으로 변환
- 파일뿐 아니라 폴더 경로도 필요 시 함께 변환
- 변환 결과는 after 목록에 누적

### 결과 활용

- after 목록 다중 선택
- 파일 복사
- 경로 복사
- Finder/Outlook 흐름에 맞춘 후속 사용

### 모니터링 디렉토리

- 사용자가 지정한 디렉토리를 등록
- 수동으로 기준 스냅샷 생성
- 이후 watcher 기반으로 변경 감지
- 감지된 항목이 있으면 `감지 항목 발견` 버튼으로 before 목록에 반영

### 자동 동작 옵션

- 로그인 시 자동 실행
- 백그라운드 자동 감지 변환

## 3. 현재 동작 방식

### before / after 흐름

1. 사용자가 파일/폴더를 before 영역에 추가
2. Rust 백엔드가 경로를 검사해서 `BeforeItem` 목록을 반환
3. 프론트엔드는 이를 before 목록으로 렌더
4. 변환 실행 시 Rust가 실제 경로 rename 수행
5. 결과는 after 목록에 `NormalizeResult`로 반영
6. before에서는 변환이 끝난 항목을 제거

### NFD 표시 방식

before 목록에서 `NFD` 상태 항목은 Windows에서 깨져 보이는 느낌을 보여주기 위해 완전히 원문을 그대로 쓰지 않고, 경량화된 preview 문자열을 사용합니다.

이 preview는 스크롤 성능을 고려해 렌더 시점이 아니라 수집 시점에 계산됩니다.

### 모니터링 방식

이전의 주기적 전체 폴링 중심 구조에서 watcher 기반으로 바뀌었습니다.

현재 흐름은 다음과 같습니다.

1. 모니터링 디렉토리 등록
2. 사용자가 `스냅샷 생성` 버튼으로 기준 스냅샷 생성
3. Rust watcher가 해당 디렉토리 변경 이벤트를 수신
4. 변경된 루트 경로만 다시 얕게 검사
5. 실제로 `NFD` 경로인 항목만 pending으로 유지
6. `감지 항목 발견` 버튼으로 before에 반영

즉, 기준 스냅샷 생성은 수동이고, 생성 이후 변경 감지는 자동입니다.

## 4. 기술 스택

### Frontend

- TypeScript
- Vite
- Tailwind CSS
- Pretendard

### Desktop / Backend

- Tauri 2
- Rust
- `notify` 기반 파일 watcher
- Tauri plugin autostart
- Tauri plugin dialog

## 5. 소스 구조

현재 구조는 “프론트 UI 조립”, “공통 타입/상수”, “순수 유틸”, “Rust 브리지”, “Rust 백엔드”로 나뉘어 있습니다.

### 프론트엔드

#### [src/main.ts](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src/main.ts)

앱의 메인 진입점입니다.

주요 역할:

- 전체 DOM 조립
- 앱 상태 관리
- before/after 렌더링
- 드래그 앤 드롭 처리
- 파일 변환 흐름 제어
- 모니터링 UI 및 watcher 이벤트 반영
- 토글, 컨텍스트 메뉴, 클립보드, 테마 등 UI 이벤트 바인딩

현재 가장 많은 UI 로직이 이 파일에 있습니다.

#### [src/desktopBridge.ts](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src/desktopBridge.ts)

Tauri / Rust 커맨드와 프론트엔드 사이의 브리지 계층입니다.

주요 역할:

- Rust command invoke 래핑
- Tauri event listen/unlisten 래핑
- 파일 선택/디렉토리 선택
- 모니터링 상태 로드/저장
- 자동실행 플러그인 접근
- 파일 드래그 시작

UI는 몰라도 되지만, 데스크톱 기능을 호출하는 전용 통로 역할을 합니다.

#### [src/types.ts](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src/types.ts)

프론트엔드에서 사용하는 앱 상태와 화면용 타입을 정의합니다.

예:

- `AppState`
- `BeforeItem`
- `NormalizeResult`
- `MonitorDirectoryInfo`
- `MonitorBaseline`

#### [src/constants.ts](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src/constants.ts)

UI와 동작에 쓰는 상수를 모아둔 파일입니다.

예:

- watcher 디바운스 시간
- 모니터링 시작 지연 시간
- 가상 리스트 row height / overscan
- 테마/설정 storage key
- 공통 리스트 클래스

#### [src/utils/path.ts](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src/utils/path.ts)

경로/문자열 관련 순수 함수 모음입니다.

예:

- compact path 생성
- HTML escape
- 경로 비교 정규화
- 스냅샷 시간 포맷
- 폴더 트리 포함 여부 판정
- 모니터링 권한 가이드 문구 생성

#### [src/utils/monitor.ts](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src/utils/monitor.ts)

모니터링 스냅샷 / pending 후보 계산 관련 순수 함수 모음입니다.

예:

- baseline 구성
- pending 항목 collapse
- 감지 후보 계산

#### [src/styles.css](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src/styles.css)

Tailwind 기반 스타일 파일입니다.

주요 역할:

- 라이트/다크 모드 테마
- 카드/리스트 스타일
- 스크롤 페이드
- 상태등 blink
- 다크모드 오버라이드

### Rust / Tauri

#### [src-tauri/src/lib.rs](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src-tauri/src/lib.rs)

핵심 백엔드 로직이 들어 있는 파일입니다.

주요 역할:

- 파일명 정규화 검사
- 실제 파일/폴더 rename
- shallow inspect / full inspect
- 모니터링 디렉토리 스냅샷 생성
- watcher 시작/정지
- 모니터링 상태 파일 저장/로드
- macOS bookmark / 권한 관련 처리
- 클립보드 파일/경로 복사

#### [src-tauri/src/main.rs](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src-tauri/src/main.rs)

Tauri 앱 엔트리 포인트입니다.

#### [src-tauri/tauri.conf.json](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src-tauri/tauri.conf.json)

앱 번들, 윈도우 크기, 식별자, 빌드 설정 등 Tauri 설정입니다.

#### [src-tauri/capabilities/default.json](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src-tauri/capabilities/default.json)

Tauri capability 권한 설정입니다.

예:

- autostart 관련 권한
- command 접근 제어

#### [src-tauri/entitlements.plist](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src-tauri/entitlements.plist)

macOS 보안 범위 북마크 및 앱 권한 관련 설정입니다.

## 6. 데이터 흐름 요약

### 파일 추가

`Finder / 버튼`  
→ `desktopBridge.inspectSourceFiles()`  
→ `Rust inspect_source_files`  
→ `BeforeItem[]`  
→ `state.beforeItems`  
→ before 렌더

### 파일 변환

`변환 버튼`  
→ `desktopBridge.normalizeFileNames()`  
→ `Rust normalize_file_names`  
→ 실제 rename 수행  
→ progress/item 이벤트 emit  
→ `NormalizeResult[]`  
→ after 렌더 + before 정리

### 모니터링

`모니터링 추가`  
→ `pickMonitorDirectory()`  
→ 상태 저장  
→ `스냅샷 생성`  
→ baseline 생성  
→ `startMonitorWatch()`  
→ watcher event  
→ affected path shallow inspect  
→ pending 유지  
→ `감지 항목 발견` 버튼 활성화

## 7. UI 구성

현재 앱 화면은 크게 4개 카드로 구성됩니다.

1. 상단 헤더 카드
- 앱 이름
- 로그인 시 자동 실행
- 백그라운드 자동 감지 변환
- 테마 버튼

2. 모니터링 카드
- 모니터링 디렉토리 상태
- watcher 상태등
- 등록된 디렉토리 드롭다운
- 감지 항목 발견 / 모니터링 추가 / 모니터링 해제 / 스냅샷 생성
- 상태 로그
- 모니터링 상세 상태 문구

3. before / after 영역
- before: 원본 목록
- after: 변환 결과 목록
- 중앙: 변환 / 전체 초기화 버튼

4. 변환 프로그레스 카드
- 파일 변환 진행률 전용

## 8. 성능 관련 설계

파일 수가 많아질 수 있기 때문에 몇 가지 성능 최적화가 들어 있습니다.

### 가상 리스트

before/after 목록은 일정 개수 이상에서 virtual list 방식으로 렌더합니다.

- 임계값: [src/constants.ts](/Volumes/WorkSpace/0200_Dev/Ootlook-rename/src/constants.ts)
- `VIRTUAL_LIST_THRESHOLD`
- `VIRTUAL_ROW_HEIGHT`
- `VIRTUAL_OVERSCAN`

### 렌더용 메타 선계산

NFD preview 문자열, compact path 등은 렌더 시 계산하지 않고 수집 시점에 계산합니다.

### watcher 기반 감지

기존 폴링 기반보다 리소스를 덜 쓰도록 watcher 중심으로 바뀌었습니다.

## 9. 모니터링/스냅샷 설계 메모

현재 스냅샷은 “자동 생성”이 아니라 “사용자 수동 생성”입니다.

이유:

- 큰 디렉토리 기준 자동 스캔은 초기 체감을 나쁘게 만들 수 있음
- 외장 SSD / OneDrive / CloudStorage는 권한/응답속도 이슈가 큼
- 사용자가 기준 시점을 명확하게 결정하도록 하는 편이 더 안전함

기준 스냅샷이 있어야 watcher 감지 결과를 의미 있게 비교할 수 있습니다.

## 10. 실행 방법

### 사전 준비

- Node.js
- npm
- Rust / Cargo
- Tauri CLI 동작 가능한 macOS 환경

### 개발 실행

```bash
npm install
npm run dev
```

웹 UI만 확인하려면:

```bash
npm run dev:web
```

## 11. 빌드

웹 번들만 빌드:

```bash
npm run build:web
```

macOS 앱/패키지 빌드:

```bash
npm run tauri:build
```

## 12. 산출물 위치

일반적으로 Tauri 배포 산출물은 아래 경로에 생성됩니다.

- 앱 번들:
  - `src-tauri/target/release/bundle/macos/File-Path-Renamer.app`
- DMG:
  - `src-tauri/target/release/bundle/dmg/File-Path-Renamer_0.1.0_aarch64.dmg`

## 13. 사용 시나리오 예시

### 시나리오 1. Outlook 첨부 직전 파일명 정리

1. Finder에서 파일들을 before 영역으로 드래그합니다.
2. before 목록에서 `NFD` 상태 항목을 확인합니다.
3. 가운데 변환 버튼으로 일괄 변환합니다.
4. after 목록에서 결과를 선택하고 경로 복사 또는 파일 복사를 사용합니다.

이 시나리오는 메일 첨부 직전 가장 많이 사용하는 흐름입니다.

### 시나리오 2. 프로젝트 폴더 지속 모니터링

1. `모니터링 추가`로 작업 디렉토리를 등록합니다.
2. `스냅샷 생성`으로 기준 시점을 만듭니다.
3. 이후 watcher가 생성/이름 변경 이벤트를 감지합니다.
4. 변환이 필요한 `NFD` 항목이 생기면 `감지 항목 발견` 버튼이 활성화됩니다.
5. 버튼으로 before 목록에 반영한 뒤 필요할 때 변환합니다.

반복적으로 외부 파일이 들어오는 협업 폴더에 적합합니다.

### 시나리오 3. 폴더 단위 대량 정리

1. 상위 폴더를 before 영역에 추가합니다.
2. 하위 폴더/파일이 재귀적으로 수집됩니다.
3. `NFD만 보기`로 변환 대상만 좁혀 확인합니다.
4. 전체 변환 후 after 목록에서 결과를 점검합니다.

대량 정리, 납품 전 정리, 오래된 자료 폴더 정비에 적합합니다.

## 14. 스크린샷 가이드

현재 README에는 실제 이미지 파일이 포함되어 있지 않습니다.  
문서에 스크린샷을 추가할 경우 아래 조합을 추천합니다.

- 메인 화면 전체
- before / after 비교 화면
- 모니터링 디렉토리 + 감지 항목 발견 상태
- 다크 모드 화면
- 대량 파일 변환 진행 화면

예시 마크다운:

```md
## 스크린샷

![메인 화면](docs/screenshots/main.png)
![모니터링 상태](docs/screenshots/monitoring.png)
![다크 모드](docs/screenshots/dark-mode.png)
```

## 15. 권한 / macOS 관련 주의사항

### 외장 SSD / OneDrive / CloudStorage

다음 경로는 일반 로컬 경로보다 민감할 수 있습니다.

- 외장 SSD
- `~/Library/CloudStorage/...`
- OneDrive / File Provider 경로

이 프로젝트는 bookmark 기반 접근을 사용하지만, 그래도 다음 상황은 주의가 필요합니다.

- 예전 저장 경로를 다시 쓸 때 bookmark 없음
- macOS 권한이 아직 열리지 않은 상태
- 클라우드 placeholder 파일
- 마운트 해제된 외장 볼륨

문제가 있을 때는 보통 다음 순서가 안전합니다.

1. 기존 모니터링 경로 해제
2. Finder에서 실제 폴더 열기
3. 앱에서 다시 모니터링 추가
4. 스냅샷 생성

## 16. 현재 알려진 설계 포인트

- `src/main.ts`에 아직 UI/상태/이벤트 흐름이 많이 모여 있음
- 추가 리팩토링 후보:
  - before/after 렌더러 분리
  - 모니터링 서비스 분리
  - DOM refs / UI factory 분리
- 메뉴바 상주 앱, Dock 숨김, 명시적 종료 정책은 추후 확장 대상

## 17. 앞으로 확장하기 좋은 영역

- 메뉴바 상주 앱
- Dock 비노출 모드
- watcher 상태의 시스템 알림 연동
- 자동 변환 정책 세분화
- 모니터링 경로별 설정
- 실패 항목 별도 큐 관리

---

이 README는 현재 소스 구조와 실제 동작 기준으로 작성되었습니다.  
구조가 더 분리되면 `src/main.ts` 중심 설명도 추가로 세분화하는 것이 좋습니다.

# File-Path-Renamer

macOS에서 로컬로 실행하는 Tauri 앱입니다. Finder에서 파일/폴더를 드래그하거나 직접 선택하면 파일명을 NFD/NFC 상태 기준으로 점검하고 NFC로 변환합니다.

## Stack

- Tauri
- Rust
- TypeScript
- Vite

## Features

- 파일/폴더 추가(폴더는 재귀 탐색)
- NFD -> NFC 파일명 변환
- 변환 결과 목록 선택 후 경로/파일 클립보드 복사

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run tauri:build
```

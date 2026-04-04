use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use arboard::Clipboard;
#[cfg(target_os = "macos")]
use cocoa::appkit::NSPasteboard;
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};
#[cfg(target_os = "macos")]
use cocoa::foundation::NSString;
use serde::Serialize;
use tauri::Emitter;
use unicode_normalization::UnicodeNormalization;

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NormalizeResult {
    source_path: String,
    output_path: String,
    source_name: String,
    output_name: String,
    source_normalization: String,
    changed: bool,
    collision_resolved: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NormalizeProgress {
    processed: usize,
    total: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InspectProgress {
    file_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SourceInspectResult {
    source_path: String,
    source_name: String,
    source_normalization: String,
    changed: bool,
    is_directory: bool,
    folder_file_count: usize,
    parent_folder_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardCopyResult {
    copied_count: usize,
    mode: String,
    reason: Option<String>,
    requested_count: usize,
    missing_count: usize,
    missing_paths: Vec<String>,
    error_code: Option<String>,
    error_message: Option<String>,
}

fn normalize_type(source_name: &str) -> String {
    let nfc_name: String = source_name.nfc().collect();
    let nfd_name: String = source_name.nfd().collect();
    let is_nfc = source_name == nfc_name;
    let is_nfd = source_name == nfd_name;
    if is_nfc && is_nfd {
        "BOTH".to_string()
    } else if is_nfc {
        "NFC".to_string()
    } else if is_nfd {
        "NFD".to_string()
    } else {
        "MIXED".to_string()
    }
}

fn metadata_key(metadata: &fs::Metadata) -> (u64, u64) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (metadata.dev(), metadata.ino())
    }
    #[cfg(not(unix))]
    {
        (0, metadata.len())
    }
}

struct DiskNameResolver {
    dir_entry_name_cache: HashMap<PathBuf, HashMap<(u64, u64), String>>,
}

impl DiskNameResolver {
    fn new() -> Self {
        Self {
            dir_entry_name_cache: HashMap::new(),
        }
    }

    fn resolve(&mut self, source_path: &Path) -> String {
        resolve_disk_base_name(source_path, &mut self.dir_entry_name_cache)
    }
}

fn resolve_disk_base_name(
    source_path: &Path,
    dir_entry_name_cache: &mut HashMap<PathBuf, HashMap<(u64, u64), String>>,
) -> String {
    let fallback = source_path
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_default();
    let dir = source_path.parent().unwrap_or_else(|| Path::new("/"));
    let target_meta = match fs::metadata(source_path) {
        Ok(v) => v,
        Err(_) => return fallback,
    };
    let target_key = metadata_key(&target_meta);

    if !dir_entry_name_cache.contains_key(dir) {
        let entries = match fs::read_dir(dir) {
            Ok(v) => v,
            Err(_) => return fallback,
        };
        let mut name_map = HashMap::<(u64, u64), String>::new();
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                name_map.insert(metadata_key(&meta), entry.file_name().to_string_lossy().to_string());
            }
        }
        dir_entry_name_cache.insert(dir.to_path_buf(), name_map);
    }

    if let Some(name_map) = dir_entry_name_cache.get(dir) {
        if let Some(found) = name_map.get(&target_key) {
            return found.clone();
        }
    }

    fallback
}

fn ensure_unique_path(target_path: &Path, source_path: Option<&Path>) -> (PathBuf, bool) {
    if !target_path.exists() {
        return (target_path.to_path_buf(), false);
    }

    let stem = target_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = target_path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let parent = target_path.parent().unwrap_or_else(|| Path::new("/"));

    let source_key = source_path
        .and_then(|s| fs::metadata(s).ok())
        .map(|m| metadata_key(&m));

    if let (Some(sk), Ok(target_meta)) = (source_key, fs::metadata(target_path)) {
        if metadata_key(&target_meta) == sk {
            return (target_path.to_path_buf(), false);
        }
    }

    let mut counter = 1;
    loop {
        let candidate = parent.join(format!("{stem}-{counter}{ext}"));
        if !candidate.exists() {
            return (candidate, true);
        }
        if let (Some(sk), Ok(cm)) = (source_key, fs::metadata(&candidate)) {
            if metadata_key(&cm) == sk {
                return (candidate, false);
            }
        }
        counter += 1;
    }
}

fn emit_progress(app: &tauri::AppHandle, processed: usize, total: usize) {
    let _ = app.emit(
        "normalize-progress",
        NormalizeProgress { processed, total },
    );
}

fn emit_item(app: &tauri::AppHandle, item: &NormalizeResult) {
    let _ = app.emit("normalize-item", item);
}

fn emit_inspect_batch(app: &tauri::AppHandle, batch: &[SourceInspectResult]) {
    if batch.is_empty() {
        return;
    }
    let _ = app.emit("inspect-batch", batch);
}

const INSPECT_BATCH_SIZE: usize = 220;
const INSPECT_PROGRESS_COUNT_STEP: usize = 50;
const INSPECT_PROGRESS_INTERVAL: Duration = Duration::from_millis(500);

fn emit_inspect_progress_if_needed(
    app: &tauri::AppHandle,
    discovered_count: usize,
    last_emitted_count: &mut usize,
    last_emitted_at: &mut Instant,
) {
    if discovered_count == 0 {
        let _ = app.emit("inspect-progress", InspectProgress { file_count: 0 });
        *last_emitted_count = 0;
        *last_emitted_at = Instant::now();
        return;
    }

    let count_delta = discovered_count.saturating_sub(*last_emitted_count);
    let time_elapsed = last_emitted_at.elapsed();
    if count_delta < INSPECT_PROGRESS_COUNT_STEP && time_elapsed < INSPECT_PROGRESS_INTERVAL {
        return;
    }

    let _ = app.emit("inspect-progress", InspectProgress { file_count: discovered_count });
    *last_emitted_count = discovered_count;
    *last_emitted_at = Instant::now();
}

fn should_emit_dense(progress: usize, total: usize) -> bool {
    if progress == 0 || progress >= total {
        return true;
    }
    if total <= 120 {
        return true;
    }
    progress % 5 == 0
}

fn normalize_file_names_sync(app: &tauri::AppHandle, file_paths: &[String]) -> Result<Vec<NormalizeResult>, String> {
    if file_paths.is_empty() {
        return Ok(vec![]);
    }
    let mut results: Vec<NormalizeResult> = Vec::with_capacity(file_paths.len());
    emit_progress(app, 0, file_paths.len());

    let mut sorted_paths: Vec<PathBuf> = file_paths.iter().map(PathBuf::from).collect();
    sorted_paths.sort_by(|a, b| {
        let depth_a = a.components().count();
        let depth_b = b.components().count();
        depth_b.cmp(&depth_a)
    });
    let mut name_resolver = DiskNameResolver::new();

    for (index, source_path) in sorted_paths.iter().enumerate() {
        let source_path = source_path.clone();
        let source_name = name_resolver.resolve(&source_path);
        let normalized_name: String = source_name.nfc().collect();
        let source_normalization = normalize_type(&source_name);
        let needs_nfc_conversion = source_normalization != "NFC" && source_normalization != "BOTH";
        let mut output_path = source_path.clone();
        let mut collision_resolved = false;
        let is_directory = fs::metadata(&source_path).map(|m| m.is_dir()).unwrap_or(false);

        if needs_nfc_conversion {
            let source_dir = source_path.parent().unwrap_or_else(|| Path::new("/"));
            let base_target = source_dir.join(&normalized_name);
            let (resolved, collision) = ensure_unique_path(&base_target, Some(&source_path));
            output_path = resolved;
            collision_resolved = collision;
            if output_path != source_path {
                fs::rename(&source_path, &output_path).map_err(|e| format!("파일명 변경 실패: {e}"))?;
            }
        }

        if needs_nfc_conversion && is_directory && output_path != source_path {
            let source_prefix = format!("{}/", source_path.to_string_lossy());
            let output_prefix = format!("{}/", output_path.to_string_lossy());
            for previous in results.iter_mut() {
                if previous.output_path.starts_with(&source_prefix) {
                    if let Some(suffix) = previous.output_path.strip_prefix(&source_prefix) {
                        let updated_output_path = format!("{output_prefix}{suffix}");
                        previous.output_path = updated_output_path.clone();
                        previous.output_name = Path::new(&updated_output_path)
                            .file_name()
                            .map(|v| v.to_string_lossy().to_string())
                            .unwrap_or_default();
                    }
                }
            }
        }

        let item = NormalizeResult {
            source_path: source_path.to_string_lossy().to_string(),
            output_path: output_path.to_string_lossy().to_string(),
            source_name,
            output_name: output_path
                .file_name()
                .map(|v| v.to_string_lossy().to_string())
                .unwrap_or_default(),
            source_normalization,
            changed: needs_nfc_conversion,
            collision_resolved,
        };
        results.push(item.clone());
        let processed = index + 1;
        if should_emit_dense(processed, file_paths.len()) {
            emit_progress(app, processed, file_paths.len());
            emit_item(app, &item);
        }
    }

    emit_progress(app, file_paths.len(), file_paths.len());
    Ok(results)
}

#[tauri::command]
async fn normalize_file_names(app: tauri::AppHandle, file_paths: Vec<String>) -> Result<Vec<NormalizeResult>, String> {
    tauri::async_runtime::spawn_blocking(move || normalize_file_names_sync(&app, &file_paths))
        .await
        .map_err(|e| format!("정규화 작업 스레드 실패: {e}"))?
}

fn inspect_file(
    file_path: &Path,
    source_name: String,
    parent_folder_path: Option<String>,
    seen: &mut HashSet<PathBuf>,
    results: &mut Vec<SourceInspectResult>,
    batch: &mut Vec<SourceInspectResult>,
    discovered_count: &mut usize,
    last_emitted_count: &mut usize,
    last_emitted_at: &mut Instant,
    app: &tauri::AppHandle,
) -> Result<bool, io::Error> {
    let normalized = file_path.to_path_buf();
    if seen.contains(&normalized) {
        return Ok(false);
    }
    seen.insert(normalized);

    let source_normalization = normalize_type(&source_name);
    let inspect_item = SourceInspectResult {
        source_path: file_path.to_string_lossy().to_string(),
        source_name,
        source_normalization: source_normalization.clone(),
        changed: source_normalization != "NFC" && source_normalization != "BOTH",
        is_directory: false,
        folder_file_count: 0,
        parent_folder_path,
    };
    results.push(inspect_item.clone());
    batch.push(inspect_item);
    *discovered_count += 1;
    if batch.len() >= INSPECT_BATCH_SIZE {
        emit_inspect_batch(app, batch);
        batch.clear();
    }
    emit_inspect_progress_if_needed(app, *discovered_count, last_emitted_count, last_emitted_at);
    Ok(true)
}

fn inspect_dir(
    dir_path: &Path,
    source_name: String,
    parent_folder_path: Option<String>,
    seen: &mut HashSet<PathBuf>,
    results: &mut Vec<SourceInspectResult>,
    batch: &mut Vec<SourceInspectResult>,
    discovered_count: &mut usize,
    last_emitted_count: &mut usize,
    last_emitted_at: &mut Instant,
    app: &tauri::AppHandle,
) -> Result<usize, io::Error> {
    let normalized = dir_path.to_path_buf();
    if seen.contains(&normalized) {
        return Ok(0);
    }
    seen.insert(normalized);

    let source_normalization = normalize_type(&source_name);
    let index = results.len();
    let inspect_item = SourceInspectResult {
        source_path: dir_path.to_string_lossy().to_string(),
        source_name,
        source_normalization: source_normalization.clone(),
        changed: source_normalization != "NFC" && source_normalization != "BOTH",
        is_directory: true,
        folder_file_count: 0,
        parent_folder_path: parent_folder_path.clone(),
    };
    results.push(inspect_item.clone());
    batch.push(inspect_item);
    if batch.len() >= INSPECT_BATCH_SIZE {
        emit_inspect_batch(app, batch);
        batch.clear();
    }

    let mut file_count = 0usize;
    let mut entries: Vec<_> = fs::read_dir(dir_path)?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_string());

    for entry in entries {
        let path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().to_string();
        if let Ok(file_type) = entry.file_type() {
            if file_type.is_dir() {
                file_count += inspect_dir(
                    &path,
                    entry_name,
                    Some(dir_path.to_string_lossy().to_string()),
                    seen,
                    results,
                    batch,
                    discovered_count,
                    last_emitted_count,
                    last_emitted_at,
                    app,
                )?;
            } else if file_type.is_file() {
                if inspect_file(
                    &path,
                    entry_name,
                    Some(dir_path.to_string_lossy().to_string()),
                    seen,
                    results,
                    batch,
                    discovered_count,
                    last_emitted_count,
                    last_emitted_at,
                    app,
                )? {
                    file_count += 1;
                }
            }
        }
    }

    if let Some(folder) = results.get_mut(index) {
        folder.folder_file_count = file_count;
    }

    Ok(file_count)
}

fn inspect_source_files_sync(app: &tauri::AppHandle, file_paths: &[String]) -> Result<Vec<SourceInspectResult>, String> {
    let mut results = Vec::<SourceInspectResult>::new();
    let mut seen = HashSet::<PathBuf>::new();
    let mut batch = Vec::<SourceInspectResult>::with_capacity(128);
    let mut discovered_count = 0usize;
    let mut name_resolver = DiskNameResolver::new();
    let mut last_emitted_count = 0usize;
    let mut last_emitted_at = Instant::now();
    emit_inspect_progress_if_needed(app, 0, &mut last_emitted_count, &mut last_emitted_at);

    for file_path in file_paths {
        let target = PathBuf::from(file_path);
        let root_name = name_resolver.resolve(&target);
        match fs::metadata(&target) {
            Ok(meta) if meta.is_dir() => {
                inspect_dir(
                    &target,
                    root_name,
                    None,
                    &mut seen,
                    &mut results,
                    &mut batch,
                    &mut discovered_count,
                    &mut last_emitted_count,
                    &mut last_emitted_at,
                    app,
                )
                    .map_err(|e| format!("폴더 분석 실패: {e}"))?;
            }
            Ok(meta) if meta.is_file() => {
                inspect_file(
                    &target,
                    root_name,
                    None,
                    &mut seen,
                    &mut results,
                    &mut batch,
                    &mut discovered_count,
                    &mut last_emitted_count,
                    &mut last_emitted_at,
                    app,
                )
                    .map_err(|e| format!("파일 분석 실패: {e}"))?;
            }
            _ => {}
        }
    }

    emit_inspect_batch(app, &batch);
    let _ = app.emit("inspect-progress", InspectProgress { file_count: discovered_count });
    Ok(results)
}

#[tauri::command]
async fn inspect_source_files(app: tauri::AppHandle, file_paths: Vec<String>) -> Result<Vec<SourceInspectResult>, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_source_files_sync(&app, &file_paths))
        .await
        .map_err(|e| format!("파일 분석 스레드 실패: {e}"))?
}

#[tauri::command]
fn show_item_in_folder(file_path: String) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(file_path)
        .status()
        .map_err(|e| format!("Finder 열기 실패: {e}"))?;
    Ok(())
}

#[tauri::command]
fn open_item(file_path: String) -> Result<(), String> {
    Command::new("open")
        .arg(file_path)
        .status()
        .map_err(|e| format!("항목 열기 실패: {e}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_file_urls_to_pasteboard(paths: &[String]) -> Result<usize, String> {
    unsafe {
        let pasteboard: id = NSPasteboard::generalPasteboard(nil);
        let _: () = msg_send![pasteboard, clearContents];

        let urls: id = msg_send![class!(NSMutableArray), array];
        for path in paths {
            let ns_path = NSString::alloc(nil).init_str(path);
            let url: id = msg_send![class!(NSURL), fileURLWithPath: ns_path];
            let _: () = msg_send![urls, addObject: url];
        }

        let success: bool = msg_send![pasteboard, writeObjects: urls];
        if success {
            Ok(paths.len())
        } else {
            Err("NSPasteboard writeObjects 실패".to_string())
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn copy_file_urls_to_pasteboard(_paths: &[String]) -> Result<usize, String> {
    Err("macOS 전용 기능".to_string())
}

#[tauri::command]
fn copy_files_to_clipboard(file_paths: Vec<String>) -> Result<ClipboardCopyResult, String> {
    let unique_paths: Vec<String> = {
        let mut seen = HashSet::new();
        file_paths
            .into_iter()
            .filter(|p| !p.is_empty() && seen.insert(p.clone()))
            .collect()
    };

    let existing: Vec<String> = unique_paths
        .iter()
        .filter(|p| Path::new(p).exists())
        .cloned()
        .collect();

    if existing.is_empty() {
        return Ok(ClipboardCopyResult {
            copied_count: 0,
            mode: "none".to_string(),
            reason: Some("no-files".to_string()),
            requested_count: 0,
            missing_count: 0,
            missing_paths: vec![],
            error_code: Some("NO_FILES".to_string()),
            error_message: Some("복사 가능한 파일이 없습니다.".to_string()),
        });
    }

    match copy_file_urls_to_pasteboard(&existing) {
        Ok(count) => Ok(ClipboardCopyResult {
            copied_count: count,
            mode: "file".to_string(),
            reason: Some("native-nspasteboard".to_string()),
            requested_count: existing.len(),
            missing_count: existing.len().saturating_sub(count),
            missing_paths: vec![],
            error_code: None,
            error_message: None,
        }),
        Err(err) => {
            let mut clipboard = Clipboard::new().map_err(|e| format!("클립보드 초기화 실패: {e}"))?;
            clipboard
                .set_text(existing.join("\n"))
                .map_err(|e| format!("텍스트 클립보드 쓰기 실패: {e}"))?;
            Ok(ClipboardCopyResult {
                copied_count: existing.len(),
                mode: "text".to_string(),
                reason: Some("native-file-clipboard-failed".to_string()),
                requested_count: existing.len(),
                missing_count: 0,
                missing_paths: vec![],
                error_code: Some("FILE_CLIPBOARD_FALLBACK_TEXT".to_string()),
                error_message: Some(err),
            })
        }
    }
}

#[tauri::command]
fn copy_path_text_to_clipboard(file_paths: Vec<String>) -> Result<serde_json::Value, String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("클립보드 초기화 실패: {e}"))?;
    clipboard
        .set_text(file_paths.join("\n"))
        .map_err(|e| format!("경로 복사 실패: {e}"))?;
    Ok(serde_json::json!({ "copiedCount": file_paths.len() }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            normalize_file_names,
            inspect_source_files,
            open_item,
            show_item_in_folder,
            copy_files_to_clipboard,
            copy_path_text_to_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

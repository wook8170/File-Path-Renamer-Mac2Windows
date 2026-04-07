use std::collections::{HashMap, HashSet};
use std::ffi::CStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use std::time::UNIX_EPOCH;

use arboard::Clipboard;
use base64::Engine;
#[cfg(target_os = "macos")]
use cocoa::appkit::NSPasteboard;
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};
#[cfg(target_os = "macos")]
use cocoa::foundation::NSString;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, Emitter, Manager, RunEvent, WindowEvent,
};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;
use unicode_normalization::UnicodeNormalization;

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

// macOS 에서 ActivationPolicy 를 Accessory → Regular 로 전환할 때 Dock 에 기본 실행 파일
// 아이콘(콘솔 모양) 이 뜨는 현상을 방지하기 위해 번들 아이콘을 명시적으로 NSApp 에 설정한다.
// Tauri 는 번들이 있는 경우 Info.plist 의 CFBundleIconFile 을 읽어 자동 설정하지만,
// Accessory → Regular 전환 시 재갱신이 안 되는 케이스가 있어 수동으로 다시 지정한다.
#[cfg(target_os = "macos")]
fn refresh_macos_dock_icon() {
    unsafe {
        let bundle: id = msg_send![class!(NSBundle), mainBundle];
        if bundle == nil {
            return;
        }

        let icon_key = NSString::alloc(nil).init_str("CFBundleIconFile");
        let icon_name: id = msg_send![bundle, objectForInfoDictionaryKey: icon_key];
        if icon_name == nil {
            return;
        }

        // CFBundleIconFile 이 확장자 있는/없는 경우 둘 다 대응.
        let mut icon_path: id = msg_send![bundle, pathForResource: icon_name ofType: nil];
        if icon_path == nil {
            let icns_ext = NSString::alloc(nil).init_str("icns");
            icon_path = msg_send![bundle, pathForResource: icon_name ofType: icns_ext];
        }
        if icon_path == nil {
            return;
        }

        let image_alloc: id = msg_send![class!(NSImage), alloc];
        let image: id = msg_send![image_alloc, initWithContentsOfFile: icon_path];
        if image == nil {
            return;
        }

        let shared_app: id = msg_send![class!(NSApplication), sharedApplication];
        if shared_app == nil {
            return;
        }
        let _: () = msg_send![shared_app, setApplicationIconImage: image];
    }
}

#[cfg(not(target_os = "macos"))]
fn refresh_macos_dock_icon() {}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NormalizeResult {
    source_path: String,
    output_path: String,
    source_name: String,
    output_name: String,
    source_normalization: String,
    changed: bool,
    is_directory: bool,
    collision_resolved: bool,
    display_name: String,
    compact_path: String,
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
    is_nfd_like: bool,
    display_name: String,
    normalized_display_name: String,
    compact_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DaemonCollectTargetsResult {
    items: Vec<SourceInspectResult>,
    requested_count: usize,
    inspected_count: usize,
    added_count: usize,
    skipped_existing_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DaemonConvertTargetsResult {
    results: Vec<NormalizeResult>,
    requested_count: usize,
    unique_count: usize,
    changed_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MonitorSnapshotEntry {
    path: String,
    id: String,
    is_directory: bool,
    modified_at: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MonitorStateEntry {
    path: String,
    last_snapshot_at: Option<u64>,
    #[serde(default)]
    snapshot_entries: Vec<MonitorSnapshotEntry>,
    #[serde(default)]
    pending_entries: Vec<MonitorSnapshotEntry>,
    bookmark_data: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedMonitorDirectory {
    path: String,
    bookmark_data: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MonitorWatchEvent {
    roots: Vec<String>,
    paths: Vec<String>,
    kind: String,
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutoConvertHistoryEntry {
    timestamp: u64,
    source_path: String,
    output_path: String,
    source_name: String,
    output_name: String,
    changed: bool,
    is_directory: bool,
    status: String,
}

#[derive(Default)]
struct BookmarkStore {
    entries: Mutex<HashMap<String, String>>,
}

#[derive(Default)]
struct MonitorWatchState {
    manager: Mutex<Option<MonitorWatcherManager>>,
}

struct MonitorWatcherManager {
    _watcher: RecommendedWatcher,
    #[cfg(target_os = "macos")]
    _security_scope: Option<SecurityScopedAccess>,
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

fn to_windows_preview_before(value: &str, changed: bool) -> String {
    if !changed {
        return value.nfc().collect();
    }
    const NFD_PREVIEW_LIMIT: usize = 18;
    let chars: Vec<char> = value.nfd().collect();
    let preview = chars
        .iter()
        .take(NFD_PREVIEW_LIMIT)
        .map(|ch| ch.to_string())
        .collect::<Vec<String>>()
        .join(" ");
    if chars.len() <= NFD_PREVIEW_LIMIT {
        return preview;
    }
    format!("{preview} ...")
}

fn to_windows_preview_after(value: &str) -> String {
    value.nfc().collect()
}

fn get_directory_path(raw_path: &str) -> String {
    let normalized = raw_path.replace('\\', "/");
    let is_absolute = normalized.starts_with('/');
    let segments: Vec<&str> = normalized.split('/').filter(|segment| !segment.is_empty()).collect();
    if segments.len() <= 1 {
        return if is_absolute {
            "/".to_string()
        } else {
            segments.first().copied().unwrap_or_default().to_string()
        };
    }
    let parent = segments[..segments.len() - 1].join("/");
    if is_absolute {
        format!("/{}", parent)
    } else {
        parent
    }
}

fn normalize_compare_path(raw_path: &str) -> String {
    let mut normalized = raw_path.replace('\\', "/");
    while normalized.ends_with('/') && normalized.len() > 1 {
        normalized.pop();
    }
    normalized
}

fn resolve_compare_path_key(raw_path: &str) -> String {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Ok(canonical) = fs::canonicalize(trimmed) {
        return normalize_compare_path(&canonical.to_string_lossy());
    }

    normalize_compare_path(trimmed).nfc().collect::<String>()
}

fn to_compact_path(raw_path: &str) -> String {
    let normalized = raw_path.replace('\\', "/");
    let is_absolute = normalized.starts_with('/');
    let segments: Vec<String> = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.nfc().collect::<String>())
        .collect();
    if segments.len() <= 6 {
        let joined = segments.join("/");
        return if is_absolute {
            format!("/{}", joined)
        } else {
            joined
        };
    }
    let mut compacted = Vec::new();
    compacted.extend_from_slice(&segments[..2]);
    compacted.push("...".to_string());
    compacted.extend_from_slice(&segments[segments.len() - 3..]);
    let joined = compacted.join("/");
    if is_absolute {
        format!("/{}", joined)
    } else {
        joined
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

fn metadata_id(metadata: &fs::Metadata) -> String {
    let (dev, ino) = metadata_key(metadata);
    format!("{dev}:{ino}")
}

fn sync_bookmark_store(store: &BookmarkStore, entries: &[MonitorStateEntry]) {
    if let Ok(mut guard) = store.entries.lock() {
        guard.clear();
        for entry in entries {
            if let Some(bookmark_data) = &entry.bookmark_data {
                if !entry.path.trim().is_empty() && !bookmark_data.trim().is_empty() {
                    guard.insert(entry.path.clone(), bookmark_data.clone());
                }
            }
        }
    }
}

fn matching_bookmarks(store: &BookmarkStore, paths: &[PathBuf]) -> Vec<String> {
    let Ok(guard) = store.entries.lock() else {
        return Vec::new();
    };

    let mut used_roots = HashSet::<String>::new();
    let mut results = Vec::<String>::new();

    for path in paths {
        let mut best_match: Option<(&String, &String, usize)> = None;
        for (root, bookmark_data) in guard.iter() {
            let root_path = Path::new(root);
            if path.starts_with(root_path) {
                let depth = root_path.components().count();
                let replace = best_match
                    .as_ref()
                    .map(|(_, _, current_depth)| depth > *current_depth)
                    .unwrap_or(true);
                if replace {
                    best_match = Some((root, bookmark_data, depth));
                }
            }
        }

        if let Some((root, bookmark_data, _)) = best_match {
            if used_roots.insert(root.clone()) {
                results.push(bookmark_data.clone());
            }
        }
    }

    results
}

#[cfg(target_os = "macos")]
fn nsstring_to_string(value: id) -> String {
    if value == nil {
        return String::new();
    }
    unsafe {
        let utf8: *const std::os::raw::c_char = msg_send![value, UTF8String];
        if utf8.is_null() {
            return String::new();
        }
        CStr::from_ptr(utf8).to_string_lossy().into_owned()
    }
}

#[cfg(target_os = "macos")]
fn ns_error_message(error: id) -> String {
    if error == nil {
        return "알 수 없는 macOS 오류".to_string();
    }
    unsafe {
        let description: id = msg_send![error, localizedDescription];
        let message = nsstring_to_string(description);
        if message.is_empty() {
            "알 수 없는 macOS 오류".to_string()
        } else {
            message
        }
    }
}

#[cfg(target_os = "macos")]
fn create_security_scoped_bookmark_for_url(url: id) -> Result<String, String> {
    const NSURL_BOOKMARK_CREATION_WITH_SECURITY_SCOPE: usize = 2048;
    unsafe {
        let mut error: id = nil;
        let bookmark_data: id = msg_send![
            url,
            bookmarkDataWithOptions: NSURL_BOOKMARK_CREATION_WITH_SECURITY_SCOPE
            includingResourceValuesForKeys: nil
            relativeToURL: nil
            error: &mut error
        ];
        if bookmark_data == nil {
            return Err(format!("북마크 생성 실패: {}", ns_error_message(error)));
        }
        let bytes: *const std::ffi::c_void = msg_send![bookmark_data, bytes];
        let length: usize = msg_send![bookmark_data, length];
        if bytes.is_null() || length == 0 {
            return Err("북마크 데이터가 비어 있습니다.".to_string());
        }
        let slice = std::slice::from_raw_parts(bytes as *const u8, length);
        Ok(base64::engine::general_purpose::STANDARD.encode(slice))
    }
}

#[cfg(target_os = "macos")]
fn resolve_security_scoped_url(bookmark_data: &str) -> Result<id, String> {
    const NSURL_BOOKMARK_RESOLUTION_WITH_SECURITY_SCOPE: usize = 1024;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(bookmark_data)
        .map_err(|e| format!("북마크 디코딩 실패: {e}"))?;
    unsafe {
        let data: id = msg_send![class!(NSData), dataWithBytes: decoded.as_ptr() length: decoded.len()];
        let mut stale = false;
        let mut error: id = nil;
        let url: id = msg_send![
            class!(NSURL),
            URLByResolvingBookmarkData: data
            options: NSURL_BOOKMARK_RESOLUTION_WITH_SECURITY_SCOPE
            relativeToURL: nil
            bookmarkDataIsStale: &mut stale
            error: &mut error
        ];
        if url == nil {
            return Err(format!("북마크 복원 실패: {}", ns_error_message(error)));
        }
        Ok(url)
    }
}

#[cfg(target_os = "macos")]
fn with_security_scope_for_paths<T, F>(store: &BookmarkStore, paths: &[PathBuf], operation: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let Some(security_scope) = begin_security_scope_for_paths(store, paths)? else {
        return operation();
    };
    let result = operation();
    drop(security_scope);
    result
}

#[cfg(not(target_os = "macos"))]
fn with_security_scope_for_paths<T, F>(_store: &BookmarkStore, _paths: &[PathBuf], operation: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    operation()
}

#[cfg(target_os = "macos")]
struct SecurityScopedAccess {
    accessed_urls: Vec<id>,
}

#[cfg(target_os = "macos")]
unsafe impl Send for SecurityScopedAccess {}

#[cfg(target_os = "macos")]
unsafe impl Sync for SecurityScopedAccess {}

#[cfg(target_os = "macos")]
impl Drop for SecurityScopedAccess {
    fn drop(&mut self) {
        for accessed in self.accessed_urls.drain(..).rev() {
            unsafe {
                let _: () = msg_send![accessed, stopAccessingSecurityScopedResource];
                let _: () = msg_send![accessed, release];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
struct SecurityScopedAccess;

#[cfg(target_os = "macos")]
fn begin_security_scope_for_paths(
    store: &BookmarkStore,
    paths: &[PathBuf],
) -> Result<Option<SecurityScopedAccess>, String> {
    let bookmark_datas = matching_bookmarks(store, paths);
    if bookmark_datas.is_empty() {
        return Ok(None);
    }

    let mut accessed_urls = Vec::<id>::new();
    for bookmark_data in bookmark_datas {
        let url = resolve_security_scoped_url(&bookmark_data)?;
        let started: bool = unsafe { msg_send![url, startAccessingSecurityScopedResource] };
        if !started {
            for accessed in accessed_urls.into_iter().rev() {
                unsafe {
                    let _: () = msg_send![accessed, stopAccessingSecurityScopedResource];
                    let _: () = msg_send![accessed, release];
                }
            }
            return Err("보안 범위 리소스 접근 시작 실패".to_string());
        }
        let retained_url: id = unsafe { msg_send![url, retain] };
        accessed_urls.push(retained_url);
    }

    Ok(Some(SecurityScopedAccess { accessed_urls }))
}

#[cfg(not(target_os = "macos"))]
fn begin_security_scope_for_paths(
    _store: &BookmarkStore,
    _paths: &[PathBuf],
) -> Result<Option<SecurityScopedAccess>, String> {
    Ok(None)
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

fn collect_monitor_snapshot_entries(
    dir_path: &Path,
    seen: &mut HashSet<PathBuf>,
    results: &mut Vec<MonitorSnapshotEntry>,
) -> Result<(), io::Error> {
    let normalized = dir_path.to_path_buf();
    if seen.contains(&normalized) {
        return Ok(());
    }
    seen.insert(normalized);

    let mut entries: Vec<_> = fs::read_dir(dir_path)?.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_string());

    for entry in entries {
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let is_directory = metadata.is_dir();
        results.push(MonitorSnapshotEntry {
            path: path.to_string_lossy().to_string(),
            id: metadata_id(&metadata),
            is_directory,
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0),
        });
        if is_directory {
            collect_monitor_snapshot_entries(&path, seen, results)?;
        }
    }

    Ok(())
}

fn scan_monitor_directory_sync(root_path: &str) -> Result<Vec<MonitorSnapshotEntry>, String> {
    let root = PathBuf::from(root_path);
    let metadata = fs::metadata(&root).map_err(|e| format!("모니터링 폴더 확인 실패: {e}"))?;
    if !metadata.is_dir() {
        return Err("모니터링 대상은 폴더여야 합니다.".to_string());
    }

    let mut seen = HashSet::<PathBuf>::new();
    let mut results = Vec::<MonitorSnapshotEntry>::new();
    collect_monitor_snapshot_entries(&root, &mut seen, &mut results)
        .map_err(|e| format!("모니터링 폴더 스캔 실패: {e}"))?;
    Ok(results)
}

fn collect_monitor_snapshot_entries_for_target(
    target_path: &Path,
    seen: &mut HashSet<PathBuf>,
    results: &mut Vec<MonitorSnapshotEntry>,
    include_children: bool,
) -> Result<(), io::Error> {
    let file_type = fs::symlink_metadata(target_path)?.file_type();
    if file_type.is_symlink() {
        return Ok(());
    }

    let metadata = fs::metadata(target_path)?;
    let is_directory = metadata.is_dir();

    if is_directory {
        results.push(MonitorSnapshotEntry {
            path: target_path.to_string_lossy().to_string(),
            id: metadata_id(&metadata),
            is_directory: true,
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0),
        });
        if include_children {
            collect_monitor_snapshot_entries(target_path, seen, results)?;
        }
    } else {
        results.push(MonitorSnapshotEntry {
            path: target_path.to_string_lossy().to_string(),
            id: metadata_id(&metadata),
            is_directory: false,
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0),
        });
    }

    Ok(())
}

fn scan_monitor_paths_sync(paths: &[String]) -> Result<Vec<MonitorSnapshotEntry>, String> {
    let mut seen = HashSet::<PathBuf>::new();
    let mut results = Vec::<MonitorSnapshotEntry>::new();

    for raw_path in paths {
        let path = PathBuf::from(raw_path);
        if !path.exists() {
            continue;
        }
        collect_monitor_snapshot_entries_for_target(&path, &mut seen, &mut results, true)
            .map_err(|e| format!("모니터링 경로 부분 스캔 실패: {e}"))?;
    }

    Ok(results)
}

fn is_path_in_folder_tree_str(path: &str, folder_path: &str) -> bool {
    if path.is_empty() || folder_path.is_empty() || path == folder_path {
        return false;
    }
    let normalized_folder = if folder_path.ends_with('/') {
        folder_path.to_string()
    } else {
        format!("{folder_path}/")
    };
    path.starts_with(&normalized_folder)
}

fn dedupe_monitor_entries_by_path(entries: Vec<MonitorSnapshotEntry>) -> Vec<MonitorSnapshotEntry> {
    let mut by_path = HashMap::<String, MonitorSnapshotEntry>::new();
    for entry in entries {
        by_path.insert(entry.path.clone(), entry);
    }
    by_path.into_values().collect()
}

fn collapse_monitor_pending_entries(entries: Vec<MonitorSnapshotEntry>) -> Vec<MonitorSnapshotEntry> {
    let mut deduped = dedupe_monitor_entries_by_path(entries);
    deduped.sort_by(|a, b| a.path.cmp(&b.path));
    deduped
}

fn collect_pending_entries_for_root_sync(root_path: &str) -> Result<Vec<MonitorSnapshotEntry>, String> {
    let snapshot_entries = scan_monitor_paths_sync(&[root_path.to_string()])?;
    let mut pending = Vec::<MonitorSnapshotEntry>::new();
    for entry in snapshot_entries {
        let source_name = Path::new(&entry.path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let source_normalization = normalize_type(&source_name);
        let changed = source_normalization != "NFC" && source_normalization != "BOTH";
        if changed {
            pending.push(entry);
        }
    }
    Ok(collapse_monitor_pending_entries(pending))
}

#[tauri::command]
async fn daemon_collect_pending_entries(
    bookmark_store: tauri::State<'_, BookmarkStore>,
    roots: Vec<String>,
) -> Result<Vec<MonitorSnapshotEntry>, String> {
    let normalized_roots: Vec<String> = {
        let mut seen = HashSet::<String>::new();
        roots
            .into_iter()
            .filter(|root| !root.trim().is_empty() && seen.insert(root.clone()))
            .collect()
    };
    if normalized_roots.is_empty() {
        return Ok(Vec::new());
    }

    let bookmark_entries = bookmark_store
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || {
        let store = BookmarkStore {
            entries: Mutex::new(bookmark_entries),
        };
        let scoped_paths: Vec<PathBuf> = normalized_roots.iter().map(PathBuf::from).collect();
        with_security_scope_for_paths(&store, &scoped_paths, || {
            let mut merged = Vec::<MonitorSnapshotEntry>::new();
            for root in &normalized_roots {
                merged.extend(collect_pending_entries_for_root_sync(root)?);
            }
            Ok(collapse_monitor_pending_entries(merged))
        })
    })
    .await
    .map_err(|e| format!("데몬 pending 수집 스레드 실패: {e}"))?
}

fn monitor_event_kind_name(kind: &EventKind) -> String {
    match kind {
        EventKind::Access(_) => "access".to_string(),
        EventKind::Create(_) => "create".to_string(),
        EventKind::Modify(_) => "modify".to_string(),
        EventKind::Remove(_) => "remove".to_string(),
        EventKind::Any => "any".to_string(),
        EventKind::Other => "other".to_string(),
    }
}

fn find_affected_roots(event_paths: &[PathBuf], watched_roots: &[PathBuf]) -> Vec<String> {
    let mut affected = HashSet::<String>::new();

    for event_path in event_paths {
        for root in watched_roots {
            if event_path.starts_with(root) || root.starts_with(event_path) {
                affected.insert(root.to_string_lossy().to_string());
            }
        }
    }

    affected.into_iter().collect()
}

fn monitor_state_file_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 경로 확인 실패: {e}"))?;
    fs::create_dir_all(&app_data_dir).map_err(|e| format!("앱 데이터 폴더 생성 실패: {e}"))?;
    Ok(app_data_dir.join("monitor-state.json"))
}

fn auto_convert_history_file_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 경로 확인 실패: {e}"))?;
    fs::create_dir_all(&app_data_dir).map_err(|e| format!("앱 데이터 폴더 생성 실패: {e}"))?;
    Ok(app_data_dir.join("auto-convert-history.json"))
}

fn read_auto_convert_history<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<AutoConvertHistoryEntry>, String> {
    let file_path = auto_convert_history_file_path(app)?;
    if !file_path.exists() {
        return Ok(Vec::new());
    }
    let contents =
        fs::read_to_string(&file_path).map_err(|e| format!("자동 변환 내역 파일 읽기 실패: {e}"))?;
    serde_json::from_str::<Vec<AutoConvertHistoryEntry>>(&contents)
        .map_err(|e| format!("자동 변환 내역 파싱 실패: {e}"))
}

fn write_auto_convert_history<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    entries: &[AutoConvertHistoryEntry],
) -> Result<(), String> {
    let file_path = auto_convert_history_file_path(app)?;
    let contents = serde_json::to_string(entries).map_err(|e| format!("자동 변환 내역 직렬화 실패: {e}"))?;
    fs::write(&file_path, contents).map_err(|e| format!("자동 변환 내역 파일 저장 실패: {e}"))
}

fn emit_auto_convert_history_count<R: tauri::Runtime>(app: &tauri::AppHandle<R>, count: usize) {
    let _ = app.emit("auto-convert-history-count", count);
}

const MAX_AUTO_CONVERT_HISTORY_LEN: usize = 500;

fn trim_auto_convert_history(entries: &mut Vec<AutoConvertHistoryEntry>) -> bool {
    if entries.len() <= MAX_AUTO_CONVERT_HISTORY_LEN {
        return false;
    }
    let keep_from = entries.len() - MAX_AUTO_CONVERT_HISTORY_LEN;
    *entries = entries.split_off(keep_from);
    true
}

#[tauri::command]
fn load_monitor_state(app: tauri::AppHandle, bookmark_store: tauri::State<BookmarkStore>) -> Result<Vec<MonitorStateEntry>, String> {
    let file_path = monitor_state_file_path(&app)?;
    if !file_path.exists() {
        sync_bookmark_store(&bookmark_store, &[]);
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(&file_path).map_err(|e| format!("모니터링 상태 파일 읽기 실패: {e}"))?;
    let entries = serde_json::from_str::<Vec<MonitorStateEntry>>(&contents)
        .map_err(|e| format!("모니터링 상태 파일 파싱 실패: {e}"))?;
    sync_bookmark_store(&bookmark_store, &entries);
    Ok(entries)
}

#[tauri::command]
fn save_monitor_state(
    app: tauri::AppHandle,
    bookmark_store: tauri::State<BookmarkStore>,
    entries: Vec<MonitorStateEntry>,
) -> Result<(), String> {
    let file_path = monitor_state_file_path(&app)?;
    let contents =
        serde_json::to_string(&entries).map_err(|e| format!("모니터링 상태 직렬화 실패: {e}"))?;
    fs::write(&file_path, contents).map_err(|e| format!("모니터링 상태 파일 저장 실패: {e}"))?;
    sync_bookmark_store(&bookmark_store, &entries);
    Ok(())
}

#[tauri::command]
fn load_auto_convert_history(app: tauri::AppHandle) -> Result<Vec<AutoConvertHistoryEntry>, String> {
    let mut entries = read_auto_convert_history(&app)?;
    if trim_auto_convert_history(&mut entries) {
        write_auto_convert_history(&app, &entries)?;
        emit_auto_convert_history_count(&app, entries.len());
    }
    Ok(entries)
}

#[tauri::command]
fn get_auto_convert_history_count(app: tauri::AppHandle) -> Result<usize, String> {
    let mut entries = read_auto_convert_history(&app)?;
    if trim_auto_convert_history(&mut entries) {
        write_auto_convert_history(&app, &entries)?;
        emit_auto_convert_history_count(&app, entries.len());
    }
    Ok(entries.len())
}

#[tauri::command]
fn append_auto_convert_history(
    app: tauri::AppHandle,
    entries: Vec<AutoConvertHistoryEntry>,
) -> Result<usize, String> {
    if entries.is_empty() {
        return get_auto_convert_history_count(app);
    }
    let mut current = read_auto_convert_history(&app)?;
    current.extend(entries);
    trim_auto_convert_history(&mut current);
    write_auto_convert_history(&app, &current)?;
    let count = current.len();
    emit_auto_convert_history_count(&app, count);
    Ok(count)
}

#[tauri::command]
fn clear_auto_convert_history(app: tauri::AppHandle) -> Result<(), String> {
    write_auto_convert_history(&app, &[])?;
    emit_auto_convert_history_count(&app, 0);
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn pick_monitor_directory() -> Result<Option<PickedMonitorDirectory>, String> {
    unsafe {
        let panel: id = msg_send![class!(NSOpenPanel), openPanel];
        let _: () = msg_send![panel, setCanChooseFiles: false];
        let _: () = msg_send![panel, setCanChooseDirectories: true];
        let _: () = msg_send![panel, setAllowsMultipleSelection: false];
        let response: i64 = msg_send![panel, runModal];
        if response != 1 {
            return Ok(None);
        }
        let url: id = msg_send![panel, URL];
        if url == nil {
            return Ok(None);
        }
        let path_value: id = msg_send![url, path];
        let path = nsstring_to_string(path_value);
        if path.trim().is_empty() {
            return Ok(None);
        }
        let bookmark_data = create_security_scoped_bookmark_for_url(url)?;
        Ok(Some(PickedMonitorDirectory {
            path,
            bookmark_data: Some(bookmark_data),
        }))
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn pick_monitor_directory() -> Result<Option<PickedMonitorDirectory>, String> {
    Ok(None)
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
                        previous.display_name = to_windows_preview_after(&previous.output_name);
                        previous.compact_path = to_compact_path(&get_directory_path(&updated_output_path));
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
            is_directory,
            collision_resolved,
            display_name: to_windows_preview_after(
                &output_path
                    .file_name()
                    .map(|v| v.to_string_lossy().to_string())
                    .unwrap_or_default(),
            ),
            compact_path: to_compact_path(&get_directory_path(&output_path.to_string_lossy())),
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
async fn normalize_file_names(
    app: tauri::AppHandle,
    bookmark_store: tauri::State<'_, BookmarkStore>,
    file_paths: Vec<String>,
) -> Result<Vec<NormalizeResult>, String> {
    let bookmark_entries = bookmark_store
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let store = BookmarkStore {
            entries: Mutex::new(bookmark_entries),
        };
        let paths: Vec<PathBuf> = file_paths.iter().map(PathBuf::from).collect();
        with_security_scope_for_paths(&store, &paths, || normalize_file_names_sync(&app, &file_paths))
    })
        .await
        .map_err(|e| format!("정규화 작업 스레드 실패: {e}"))?
}

#[tauri::command]
async fn daemon_convert_targets(
    app: tauri::AppHandle,
    bookmark_store: tauri::State<'_, BookmarkStore>,
    file_paths: Vec<String>,
) -> Result<DaemonConvertTargetsResult, String> {
    let bookmark_entries = bookmark_store
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let store = BookmarkStore {
            entries: Mutex::new(bookmark_entries),
        };

        let requested_count = file_paths.len();
        let mut seen = HashSet::<String>::new();
        let unique_paths: Vec<String> = file_paths
            .into_iter()
            .filter(|path| !path.trim().is_empty())
            .filter(|path| seen.insert(resolve_compare_path_key(path)))
            .collect();

        if unique_paths.is_empty() {
            return Ok(DaemonConvertTargetsResult {
                results: Vec::new(),
                requested_count,
                unique_count: 0,
                changed_count: 0,
            });
        }

        let paths: Vec<PathBuf> = unique_paths.iter().map(PathBuf::from).collect();
        let results =
            with_security_scope_for_paths(&store, &paths, || normalize_file_names_sync(&app, &unique_paths))?;
        let changed_count = results.iter().filter(|item| item.changed).count();

        Ok(DaemonConvertTargetsResult {
            results,
            requested_count,
            unique_count: unique_paths.len(),
            changed_count,
        })
    })
    .await
    .map_err(|e| format!("데몬 변환 스레드 실패: {e}"))?
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
    let is_nfd_like = source_normalization == "NFD" || source_normalization == "MIXED";
    let inspect_item = SourceInspectResult {
        source_path: file_path.to_string_lossy().to_string(),
        source_name: source_name.clone(),
        source_normalization: source_normalization.clone(),
        changed: source_normalization != "NFC" && source_normalization != "BOTH",
        is_directory: false,
        folder_file_count: 0,
        parent_folder_path,
        is_nfd_like,
        display_name: to_windows_preview_before(&source_name, is_nfd_like),
        normalized_display_name: source_name.nfc().collect(),
        compact_path: to_compact_path(&get_directory_path(&file_path.to_string_lossy())),
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

fn build_shallow_inspect_result(
    path: &Path,
    source_name: String,
    parent_folder_path: Option<String>,
    is_directory: bool,
) -> SourceInspectResult {
    let source_normalization = normalize_type(&source_name);
    let is_nfd_like = source_normalization == "NFD" || source_normalization == "MIXED";
    SourceInspectResult {
        source_path: path.to_string_lossy().to_string(),
        source_name: source_name.clone(),
        source_normalization: source_normalization.clone(),
        changed: source_normalization != "NFC" && source_normalization != "BOTH",
        is_directory,
        folder_file_count: 0,
        parent_folder_path,
        is_nfd_like,
        display_name: if is_directory {
            source_name.nfc().collect()
        } else {
            to_windows_preview_before(&source_name, is_nfd_like)
        },
        normalized_display_name: source_name.nfc().collect(),
        compact_path: to_compact_path(&get_directory_path(&path.to_string_lossy())),
    }
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
    let is_nfd_like = source_normalization == "NFD" || source_normalization == "MIXED";
    let index = results.len();
    let inspect_item = SourceInspectResult {
        source_path: dir_path.to_string_lossy().to_string(),
        source_name: source_name.clone(),
        source_normalization: source_normalization.clone(),
        changed: source_normalization != "NFC" && source_normalization != "BOTH",
        is_directory: true,
        folder_file_count: 0,
        parent_folder_path: parent_folder_path.clone(),
        is_nfd_like,
        display_name: source_name.nfc().collect(),
        normalized_display_name: source_name.nfc().collect(),
        compact_path: to_compact_path(&get_directory_path(&dir_path.to_string_lossy())),
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

fn inspect_paths_shallow_sync(file_paths: &[String]) -> Result<Vec<SourceInspectResult>, String> {
    let mut results = Vec::<SourceInspectResult>::new();
    let mut seen = HashSet::<PathBuf>::new();
    let mut name_resolver = DiskNameResolver::new();

    for file_path in file_paths {
        let target = PathBuf::from(file_path);
        if seen.contains(&target) {
            continue;
        }
        seen.insert(target.clone());

        let metadata = match fs::metadata(&target) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let source_name = name_resolver.resolve(&target);
        let parent_folder_path = target.parent().map(|parent| parent.to_string_lossy().to_string());
        results.push(build_shallow_inspect_result(
            &target,
            source_name,
            parent_folder_path,
            metadata.is_dir(),
        ));
    }

    Ok(results)
}

#[tauri::command]
async fn inspect_source_files(
    app: tauri::AppHandle,
    bookmark_store: tauri::State<'_, BookmarkStore>,
    file_paths: Vec<String>,
) -> Result<Vec<SourceInspectResult>, String> {
    let bookmark_entries = bookmark_store
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let store = BookmarkStore {
            entries: Mutex::new(bookmark_entries),
        };
        let paths: Vec<PathBuf> = file_paths.iter().map(PathBuf::from).collect();
        with_security_scope_for_paths(&store, &paths, || inspect_source_files_sync(&app, &file_paths))
    })
        .await
        .map_err(|e| format!("파일 분석 스레드 실패: {e}"))?
}

#[tauri::command]
async fn daemon_collect_targets(
    app: tauri::AppHandle,
    bookmark_store: tauri::State<'_, BookmarkStore>,
    file_paths: Vec<String>,
    exclude_paths: Vec<String>,
) -> Result<DaemonCollectTargetsResult, String> {
    let bookmark_entries = bookmark_store
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let store = BookmarkStore {
            entries: Mutex::new(bookmark_entries),
        };

        let requested_count = file_paths.len();
        let mut seen_input = HashSet::<String>::new();
        let unique_inputs: Vec<String> = file_paths
            .into_iter()
            .filter(|path| !path.trim().is_empty())
            .filter(|path| seen_input.insert(resolve_compare_path_key(path)))
            .collect();

        if unique_inputs.is_empty() {
            return Ok(DaemonCollectTargetsResult {
                items: Vec::new(),
                requested_count,
                inspected_count: 0,
                added_count: 0,
                skipped_existing_count: 0,
            });
        }

        let paths: Vec<PathBuf> = unique_inputs.iter().map(PathBuf::from).collect();
        let mut inspected_items = with_security_scope_for_paths(&store, &paths, || {
            inspect_source_files_sync(&app, &unique_inputs)
        })?;
        let inspected_count = inspected_items.len();

        let mut exclude_set = HashSet::<String>::new();
        for path in exclude_paths {
            if path.trim().is_empty() {
                continue;
            }
            exclude_set.insert(resolve_compare_path_key(&path));
        }

        let mut filtered = Vec::<SourceInspectResult>::with_capacity(inspected_items.len());
        let mut seen_output = HashSet::<String>::new();
        let mut skipped_existing_count = 0usize;
        for item in inspected_items.drain(..) {
            let key = resolve_compare_path_key(&item.source_path);
            if exclude_set.contains(&key) || !seen_output.insert(key) {
                skipped_existing_count += 1;
                continue;
            }
            filtered.push(item);
        }

        Ok(DaemonCollectTargetsResult {
            requested_count,
            inspected_count,
            added_count: filtered.len(),
            skipped_existing_count,
            items: filtered,
        })
    })
    .await
    .map_err(|e| format!("데몬 수집 스레드 실패: {e}"))?
}

#[tauri::command]
async fn inspect_paths_shallow(
    bookmark_store: tauri::State<'_, BookmarkStore>,
    file_paths: Vec<String>,
) -> Result<Vec<SourceInspectResult>, String> {
    let bookmark_entries = bookmark_store
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let store = BookmarkStore {
            entries: Mutex::new(bookmark_entries),
        };
        let paths: Vec<PathBuf> = file_paths.iter().map(PathBuf::from).collect();
        with_security_scope_for_paths(&store, &paths, || inspect_paths_shallow_sync(&file_paths))
    })
        .await
        .map_err(|e| format!("얕은 파일 분석 스레드 실패: {e}"))?
}

#[tauri::command]
async fn scan_monitor_directory(
    bookmark_store: tauri::State<'_, BookmarkStore>,
    root_path: String,
) -> Result<Vec<MonitorSnapshotEntry>, String> {
    let bookmark_entries = bookmark_store
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let store = BookmarkStore {
            entries: Mutex::new(bookmark_entries),
        };
        with_security_scope_for_paths(&store, &[PathBuf::from(&root_path)], || scan_monitor_directory_sync(&root_path))
    })
        .await
        .map_err(|e| format!("모니터링 폴더 스캔 스레드 실패: {e}"))?
}

#[tauri::command]
async fn scan_monitor_paths(
    bookmark_store: tauri::State<'_, BookmarkStore>,
    paths: Vec<String>,
) -> Result<Vec<MonitorSnapshotEntry>, String> {
    let bookmark_entries = bookmark_store
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let store = BookmarkStore {
            entries: Mutex::new(bookmark_entries),
        };
        let scoped_paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        with_security_scope_for_paths(&store, &scoped_paths, || scan_monitor_paths_sync(&paths))
    })
        .await
        .map_err(|e| format!("모니터링 경로 부분 스캔 스레드 실패: {e}"))?
}

#[tauri::command]
fn start_monitor_watch(
    app: tauri::AppHandle,
    bookmark_store: tauri::State<'_, BookmarkStore>,
    monitor_watch_state: tauri::State<'_, MonitorWatchState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let normalized_roots: Vec<PathBuf> = {
        let mut seen = HashSet::<String>::new();
        paths.into_iter()
            .filter(|path| !path.trim().is_empty() && seen.insert(path.clone()))
            .map(PathBuf::from)
            .collect()
    };

    let mut manager_guard = monitor_watch_state
        .inner()
        .manager
        .lock()
        .map_err(|_| "watcher 상태 잠금 실패".to_string())?;
    *manager_guard = None;

    if normalized_roots.is_empty() {
        return Ok(());
    }

    let bookmark_entries = bookmark_store
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let bookmark_store = BookmarkStore {
        entries: Mutex::new(bookmark_entries),
    };

    let security_scope = begin_security_scope_for_paths(&bookmark_store, &normalized_roots)?;
    let watched_roots = normalized_roots.clone();
    let app_handle = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| match result {
            Ok(event) => {
                let roots = find_affected_roots(&event.paths, &watched_roots);
                if roots.is_empty() {
                    return;
                }
                let payload = MonitorWatchEvent {
                    roots,
                    paths: event
                        .paths
                        .iter()
                        .map(|path| path.to_string_lossy().to_string())
                        .collect(),
                    kind: monitor_event_kind_name(&event.kind),
                };
                let _ = app_handle.emit("monitor-watch-event", payload);
            }
            Err(error) => {
                let _ = app_handle.emit("monitor-watch-error", format!("watcher 이벤트 오류: {error}"));
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("watcher 생성 실패: {e}"))?;

    for root in &normalized_roots {
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|e| format!("watcher 등록 실패 ({}): {e}", root.to_string_lossy()))?;
    }

    *manager_guard = Some(MonitorWatcherManager {
        _watcher: watcher,
        #[cfg(target_os = "macos")]
        _security_scope: security_scope,
    });

    Ok(())
}

#[tauri::command]
fn stop_monitor_watch(monitor_watch_state: tauri::State<'_, MonitorWatchState>) -> Result<(), String> {
    let mut manager_guard = monitor_watch_state
        .inner()
        .manager
        .lock()
        .map_err(|_| "watcher 상태 잠금 실패".to_string())?;
    *manager_guard = None;
    Ok(())
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

#[tauri::command]
fn set_tray_badge_count(app: tauri::AppHandle, count: usize) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    {
        let title = if count > 0 {
            count.to_string()
        } else {
            String::new()
        };
        tray.set_title(Some(&title))
            .map_err(|e| format!("트레이 배지 갱신 실패: {e}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = count;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BookmarkStore::default())
        .manage(MonitorWatchState::default())
        .plugin(tauri_plugin_autostart::init(
            #[cfg(target_os = "macos")]
            MacosLauncher::AppleScript,
            None::<Vec<&str>>,
        ))
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
            // 초기 기동 시점에도 번들 아이콘을 Dock 에 명시적으로 주입해 둔다.
            refresh_macos_dock_icon();

            let open_item = MenuItem::with_id(app, "tray_open", "창 열기", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray_quit", "종료", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("default window icon not found".into()))?;

            TrayIconBuilder::with_id("main-tray")
                .tooltip("File-Path-Renamer")
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon<_>, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let _ = app.set_activation_policy(ActivationPolicy::Regular);
                        refresh_macos_dock_icon();
                        let _ = app.emit("main-window-visibility", true);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app: &tauri::AppHandle<_>, event| match event.id.as_ref() {
                    "tray_open" => {
                        let _ = app.set_activation_policy(ActivationPolicy::Regular);
                        refresh_macos_dock_icon();
                        let _ = app.emit("main-window-visibility", true);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "tray_quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.app_handle().set_activation_policy(ActivationPolicy::Accessory);
                    let _ = window.app_handle().emit("main-window-visibility", false);
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            normalize_file_names,
            daemon_convert_targets,
            inspect_source_files,
            daemon_collect_targets,
            inspect_paths_shallow,
            daemon_collect_pending_entries,
            scan_monitor_directory,
            scan_monitor_paths,
            start_monitor_watch,
            stop_monitor_watch,
            load_monitor_state,
            save_monitor_state,
            load_auto_convert_history,
            get_auto_convert_history_count,
            append_auto_convert_history,
            clear_auto_convert_history,
            pick_monitor_directory,
            open_item,
            show_item_in_folder,
            copy_files_to_clipboard,
            copy_path_text_to_clipboard,
            set_tray_badge_count
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    let _ = app.set_activation_policy(ActivationPolicy::Regular);
                    refresh_macos_dock_icon();
                    let _ = app.emit("main-window-visibility", true);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}

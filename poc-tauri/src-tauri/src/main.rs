// This PoC exists to answer one question before committing to a real Tauri migration: can a
// Rust shell spawn and talk to a persistent Node sidecar that runs the EXISTING, UNMODIFIED
// application logic (src/main/store.ts), and get a real result back into a Tauri webview via
// an ordinary `invoke()` call? Everything here is scoped to proving exactly that round trip -
// window chrome, menus, the tray, and the other ~34 IPC modules are deliberately out of scope.
//
// Two message shapes travel over the sidecar's stdout, matching sidecar.ts: a response (has
// "id", answers one specific `call()`) and a push event (has "event" instead, unsolicited -
// forwarded here to the webview as an ordinary Tauri event via `app.emit`). profiles_save
// below proves the write path (request carries params, not just a method name) and the push
// path (store.ts's real `profileEvents` 'changed' emitter reaching the webview live) together.
// log_record proves a second, independent push source (lib/managerLog.ts's own
// `managerLogEvents`) multiplexes over the exact same stdout pipe/app.emit forwarding, by
// event name alone - the shape every one of the real app's several live-update channels needs.
// console_backlog/console_watch/console_append_test_line are the actual headline case: the
// real per-server live console feed, via the exact unmodified watchLogFile/parseLogChunkWithDate
// functions the desktop Manager's own Console tab uses - see sidecar.ts's own doc comment.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct RpcRequest<'a> {
    id: i64,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Deserialize)]
struct RpcResponse {
    id: i64,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct PushEvent {
    event: String,
    data: Value,
}

type PendingMap = Arc<Mutex<HashMap<i64, mpsc::Sender<RpcResponse>>>>;

/// Owns the sidecar child's stdin plus the map a background reader thread (spawned alongside
/// this in `spawn_sidecar`) uses to resolve each response, by id, back to the `call()` that's
/// waiting on it - stdin writes happen on whichever thread calls a Tauri command, stdout reads
/// happen continuously on the one reader thread, so the two need a shared, lockable map rather
/// than a direct return value.
struct SidecarHandle {
    stdin: Mutex<ChildStdin>,
    next_id: AtomicI64,
    pending: PendingMap,
    _child: Mutex<Child>,
}

impl SidecarHandle {
    fn call(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);

        let line = serde_json::to_string(&RpcRequest { id, method, params }).map_err(|e| e.to_string())? + "\n";
        {
            let mut stdin = self.stdin.lock().unwrap();
            stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
            stdin.flush().map_err(|e| e.to_string())?;
        }

        // The sidecar is a local child process answering a cheap store read/write - a
        // genuinely hung sidecar (crashed, bad bundle, ...) should surface as an error, not
        // hang the UI forever waiting on a response that will never come.
        let response = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "sidecar did not respond within 5s".to_string())?;

        match (response.result, response.error) {
            (Some(result), _) => Ok(result),
            (None, Some(err)) => Err(err),
            (None, None) => Err("sidecar returned neither a result nor an error".to_string()),
        }
    }
}

#[tauri::command]
fn profiles_list(sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("profiles.list", None)
}

#[tauri::command]
fn profiles_save(profile: Value, sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("profiles.save", Some(profile))
}

#[tauri::command]
fn log_record(message: String, sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("log.record", Some(Value::String(message)))
}

#[tauri::command]
fn console_backlog(install_dir: String, sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("console.backlog", Some(serde_json::json!({ "installDir": install_dir })))
}

#[tauri::command]
fn console_watch(install_dir: String, sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("console.watch", Some(serde_json::json!({ "installDir": install_dir })))
}

#[tauri::command]
fn console_append_test_line(
    install_dir: String,
    message: String,
    sidecar: tauri::State<SidecarHandle>,
) -> Result<Value, String> {
    sidecar.call(
        "console.appendTestLine",
        Some(serde_json::json!({ "installDir": install_dir, "message": message })),
    )
}

/// Spawns the Node sidecar and a background thread that owns reading its stdout for the app's
/// whole lifetime: a line with an "id" resolves the matching `call()` via `pending`, a line
/// with an "event" instead gets forwarded to the webview as a same-named Tauri event. Resolved
/// relative to this crate at build time rather than bundled as a Tauri resource - fine for a
/// PoC run from a source checkout; a real migration would ship this bundle (or a compiled
/// Node/Bun binary) as a proper Tauri sidecar resource instead.
fn spawn_sidecar(app_handle: tauri::AppHandle) -> SidecarHandle {
    // Default now points at the compiled Node SEA binary (dist/sidecar-bin), built by
    // `node --experimental-sea-config` + postject from the exact same dist/sidecar.cjs bundle
    // esbuild already produced - see sidecar/README-sea.md. It is spawned directly, with no
    // "node" in front and no separate runtime next to it: this is what makes it viable as a
    // real Tauri `externalBin` resource later. SIDECAR_PATH still overrides for dev iteration;
    // when it points at a .cjs/.js file we fall back to invoking it through `node` as before.
    let sidecar_path = std::env::var("SIDECAR_PATH")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar/dist/sidecar-bin").to_string());
    let needs_node_runtime = sidecar_path.ends_with(".cjs") || sidecar_path.ends_with(".js");

    let mut command = if needs_node_runtime {
        let mut cmd = Command::new("node");
        cmd.arg(&sidecar_path);
        cmd
    } else {
        Command::new(&sidecar_path)
    };

    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap_or_else(|e| panic!("failed to spawn sidecar at {sidecar_path}: {e}"));

    let stdin = child.stdin.take().expect("sidecar stdin was not piped");
    let stdout = child.stdout.take().expect("sidecar stdout was not piped");

    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
    let reader_pending = pending.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Ok(raw) = serde_json::from_str::<Value>(&line) else {
                eprintln!("sidecar: unparseable line: {line}");
                continue;
            };
            if raw.get("id").is_some() {
                let Ok(response) = serde_json::from_value::<RpcResponse>(raw) else {
                    eprintln!("sidecar: malformed response line: {line}");
                    continue;
                };
                if let Some(tx) = reader_pending.lock().unwrap().remove(&response.id) {
                    let _ = tx.send(response);
                }
            } else {
                let Ok(push) = serde_json::from_value::<PushEvent>(raw) else {
                    eprintln!("sidecar: malformed push-event line: {line}");
                    continue;
                };
                if let Err(e) = app_handle.emit(&push.event, push.data) {
                    eprintln!("failed to forward sidecar event '{}' to the webview: {e}", push.event);
                }
            }
        }
    });

    SidecarHandle {
        stdin: Mutex::new(stdin),
        next_id: AtomicI64::new(1),
        pending,
        _child: Mutex::new(child),
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = spawn_sidecar(app.handle().clone());
            app.manage(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            profiles_list,
            profiles_save,
            log_record,
            console_backlog,
            console_watch,
            console_append_test_line
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
    result: Option<Value>,
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

/// Spawns the Node sidecar and a background thread that owns reading its stdout for the app's
/// whole lifetime: a line with an "id" resolves the matching `call()` via `pending`, a line
/// with an "event" instead gets forwarded to the webview as a same-named Tauri event. Resolved
/// relative to this crate at build time rather than bundled as a Tauri resource - fine for a
/// PoC run from a source checkout; a real migration would ship this bundle (or a compiled
/// Node/Bun binary) as a proper Tauri sidecar resource instead.
fn spawn_sidecar(app_handle: tauri::AppHandle) -> SidecarHandle {
    let sidecar_path = std::env::var("SIDECAR_PATH")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar/dist/sidecar.cjs").to_string());

    let mut child = Command::new("node")
        .arg(&sidecar_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap_or_else(|e| panic!("failed to spawn Node sidecar at {sidecar_path}: {e}"));

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
        .invoke_handler(tauri::generate_handler![profiles_list, profiles_save])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

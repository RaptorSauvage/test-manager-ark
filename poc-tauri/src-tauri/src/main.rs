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
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

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

/// Owns the sidecar child (via tauri-plugin-shell's `CommandChild`, not a raw `std::process`
/// handle - see "Sidecar packaging" in README.md) plus the map a background async task
/// (spawned alongside this in `spawn_sidecar`) uses to resolve each response, by id, back to
/// the `call()` that's waiting on it - stdin writes happen on whichever thread calls a Tauri
/// command, stdout reads happen continuously on the one task, so the two need a shared,
/// lockable map rather than a direct return value.
struct SidecarHandle {
    child: Mutex<CommandChild>,
    next_id: AtomicI64,
    pending: PendingMap,
}

impl SidecarHandle {
    fn call(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);

        let line = serde_json::to_string(&RpcRequest { id, method, params }).map_err(|e| e.to_string())? + "\n";
        self.child
            .lock()
            .unwrap()
            .write(line.as_bytes())
            .map_err(|e| e.to_string())?;

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

/// Spawns the sidecar through tauri-plugin-shell's real sidecar mechanism and a background
/// async task that owns reading its stdout for the app's whole lifetime: a line with an "id"
/// resolves the matching `call()` via `pending`, a line with an "event" instead gets forwarded
/// to the webview as a same-named Tauri event.
///
/// Default path: `app.shell().sidecar("sidecar-bin")`, which resolves to
/// `binaries/sidecar-bin-<target-triple>` per `tauri.conf.json`'s `bundle.externalBin` - the
/// real mechanism a shipped build uses (see "Sidecar packaging" in README.md), not a
/// source-tree path main.rs has to know about by convention. That file has to exist before
/// `cargo build` even starts (Tauri checks for it at build time, not just at runtime) - run
/// `sidecar/build-sea.mjs` first.
///
/// `SIDECAR_PATH` still overrides for dev iteration without rebuilding the SEA binary each
/// time `sidecar.ts` changes: when set, it's spawned as a plain `node <path>` command instead,
/// through the plugin's generic `app.shell().command(...)` (same `Command`/`CommandEvent` API,
/// so the rest of this function doesn't need to know which mode it's in).
fn spawn_sidecar(app: &tauri::App) -> SidecarHandle {
    let sidecar_command = match std::env::var("SIDECAR_PATH") {
        Ok(path) => app.shell().command("node").arg(path),
        Err(_) => app
            .shell()
            .sidecar("sidecar-bin")
            .expect("failed to resolve the 'sidecar-bin' sidecar - check tauri.conf.json's bundle.externalBin and run sidecar/build-sea.mjs first"),
    };

    let (mut rx, child) = sidecar_command
        .spawn()
        .unwrap_or_else(|e| panic!("failed to spawn sidecar: {e}"));

    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
    let reader_pending = pending.clone();
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
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
                CommandEvent::Stderr(bytes) => {
                    eprint!("{}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(err) => eprintln!("sidecar process error: {err}"),
                CommandEvent::Terminated(payload) => {
                    eprintln!("sidecar process terminated: {payload:?}");
                    break;
                }
                _ => {}
            }
        }
    });

    SidecarHandle {
        child: Mutex::new(child),
        next_id: AtomicI64::new(1),
        pending,
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = spawn_sidecar(app);
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

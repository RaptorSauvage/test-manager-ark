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
//
// Everything above is one direction: Rust calls the sidecar. folders_open_profiles proves the
// other direction too - the sidecar calling BACK into Rust for a real native action (opening a
// path in the system file manager, via tauri-plugin-opener) and getting a real result back,
// which real lib files that call Electron's `shell.*` (systemFolders.ts, backup.ts, ...) need.
// It reuses the exact same stdio pipe: a "shell-request" push event going out one way, an
// ordinary `{id, result}`/`{id, error}` line coming back the other - see rpcToRust.ts.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
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

/// The nested payload of a `{event: "shell-request", data: {...}}` push line - the sidecar
/// asking Rust to perform a real native action and report back. See rpcToRust.ts.
#[derive(Deserialize)]
struct ShellRequest {
    id: i64,
    method: String,
    params: Value,
}

type PendingMap = Arc<Mutex<HashMap<i64, mpsc::Sender<RpcResponse>>>>;
/// Shared with the background reader task so it can write shell-request responses back onto
/// the sidecar's stdin itself, from inside the same task that's reading its stdout.
type SharedChild = Arc<Mutex<CommandChild>>;

/// Owns the sidecar child (via tauri-plugin-shell's `CommandChild`, not a raw `std::process`
/// handle - see "Sidecar packaging" in README.md) plus the map a background async task
/// (spawned alongside this in `spawn_sidecar`) uses to resolve each response, by id, back to
/// the `call()` that's waiting on it - stdin writes happen on whichever thread calls a Tauri
/// command, stdout reads happen continuously on the one task, so the two need a shared,
/// lockable map rather than a direct return value. `child` is an `Arc` (not a bare `Mutex`)
/// because the reader task needs its own handle to write shell-request responses back onto the
/// same stdin this struct's own `call()` writes to.
struct SidecarHandle {
    child: SharedChild,
    next_id: AtomicI64,
    pending: PendingMap,
}

/// Writes one JSON-RPC-shaped line to the sidecar's stdin - shared by `SidecarHandle::call`
/// (Rust calling the sidecar) and the reader task's shell-request handling (answering the
/// sidecar calling Rust), since both are just "serialize this, write it, done."
fn write_line(child: &SharedChild, value: &impl Serialize) -> Result<(), String> {
    let line = serde_json::to_string(value).map_err(|e| e.to_string())? + "\n";
    child.lock().unwrap().write(line.as_bytes()).map_err(|e| e.to_string())
}

impl SidecarHandle {
    fn call(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);

        write_line(&self.child, &RpcRequest { id, method, params })?;

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
fn profiles_copy(
    profile_id: String,
    dest_install_dir: String,
    new_name: String,
    sidecar: tauri::State<SidecarHandle>,
) -> Result<Value, String> {
    sidecar.call(
        "profiles.copy",
        Some(serde_json::json!({ "profileId": profile_id, "destInstallDir": dest_install_dir, "newName": new_name })),
    )
}

#[tauri::command]
fn profiles_move(
    profile_id: String,
    dest_install_dir: String,
    new_name: String,
    sidecar: tauri::State<SidecarHandle>,
) -> Result<Value, String> {
    sidecar.call(
        "profiles.move",
        Some(serde_json::json!({ "profileId": profile_id, "destInstallDir": dest_install_dir, "newName": new_name })),
    )
}

/// Backs the real, unmodified ProfileManagementView.tsx's window.api.dialog.selectDirectory() -
/// the first command in this PoC with NO sidecar involvement at all. The real dialog.ts
/// (src/main/ipc/dialog.ts) is a main-process/window-level concern in Electron too (it calls
/// Electron's own `dialog.showOpenDialog` directly against a `BrowserWindow` handle, not
/// through any lib/*.ts business-logic file) - so the natural Tauri port is a native dialog
/// plugin invoked straight from Rust, same shape as the real app's architecture, not a sidecar
/// RPC call standing in for something it never was.
#[tauri::command]
fn dialog_select_directory(app_handle: tauri::AppHandle) -> Option<String> {
    app_handle
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

#[tauri::command]
fn log_record(message: String, sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("log.record", Some(Value::String(message)))
}

/// Backs the real, unmodified ManagerLogView.tsx's window.api.managerLog.getLog() - see "A real
/// React page" in README.md.
#[tauri::command]
fn manager_log_get_all(sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("log.getAll", None)
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

/// Calls the real, unmodified `openProfilesFolder()` from lib/systemFolders.ts - which itself
/// calls `shell.openPath` (via electronShim.ts/rpcToRust.ts), round-tripping back into this
/// same process to actually perform the native "open in the file manager" call this one
/// Rust-side command can't do on the sidecar's behalf any other way.
#[tauri::command]
fn folders_open_profiles(sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("folders.openProfiles", None)
}

/// Calls the real, unmodified `startDiscordBot()` from lib/discordBot.ts - proving the Discord
/// bot subsystem, not just the main-process logic the rest of this PoC covers. No Rust-side
/// involvement beyond the ordinary RPC round trip: discordBot.ts's own `fork()` call spawns the
/// bot as a grandchild of this sidecar entirely on the Node side (see sidecar.ts's own comment).
#[tauri::command]
fn bot_start(sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("bot.start", None)
}

#[tauri::command]
fn bot_stop(sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("bot.stop", None)
}

#[tauri::command]
fn bot_status(sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("bot.status", None)
}

/// Calls the real, unmodified `applyWebDashboardSettings()`/`getWebDashboardStatus()` from
/// lib/webDashboard.ts - the third real subsystem from the original size estimate. Unlike the
/// bot, this one is an in-process http.Server/https.Server in the real app too, not a forked
/// child - so no fork()/SEA interaction to worry about, just the ordinary RPC round trip.
#[tauri::command]
fn dashboard_start(port: i64, sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("dashboard.start", Some(serde_json::json!({ "port": port })))
}

#[tauri::command]
fn dashboard_stop(sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("dashboard.stop", None)
}

#[tauri::command]
fn dashboard_status(sidecar: tauri::State<SidecarHandle>) -> Result<Value, String> {
    sidecar.call("dashboard.status", None)
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

    // Fixes the real bug documented in README.md's "The Discord bot subsystem": discordBot.ts's
    // fork() silently can't launch a different script from inside this sidecar once it's a SEA
    // binary. BOT_LAUNCH_COMMAND (a small, opt-in override added to the real discordBot.ts -
    // zero behavior change when unset) tells it to spawn this specific binary by path instead.
    //
    // Resolved through the real `bundle.externalBin` mechanism this time (tauri.conf.json now
    // lists "binaries/bot-bin" alongside "binaries/sidecar-bin") - not the dev-only
    // CARGO_MANIFEST_DIR shortcut an earlier version of this function used, which would have
    // resolved to a source-tree path that doesn't exist once genuinely installed. Tauri's own
    // build script copies `binaries/bot-bin-<target-triple>` to a plain `bot-bin` next to the
    // compiled executable - in `target/debug/` during `cargo build` and in `usr/bin/` (Linux) of
    // a real `cargo tauri build` bundle alike - which is exactly the convention
    // tauri-plugin-shell's own (private) sidecar-path resolution uses internally, replicated
    // here by hand since there's no public API to ask it for a resolved path without spawning.
    let bot_bin_path = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(if cfg!(windows) { "bot-bin.exe" } else { "bot-bin" })));
    let sidecar_command = match bot_bin_path {
        Some(path) if path.exists() => sidecar_command.env("BOT_LAUNCH_COMMAND", path),
        _ => sidecar_command,
    };

    let (mut rx, child) = sidecar_command
        .spawn()
        .unwrap_or_else(|e| panic!("failed to spawn sidecar: {e}"));
    let child: SharedChild = Arc::new(Mutex::new(child));

    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
    let reader_pending = pending.clone();
    let reader_child = child.clone();
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
                        if push.event == "shell-request" {
                            let Ok(request) = serde_json::from_value::<ShellRequest>(push.data) else {
                                eprintln!("sidecar: malformed shell-request data: {line}");
                                continue;
                            };
                            let response = handle_shell_request(&app_handle, &request.method, &request.params);
                            eprintln!("sidecar shell-request '{}' -> {:?}", request.method, response);
                            let payload = match response {
                                Ok(result) => serde_json::json!({ "id": request.id, "result": result }),
                                Err(error) => serde_json::json!({ "id": request.id, "error": error }),
                            };
                            if let Err(e) = write_line(&reader_child, &payload) {
                                eprintln!("failed to write shell-request response to sidecar stdin: {e}");
                            }
                        } else if let Err(e) = app_handle.emit(&push.event, push.data) {
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
        child,
        next_id: AtomicI64::new(1),
        pending,
    }
}

/// Performs the real native action a sidecar's `shell-request` push event asked for, and
/// returns what to send back on its stdin. Only "openPath" exists so far, since that's the
/// only `shell.*` method any real lib file actually calls (confirmed by grepping - see
/// README.md's "Where the real Electron coupling lives").
fn handle_shell_request(app_handle: &tauri::AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "openPath" => {
            let path = params
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "shell-request 'openPath': missing or non-string 'path' param".to_string())?;
            app_handle
                .opener()
                .open_path(path, None::<&str>)
                .map(|_| Value::Bool(true))
                .map_err(|e| e.to_string())
        }
        other => Err(format!("unknown shell-request method '{other}'")),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = spawn_sidecar(app);
            app.manage(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            profiles_list,
            profiles_save,
            profiles_copy,
            profiles_move,
            dialog_select_directory,
            log_record,
            manager_log_get_all,
            console_backlog,
            console_watch,
            console_append_test_line,
            folders_open_profiles,
            bot_start,
            bot_stop,
            bot_status,
            dashboard_start,
            dashboard_stop,
            dashboard_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

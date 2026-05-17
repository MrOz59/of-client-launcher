use std::io::{self, Read};
use std::process::{Command, ExitCode};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

// ── Configuração visual da janela toast ───────────────────────────────────────

const TOAST_WIDTH: i32 = 352;
const TOAST_HEIGHT: i32 = 116;
const MARGIN_RIGHT: i32 = 16;
const MARGIN_BOTTOM: i32 = 48;

const DEFAULT_DURATION_MS: u64 = 5000;
const MIN_DURATION_MS: u64 = 1000;
const MAX_DURATION_MS: u64 = 60000;

// Fallback para 1920x1080:
// x = 1920 - 352 - 16 = 1552
// y = 1080 - 116 - 48 = 916
const FALLBACK_TOAST_X: i32 = 1552;
const FALLBACK_TOAST_Y: i32 = 916;

// ── Estrutura de dados da notificação ─────────────────────────────────────────

fn default_title() -> String {
    "Steam".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToastParams {
    #[serde(default, rename = "type")]
    pub kind: Option<String>,

    #[serde(default = "default_title")]
    pub title: String,

    #[serde(default)]
    pub message: Option<String>,

    #[serde(default)]
    pub game: Option<String>,

    #[serde(default)]
    pub icon: Option<String>,

    #[serde(default)]
    pub duration: Option<u64>,
}

// ── Estado da aplicação ───────────────────────────────────────────────────────

pub struct AppState {
    pub params: ToastParams,
}

// ── Help CLI ──────────────────────────────────────────────────────────────────

fn print_help() {
    println!(
        r#"void-toast

Uso:
  void-toast --title="Título" --message="Mensagem" --game="VoidLauncher" --icon="🏆" --duration=5000

Também aceita JSON:
  void-toast --json '{{"title":"Download concluído","message":"Jogo pronto","game":"VoidLauncher","icon":"🏆","duration":5000}}'

Também aceita JSON via stdin:
  echo '{{"title":"Download concluído","message":"Jogo pronto"}}' | void-toast --stdin

Argumentos:
  --title        Título principal da notificação
  --message      Mensagem opcional
  --game         Fonte/app/jogo exibido no topo
  --icon         Emoji, URL ou caminho de imagem
  --duration     Duração em ms. Mínimo: 1000. Máximo: 60000
  --json         Recebe todos os dados como JSON
  --stdin        Lê JSON do stdin
  --help         Mostra esta ajuda

Variáveis de ambiente:
  VOID_TOAST_X        Força posição X da janela
  VOID_TOAST_Y        Força posição Y da janela

Linux/XWayland:
  Para maior compatibilidade com always-on-top:
  WAYLAND_DISPLAY="" GDK_BACKEND=x11 void-toast --title="Teste"
"#
    );
}

// ── Utilitários CLI ───────────────────────────────────────────────────────────

fn normalize_params(mut params: ToastParams) -> ToastParams {
    params.title = params.title.trim().to_string();

    if params.title.is_empty() {
        params.title = default_title();
    }

    params.message = params
        .message
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    params.game = params
        .game
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    params.icon = params
        .icon
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let duration = params.duration.unwrap_or(DEFAULT_DURATION_MS);
    params.duration = Some(duration.clamp(MIN_DURATION_MS, MAX_DURATION_MS));

    params
}

fn parse_json_params(json: &str) -> Result<ToastParams, String> {
    let params: ToastParams = serde_json::from_str(json)
        .map_err(|err| format!("JSON inválido para toast: {}", err))?;

    Ok(normalize_params(params))
}

fn read_stdin_to_string() -> Result<String, String> {
    let mut input = String::new();

    io::stdin()
        .read_to_string(&mut input)
        .map_err(|err| format!("erro ao ler stdin: {}", err))?;

    if input.trim().is_empty() {
        return Err("stdin vazio; esperado JSON de notificação".to_string());
    }

    Ok(input)
}

fn parse_cli_params(args: &[String]) -> Result<ToastParams, String> {
    let mut params = ToastParams {
        kind: Some("info".to_string()),
        title: default_title(),
        message: None,
        game: None,
        icon: None,
        duration: Some(DEFAULT_DURATION_MS),
    };

    let mut i = 1;

    while i < args.len() {
        let arg = &args[i];

        if arg == "--standalone" {
            // Mantido por compatibilidade com o protótipo antigo.
            i += 1;
            continue;
        }

        if arg == "--help" || arg == "-h" {
            print_help();
            std::process::exit(0);
        }

        if arg == "--stdin" {
            let input = read_stdin_to_string()?;
            return parse_json_params(&input);
        }

        if arg == "--json" {
            let json = args
                .get(i + 1)
                .ok_or_else(|| "--json precisa receber uma string JSON".to_string())?;

            return parse_json_params(json);
        }

        if let Some(json) = arg.strip_prefix("--json=") {
            return parse_json_params(json);
        }

        if let Some(rest) = arg.strip_prefix("--") {
            if let Some(eq) = rest.find('=') {
                let key = &rest[..eq];
                let val = rest[eq + 1..].to_string();

                match key {
                    "title" => params.title = val,
                    "message" => params.message = Some(val),
                    "game" => params.game = Some(val),
                    "icon" => params.icon = Some(val),
                    "duration" => {
                        params.duration = Some(
                            val.parse::<u64>()
                                .map_err(|_| format!("duration inválido: {}", val))?,
                        );
                    }
                    _ => {
                        eprintln!("[void-toast] argumento ignorado: --{}", key);
                    }
                }

                i += 1;
                continue;
            }

            let key = rest;

            match key {
                "title" | "message" | "game" | "icon" | "duration" => {
                    let val = args
                        .get(i + 1)
                        .ok_or_else(|| format!("--{} precisa receber um valor", key))?
                        .to_string();

                    match key {
                        "title" => params.title = val,
                        "message" => params.message = Some(val),
                        "game" => params.game = Some(val),
                        "icon" => params.icon = Some(val),
                        "duration" => {
                            params.duration = Some(
                                val.parse::<u64>()
                                    .map_err(|_| format!("duration inválido: {}", val))?,
                            );
                        }
                        _ => {}
                    }

                    i += 2;
                    continue;
                }
                _ => {
                    eprintln!("[void-toast] argumento ignorado: --{}", key);
                    i += 1;
                    continue;
                }
            }
        }

        eprintln!("[void-toast] argumento ignorado: {}", arg);
        i += 1;
    }

    Ok(normalize_params(params))
}

// ── Parse simples de geometria do xrandr ──────────────────────────────────────
//
// Exemplos esperados:
// 1920x1080+0+0
// 2560x1440+1920+0

fn parse_xrandr_geometry(token: &str) -> Option<(i32, i32, i32, i32)> {
    let mut parts = token.split(['x', '+']);

    let width = parts.next()?.parse::<i32>().ok()?;
    let height = parts.next()?.parse::<i32>().ok()?;
    let x = parts.next()?.parse::<i32>().ok()?;
    let y = parts.next()?.parse::<i32>().ok()?;

    if width <= 0 || height <= 0 {
        return None;
    }

    Some((width, height, x, y))
}

// ── Obtém posição do toast usando xrandr no Linux/X11 ─────────────────────────
//
// Evita usar primary_monitor/current_monitor do Tauri/Tao no Linux,
// porque essa área foi justamente onde o protótipo estava quebrando.

fn calculate_toast_position_from_xrandr() -> Option<(i32, i32)> {
    let output = Command::new("xrandr").arg("--current").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut first_connected: Option<(i32, i32, i32, i32)> = None;
    let mut primary_connected: Option<(i32, i32, i32, i32)> = None;

    for line in stdout.lines() {
        if !line.contains(" connected") {
            continue;
        }

        for token in line.split_whitespace() {
            if let Some(geometry) = parse_xrandr_geometry(token) {
                if first_connected.is_none() {
                    first_connected = Some(geometry);
                }

                if line.contains(" primary ") {
                    primary_connected = Some(geometry);
                }

                break;
            }
        }
    }

    let (screen_width, screen_height, screen_x, screen_y) =
        primary_connected.or(first_connected)?;

    let x = screen_x + screen_width - TOAST_WIDTH - MARGIN_RIGHT;
    let y = screen_y + screen_height - TOAST_HEIGHT - MARGIN_BOTTOM;

    Some((x, y))
}

fn calculate_toast_position() -> (i32, i32) {
    let env_x = std::env::var("VOID_TOAST_X")
        .ok()
        .and_then(|v| v.parse::<i32>().ok());

    let env_y = std::env::var("VOID_TOAST_Y")
        .ok()
        .and_then(|v| v.parse::<i32>().ok());

    if let (Some(x), Some(y)) = (env_x, env_y) {
        return (x, y);
    }

    calculate_toast_position_from_xrandr().unwrap_or((FALLBACK_TOAST_X, FALLBACK_TOAST_Y))
}

// ── Posiciona janela toast no canto inferior direito e força always-on-top ─────

fn position_toast_window(win: &WebviewWindow) {
    let (x, y) = calculate_toast_position();

    match win.set_position(tauri::Position::Physical(
        tauri::PhysicalPosition::new(x, y),
    )) {
        Ok(_) => eprintln!("[void-toast] toast posicionado em ({}, {})", x, y),
        Err(err) => eprintln!("[void-toast] erro ao posicionar toast: {:?}", err),
    }

    if let Err(err) = win.set_always_on_top(true) {
        eprintln!("[void-toast] erro em set_always_on_top: {:?}", err);
    }

    if let Err(err) = win.set_visible_on_all_workspaces(true) {
        eprintln!("[void-toast] erro em set_visible_on_all_workspaces: {:?}", err);
    }
}

// ── Cria janela toast ─────────────────────────────────────────────────────────

fn create_toast_window(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let (x, y) = calculate_toast_position();

    eprintln!("[void-toast] criando janela toast em ({}, {})", x, y);

    WebviewWindowBuilder::new(
        app,
        "toast",
        WebviewUrl::App(format!("toast.html?v={}", env!("CARGO_PKG_VERSION")).into()),
    )
    .title("Void Toast")
    .inner_size(TOAST_WIDTH as f64, TOAST_HEIGHT as f64)
    .position(x as f64, y as f64)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .focused(false)
    .visible(false)
    .build()
}

// ── Comandos IPC chamados pelo toast.html ─────────────────────────────────────

#[tauri::command]
fn toast_ready(app: AppHandle, state: State<'_, Mutex<AppState>>) -> Option<ToastParams> {
    eprintln!("[void-toast] toast_ready chamado");

    let params = state.lock().unwrap().params.clone();

    if let Some(win) = app.get_webview_window("toast") {
        position_toast_window(&win);

        if let Err(err) = win.show() {
            eprintln!("[void-toast] erro ao mostrar toast: {:?}", err);
        }

        position_toast_window(&win);
    } else {
        eprintln!("[void-toast] janela toast não encontrada");
    }

    Some(params)
}

#[tauri::command]
fn hide_toast_window(app: AppHandle) -> Result<(), String> {
    eprintln!("[void-toast] hide_toast_window — encerrando processo");
    app.exit(0);
    Ok(())
}

// ── Ponto de entrada principal ─────────────────────────────────────────────────

pub fn run() {
    #[cfg(target_os = "linux")]
    unsafe {
        let allow_wayland = std::env::var("VOID_TOAST_ALLOW_WAYLAND")
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false);

        if !allow_wayland && std::env::var_os("DISPLAY").is_some() {
            // Wayland compositors commonly ignore window positioning and keep-above
            // hints. XWayland gives the toast predictable bottom-right placement.
            std::env::set_var("GDK_BACKEND", "x11");
            std::env::remove_var("WAYLAND_DISPLAY");
        }

        // Evita bug visual comum com WebKitGTK/AMD em janelas transparentes.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let args: Vec<String> = std::env::args().collect();

    let params = match parse_cli_params(&args) {
        Ok(params) => params,
        Err(err) => {
            eprintln!("[void-toast] erro: {}", err);
            eprintln!("[void-toast] use --help para ver os argumentos");
            std::process::exit(2);
        }
    };

    let duration_ms = params.duration.unwrap_or(DEFAULT_DURATION_MS);

    tauri::Builder::default()
        .manage(Mutex::new(AppState { params }))
        .invoke_handler(tauri::generate_handler![toast_ready, hide_toast_window])
        .setup(move |app| {
            let toast_win = create_toast_window(app)?;

            // Não usar set_ignore_cursor_events aqui.
            // No Linux/Tao 0.35.2, isso pode causar panic quando a janela ainda
            // não está completamente realizada.
            position_toast_window(&toast_win);

            let _ = toast_win.set_always_on_top(true);
            let _ = toast_win.set_visible_on_all_workspaces(true);

            // Fecha o processo automaticamente caso o JS não chame hide_toast_window.
            let handle = app.handle().clone();

            thread::spawn(move || {
                thread::sleep(Duration::from_millis(duration_ms + 1200));
                handle.exit(0);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar void-toast");
}

// Evita warning se algum ambiente/toolchain reclamar de import não usado em builds específicos.
#[allow(dead_code)]
fn _exit_success() -> ExitCode {
    ExitCode::SUCCESS
}

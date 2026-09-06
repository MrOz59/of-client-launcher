#!/usr/bin/env python3
"""Exercise the real toast in an isolated KDE/Wayland session.

Requires kwin_wayland, Xwayland, dbus-run-session, Python GI/GTK3 and python-xlib.
Run after npm run build:notification-overlay:linux:
  python scripts/test-toast-focus.py
  python scripts/test-toast-focus.py --game-backend wayland

The virtual compositor has its own D-Bus session and config. No windows or input
are sent to the user's desktop.
"""

import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


def session(args):
    os.environ["GDK_BACKEND"] = args.game_backend
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk, GLib, Gtk
    from Xlib import X, display
    from Xlib.ext import shape

    connection = display.Display()
    root = connection.screen().root
    game = Gtk.Window(title="Toast regression: fullscreen game")
    game.add(Gtk.Label(label="The fullscreen game must retain focus"))
    game.fullscreen()
    game.show_all()
    game.present()
    started = time.monotonic()
    child = None
    observed = False
    failures = []
    game_xid = None
    if args.game_backend == "x11":
        gi.require_version("GdkX11", "3.0")
        from gi.repository import GdkX11

        game_xid = GdkX11.X11Window.get_xid(game.get_window())

    def prop(window, name):
        value = window.get_full_property(connection.intern_atom(name), X.AnyPropertyType)
        return value.value if value is not None else []

    def finish():
        if child is not None and child.poll() is None:
            child.terminate()
            child.wait(timeout=5)
        Path(args.result).write_text(json.dumps({"observed": observed, "failures": failures}))
        Gtk.main_quit()

    def focus_changed(*_):
        if child is not None and not game.is_active():
            failures.append("Fullscreen game lost focus during toast lifecycle")

    game.connect("notify::is-active", focus_changed)

    def check():
        nonlocal child, observed
        try:
            if time.monotonic() - started > 20:
                raise AssertionError("Timed out waiting for a visible toast and clean exit")
            if child is None:
                if not game.is_active() or not game.get_window().get_state() & Gdk.WindowState.FULLSCREEN:
                    return True
                child = subprocess.Popen(
                    [args.binary, "--json", json.dumps({"title": "Focus regression", "duration": 3000})],
                    env={**os.environ, "VOID_TOAST_ALLOW_WAYLAND": "0"},
                )
                return True

            assert game.is_active(), "Game is no longer active"
            assert game.get_window().get_state() & Gdk.WindowState.FULLSCREEN, "Game left fullscreen"
            stacking = list(prop(root, "_NET_CLIENT_LIST_STACKING"))
            for xid in stacking:
                window = connection.create_resource_object("window", int(xid))
                title = prop(window, "_NET_WM_NAME")
                if not isinstance(title, bytes) or title.decode(errors="replace") != "Void Toast":
                    continue
                if window.get_attributes().map_state != X.IsViewable:
                    continue
                assert not window.get_wm_hints().input, "Toast accepts keyboard focus"
                assert not window.shape_get_rectangles(shape.SK.Input).rectangles, "Toast intercepts mouse input"
                types = prop(window, "_NET_WM_WINDOW_TYPE")
                assert types[0] == connection.intern_atom("_KDE_NET_WM_WINDOW_TYPE_CRITICAL_NOTIFICATION"), "Toast is below the fullscreen layer"
                time_window = prop(window, "_NET_WM_USER_TIME_WINDOW")
                # GDK advertises its helper even when the WM doesn't support
                # it; in that case the timestamp lives on the toplevel itself.
                supports_time_window = connection.intern_atom("_NET_WM_USER_TIME_WINDOW") in prop(root, "_NET_SUPPORTED")
                user_window = connection.create_resource_object("window", int(time_window[0])) if len(time_window) and supports_time_window else window
                user_time = prop(user_window, "_NET_WM_USER_TIME")
                assert len(user_time) and user_time[0] == 0, f"Invalid toast user time: {list(user_time)}"
                if game_xid is not None:
                    assert stacking.index(xid) > stacking.index(game_xid), "Toast is stacked behind the game"
                observed = True

            if child.poll() is not None:
                assert child.returncode == 0, f"Toast exited with {child.returncode}"
                assert observed, "Toast never became visible"
                # Continue observing after destruction: closing a toast must
                # not activate the launcher or change the foreground window.
                GLib.timeout_add(400, finish)
                return False
            return True
        except Exception as error:
            failures.append(str(error))
            finish()
            return False

    GLib.timeout_add(25, check)
    Gtk.main()
    connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", default=str(Path(__file__).resolve().parents[1] / "notification-overlay/dist/void-toast-linux-x86_64"))
    parser.add_argument("--game-backend", choices=["x11", "wayland"], default="x11")
    parser.add_argument("--result", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.result:
        session(args)
        return

    with tempfile.TemporaryDirectory(prefix="void-toast-focus-") as directory:
        result = Path(directory) / "result.json"
        runtime = Path(directory) / "runtime"
        runtime.mkdir(mode=0o700)
        env = {
            **os.environ,
            "XDG_CONFIG_HOME": directory,
            "XDG_DATA_HOME": directory,
            "XDG_RUNTIME_DIR": str(runtime),
            "NO_AT_BRIDGE": "1",
            "GIO_USE_VFS": "local",
            "LIBGL_ALWAYS_SOFTWARE": "1",
        }
        env.pop("DESKTOP_STARTUP_ID", None)
        env.pop("XDG_ACTIVATION_TOKEN", None)
        command = [
            "dbus-run-session", "--", "kwin_wayland", "--virtual", "--xwayland",
            "--width", "1280", "--height", "720", "--no-lockscreen", "--no-global-shortcuts",
            "--no-kactivities", "--socket", f"void-toast-test-{os.getpid()}",
            "--exit-with-session", str(Path(__file__).resolve()),
        ]
        # KWin's session command doesn't accept separate application arguments.
        # A tiny wrapper passes them without invoking a shell with user text.
        wrapper = Path(directory) / "session.py"
        wrapper.write_text(
            f"#!{sys.executable}\nimport os\nos.execv({sys.executable!r}, "
            f"{[sys.executable, str(Path(__file__).resolve()), '--binary', str(Path(args.binary).resolve()), '--game-backend', args.game_backend, '--result', str(result)]!r})\n"
        )
        wrapper.chmod(0o700)
        command[-1] = str(wrapper)
        log = Path(directory) / "session.log"
        with log.open("w") as output:
            run = subprocess.Popen(command, env=env, stdout=output, stderr=output, start_new_session=True)
            try:
                run.wait(timeout=35)
            finally:
                try:
                    os.killpg(run.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                run.wait(timeout=5)
        report = json.loads(result.read_text()) if result.exists() else {"failures": ["No test result from compositor"]}
        if run.returncode or report["failures"]:
            print(log.read_text(), file=sys.stderr)
            raise SystemExit(f"FAIL: {report}")
        print(f"PASS ({args.game_backend} game): toast visible, focus preserved through close, empty mouse input region, no activation request")


if __name__ == "__main__":
    main()

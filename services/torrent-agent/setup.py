# -*- coding: utf-8 -*-
"""cx_Freeze setup script to build standalone torrent-agent binary.

This compiles libtorrent_rpc.py + libtorrent into a single executable
that doesn't require Python to be installed on the user's machine.

Usage:
  pip install cx_Freeze libtorrent
  python setup.py build_exe
"""

import sys
from cx_Freeze import setup, Executable

# Build options
build_exe_options = {
    "packages": ["libtorrent", "json", "os", "sys"],
    "excludes": [
        "tkinter",
        "unittest",
        "email",
        "html",
        "http",
        "xml",
        "pydoc",
        "doctest",
        "argparse",
        "difflib",
        "inspect",
        "asyncio",
        "concurrent",
        "ctypes",
        "distutils",
        "lib2to3",
        "logging",
        "multiprocessing",
        "sqlite3",
        "ssl",
        "urllib",
        "zipfile",
    ],
    "build_exe": "dist",
    "include_msvcr": True,
}

# Target executable
target = Executable(
    script="libtorrent_rpc.py",
    target_name="torrent-agent.exe" if sys.platform == "win32" else "torrent-agent",
)

setup(
    name="of-torrent-agent",
    version="1.0.0",
    description="OF-Client Torrent Agent - libtorrent RPC service",
    options={"build_exe": build_exe_options},
    executables=[target],
)

# -*- coding: utf-8 -*-
"""cx_Freeze setup script to build standalone torrent-agent binary.

This is the EXACT same configuration used by Hydra Launcher.
See: https://github.com/hydralauncher/hydra/blob/main/python_rpc/setup.py

Usage:
  pip install -r requirements.txt
  python setup.py build
"""

from cx_Freeze import setup, Executable

# Dependencies are automatically detected, but it might need fine tuning.
# This is the EXACT same configuration that Hydra Launcher uses.
build_exe_options = {
    "packages": ["libtorrent"],
    "build_exe": "torrent-agent",
    "include_msvcr": True
}

setup(
    name="torrent-agent",
    version="1.0.0",
    description="OF-Client Torrent Agent",
    options={"build_exe": build_exe_options},
    executables=[Executable(
        "libtorrent_rpc.py",
        target_name="torrent-agent"
    )]
)

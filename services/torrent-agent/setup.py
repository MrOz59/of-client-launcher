# -*- coding: utf-8 -*-
"""cx_Freeze setup script to build standalone torrent-agent binary.

This compiles libtorrent_rpc.py + libtorrent into a single executable
that doesn't require Python to be installed on the user's machine.

Usage:
  pip install cx_Freeze libtorrent
  python setup.py build_exe
"""

from cx_Freeze import setup, Executable

# Dependencies are automatically detected, but it might need fine tuning.
# This is the same configuration that Hydra Launcher uses.
build_exe_options = {
    "packages": ["libtorrent"],
    "build_exe": "dist",
    "include_msvcr": True,
}

setup(
    name="of-torrent-agent",
    version="1.0.0",
    description="OF-Client Torrent Agent - libtorrent RPC service",
    options={"build_exe": build_exe_options},
    executables=[
        Executable(
            "libtorrent_rpc.py",
            target_name="torrent-agent",
        )
    ],
)

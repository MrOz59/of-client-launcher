# -*- coding: utf-8 -*-
"""cx_Freeze setup script to build standalone torrent-agent binary.

This compiles libtorrent_rpc.py + libtorrent into a single executable
that doesn't require Python to be installed on the user's machine.

Usage:
  pip install cx_Freeze libtorrent
  python setup.py build_exe
"""

import sys
import os
from cx_Freeze import setup, Executable

# Find libtorrent DLLs and include them
bin_includes = []
bin_path_includes = []

try:
    import libtorrent
    lt_dir = os.path.dirname(libtorrent.__file__)
    print(f"[setup.py] libtorrent location: {lt_dir}")
    
    # On Windows, we need to include all DLLs from site-packages
    if sys.platform == "win32":
        site_packages = os.path.dirname(lt_dir)
        # Look for libtorrent DLLs
        for root, dirs, files in os.walk(site_packages):
            for f in files:
                if f.endswith('.dll') or f.endswith('.pyd'):
                    full_path = os.path.join(root, f)
                    print(f"[setup.py] Found binary: {full_path}")
                    if 'libtorrent' in f.lower() or 'torrent' in root.lower():
                        bin_includes.append(full_path)
        
        # Also add the libtorrent directory to bin_path_includes
        bin_path_includes.append(lt_dir)
        
except ImportError as e:
    print(f"[setup.py] WARNING: libtorrent not found: {e}")

print(f"[setup.py] bin_includes: {bin_includes}")
print(f"[setup.py] bin_path_includes: {bin_path_includes}")

# Dependencies are automatically detected, but it might need fine tuning.
# This is the same configuration that Hydra Launcher uses.
build_exe_options = {
    "packages": ["libtorrent"],
    "build_exe": "dist",
    "include_msvcr": True,
    "bin_includes": bin_includes,
    "bin_path_includes": bin_path_includes,
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

# -*- coding: utf-8 -*-
"""
PyInstaller spec file for torrent-agent.

This is an alternative to cx_Freeze that often works better
for native libraries like libtorrent.

Usage:
  pip install pyinstaller libtorrent
  pyinstaller torrent-agent.spec
"""

import sys
import os

# Try to find libtorrent binaries
binaries = []
hiddenimports = ['libtorrent']

try:
    import libtorrent
    lt_dir = os.path.dirname(libtorrent.__file__)
    print(f"libtorrent location: {lt_dir}")
    
    # Include all files from libtorrent directory
    for item in os.listdir(lt_dir):
        src = os.path.join(lt_dir, item)
        if os.path.isfile(src) and (item.endswith('.dll') or item.endswith('.pyd') or item.endswith('.so')):
            binaries.append((src, '.'))
            print(f"Including binary: {item}")
except ImportError:
    print("WARNING: libtorrent not found")

a = Analysis(
    ['libtorrent_rpc.py'],
    pathex=[],
    binaries=binaries,
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'unittest',
        'email',
        'html',
        'http',
        'xml',
        'pydoc',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='torrent-agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

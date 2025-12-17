# -*- coding: utf-8 -*-
"""Minimal torrent agent for OF-Client.

Line-delimited JSON RPC over stdin/stdout.
Methods: ping, add, pause, resume, remove, status

Note: Requires python bindings for libtorrent (rasterbar).
"""

import json
import os
import sys
import traceback

try:
    import libtorrent as lt
except Exception as e:
    error_detail = traceback.format_exc()
    sys.stdout.write(
        json.dumps(
            {
                "event": "fatal",
                "message": "Missing python libtorrent bindings",
                "detail": str(e),
                "traceback": error_detail,
            }
        )
        + "\n"
    )
    sys.stdout.flush()
    sys.exit(2)


ses = lt.session({"listen_interfaces": "0.0.0.0:6881"})

try:
    ses.apply_settings(
        {
            "enable_dht": True,
            "enable_lsd": True,
            "enable_upnp": True,
            "enable_natpmp": True,
        }
    )
except Exception:
    pass

try:
    ses.start_dht()
except Exception:
    pass

handles = {}  # info_hash -> torrent_handle


def _info_hash_str(h):
    try:
        return str(h)
    except Exception:
        try:
            return h.to_string().hex()
        except Exception:
            return None


def _ensure_unmanaged(handle):
    try:
        handle.unset_flags(lt.torrent_flags.auto_managed)
    except Exception:
        pass


def add_torrent(source, save_path):
    if not source:
        raise Exception("source required")
    if not save_path:
        raise Exception("save_path required")

    os.makedirs(save_path, exist_ok=True)

    # Build add_torrent_params in a way that lets us clear 'paused' / 'auto_managed'.
    try:
        paused_flag = lt.torrent_flags.paused
    except Exception:
        paused_flag = None

    try:
        auto_managed_flag = lt.torrent_flags.auto_managed
    except Exception:
        auto_managed_flag = None

    atp = None

    if isinstance(source, str) and source.lower().endswith(".torrent") and os.path.exists(source):
        ti = lt.torrent_info(source)
        try:
            atp = lt.add_torrent_params()
            atp.ti = ti
            atp.save_path = save_path
        except Exception:
            atp = {"ti": ti, "save_path": save_path}
    else:
        atp = lt.parse_magnet_uri(source)
        try:
            atp.save_path = save_path
        except Exception:
            # parse_magnet_uri may return a dict in some builds
            atp["save_path"] = save_path

    # Clear flags that prevent downloading.
    try:
        if hasattr(atp, "flags"):
            if auto_managed_flag is not None:
                atp.flags &= ~auto_managed_flag
            if paused_flag is not None:
                atp.flags &= ~paused_flag
    except Exception:
        pass

    h = ses.add_torrent(atp)

    # Ensure we are not auto-managed and not paused.
    _ensure_unmanaged(h)
    try:
        h.resume()
    except Exception:
        pass

    ih = _info_hash_str(h.info_hash())
    if ih:
        handles[ih] = h
    return ih


def _get_handle(torrent_id):
    if not torrent_id:
        raise Exception("torrentId required")
    h = handles.get(torrent_id)
    if h is None:
        try:
            for th in ses.get_torrents():
                if _info_hash_str(th.info_hash()) == torrent_id:
                    handles[torrent_id] = th
                    return th
        except Exception:
            pass
        raise Exception("torrent not found")
    return h


def pause_torrent(torrent_id):
    h = _get_handle(torrent_id)
    _ensure_unmanaged(h)
    h.pause()
    return True


def resume_torrent(torrent_id):
    h = _get_handle(torrent_id)
    _ensure_unmanaged(h)
    h.resume()
    return True


def remove_torrent(torrent_id, delete_files=False):
    h = _get_handle(torrent_id)
    opt = 0
    if delete_files:
        try:
            opt = lt.options_t.delete_files
        except Exception:
            opt = 0
    try:
        ses.remove_torrent(h, opt)
    except Exception:
        ses.remove_torrent(h)
    try:
        del handles[torrent_id]
    except Exception:
        pass
    return True


def status_torrent(torrent_id):
    h = _get_handle(torrent_id)
    s = h.status()

    total_wanted = int(getattr(s, "total_wanted", 0) or 0)
    total_done = int(getattr(s, "total_done", 0) or 0)
    download_rate = int(getattr(s, "download_rate", 0) or 0)

    num_peers = int(getattr(s, "num_peers", 0) or 0)
    num_seeds = int(getattr(s, "num_seeds", 0) or 0)

    progress = 0.0
    try:
        progress = float(s.progress) * 100.0
    except Exception:
        if total_wanted > 0:
            progress = (float(total_done) / float(total_wanted)) * 100.0

    remaining = max(0, total_wanted - total_done)
    eta = 0
    if download_rate > 0 and remaining > 0:
        eta = int(remaining / download_rate)

    state = None
    try:
        state = str(s.state)
    except Exception:
        try:
            state = int(s.state)
        except Exception:
            state = None

    is_finished = bool(getattr(s, "is_finished", False))
    has_metadata = bool(getattr(s, "has_metadata", False))

    ih = _info_hash_str(h.info_hash())

    # Stop seeding ASAP once completed.
    if is_finished:
        try:
            _ensure_unmanaged(h)
            h.pause()
        except Exception:
            pass

    return {
        "infoHash": ih,
        "progress": progress,
        "downloadRate": download_rate,
        "totalDone": total_done,
        "totalWanted": total_wanted,
        "eta": eta,
        "peers": num_peers,
        "seeds": num_seeds,
        "state": state,
        "isFinished": is_finished,
        "hasMetadata": has_metadata,
    }


def ping():
    v = None
    try:
        v = lt.__version__
    except Exception:
        try:
            v = lt.version
        except Exception:
            v = None
    return {"ok": True, "libtorrent": v}


METHODS = {
    "ping": lambda params: ping(),
    "add": lambda params: {"infoHash": add_torrent(params.get("source"), params.get("savePath"))},
    "pause": lambda params: pause_torrent(params.get("torrentId")),
    "resume": lambda params: resume_torrent(params.get("torrentId")),
    "remove": lambda params: remove_torrent(params.get("torrentId"), bool(params.get("deleteFiles", False))),
    "status": lambda params: status_torrent(params.get("torrentId")),
}


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue

    req = None
    try:
        req = json.loads(line)
        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}

        if method not in METHODS:
            out = {"id": req_id, "error": {"message": "unknown method"}}
        else:
            res = METHODS[method](params)
            out = {"id": req_id, "result": res}
    except Exception as e:
        out = {
            "id": (req.get("id") if isinstance(req, dict) else None),
            "error": {"message": str(e)},
        }

    sys.stdout.write(json.dumps(out) + "\n")
    sys.stdout.flush()

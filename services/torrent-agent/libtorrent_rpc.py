# -*- coding: utf-8 -*-
"""Minimal torrent agent for OF-Client - MEMORY OPTIMIZED.

Line-delimited JSON RPC over stdin/stdout.
Methods: ping, add, pause, resume, remove, status

Note: Requires python bindings for libtorrent (rasterbar).
"""

import json
import os
import platform
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
                "code": "LIBTORRENT_MISSING",
                "message": "Missing python libtorrent bindings",
                "detail": str(e),
                "traceback": error_detail,
                "python": sys.version.split()[0],
                "platform": platform.platform(),
            }
        )
        + "\n"
    )
    sys.stdout.flush()
    sys.exit(2)


def _env_int(name, default, min_val=None, max_val=None):
    try:
        v = int(os.environ.get(name, "").strip() or default)
        if min_val is not None:
            v = max(min_val, v)
        if max_val is not None:
            v = min(max_val, v)
        return v
    except Exception:
        return default


def _json_dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _write_stdout(obj):
    sys.stdout.write(_json_dumps(obj) + "\n")
    sys.stdout.flush()


def _log(message):
    try:
        sys.stderr.write(str(message) + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _rpc_error(message, code="TORRENT_AGENT_ERROR", **extra):
    err = Exception(str(message))
    err.rpc_code = code
    err.rpc_extra = extra
    return err


listen_port = _env_int("OF_TORRENT_LISTEN_PORT", 6881, 0, 65535)
listen_interfaces = os.environ.get("OF_TORRENT_LISTEN_INTERFACES", "").strip()
if not listen_interfaces:
    listen_interfaces = "0.0.0.0:%d" % listen_port

ses = lt.session({"listen_interfaces": listen_interfaces})

def _apply_settings(settings):
    try:
        ses.apply_settings(settings)
        return True
    except Exception:
        return False


def _apply_settings_compat(settings):
    # Older libtorrent builds may expose set_settings instead of apply_settings
    try:
        setter = getattr(ses, "set_settings", None)
        if callable(setter):
            setter(settings)
            return True
    except Exception:
        return False
    return False


def _apply_settings_safe(settings):
    # Apply settings one-by-one to avoid a single unsupported key
    # invalidating the whole batch.
    for key, value in settings.items():
        applied = False
        try:
            applied = _apply_settings({key: value})
        except Exception:
            applied = False
        if not applied:
            try:
                _apply_settings_compat({key: value})
            except Exception:
                pass

try:
    # Cache: 128MB por padrão — reduz gargalo de disco em swarms rápidos sem exagerar no uso de RAM.
    cache_mb = _env_int("OF_TORRENT_CACHE_MB", 128, 16, 512)
    cache_blocks = int(cache_mb * 64)  # blocos de 16 KiB

    # Always attempt to cap cache size first (even if other keys fail).
    _apply_settings({"cache_size": cache_blocks})
    _apply_settings_compat({"cache_size": cache_blocks})

    _apply_settings_safe(
        {
            # Recursos de rede básicos
            "enable_dht": True,
            "enable_lsd": True,
            "enable_upnp": True,
            "enable_natpmp": True,
            "enable_incoming_tcp": True,
            "enable_outgoing_tcp": True,
            "enable_incoming_utp": True,
            "enable_outgoing_utp": True,
            "prefer_udp_trackers": True,
            "announce_to_all_trackers": True,
            "announce_to_all_tiers": True,
            "use_dht_as_fallback": True,

            # Cache
            "cache_expiry": 60,

            # I/O — buffers maiores evitam gargalo de disco em downloads rápidos
            "max_queued_disk_bytes": 32 * 1024 * 1024,   # 32 MB
            "max_outstanding_disk_bytes": 64 * 1024 * 1024,  # 64 MB

            # Arquivos e conexões
            "file_pool_size": 16,
            "connections_limit": 1000,
            "max_uploads": -1,          # auto — gerenciado pelo unchoke_slots_limit
            "max_peerlist_size": 3000,
            "max_paused_peerlist_size": 200,

            # Velocidade de conexão — quantas novas conexões por segundo
            # qBittorrent usa valores altos; padrão libtorrent é ~10 (muito lento)
            "connection_speed": 200,
            # Extra de conexões logo no início para entrar no swarm rapidamente
            "torrent_connect_boost": 200,

            # Limites de atividade
            "active_downloads": 1,
            "active_seeds": 0,
            "active_limit": 1,

            # Buffers de envio/recepção — maiores para conexões rápidas
            "send_buffer_watermark": 8 * 1024 * 1024,       # 8 MB
            "send_buffer_low_watermark": 512 * 1024,         # 512 KB
            "send_buffer_watermark_factor": 50,
            "recv_socket_buffer_size": 1 * 1024 * 1024,     # 1 MB por socket
            "send_socket_buffer_size": 512 * 1024,           # 512 KB por socket

            # Threads e slots
            "aio_threads": 4,
            # 0 = auto (igual ao qBittorrent padrão) — controla quantos peers recebem
            # upload; mais unchoke slots = melhor tit-for-tat = mais velocidade de download
            "unchoke_slots_limit": 0,
            # 1 = rate_based — peers que enviam mais recebem mais (qBittorrent padrão)
            # Muito mais eficaz que round_robin (0) para maximizar velocidade
            "choking_algorithm": 1,
            "mixed_mode_algorithm": 1,
            "rate_limit_ip_overhead": False,

            # I/O — cache do OS (modo 0) = padrão qBittorrent
            "disk_io_read_mode": 0,
            "disk_io_write_mode": 0,
            # Agrupa escritas/leituras pequenas em operações maiores
            "coalesce_writes": True,
            "coalesce_reads": True,

            # Pipeline de peças — valores maiores melhoram throughput
            "request_queue_time": 3,
            "max_out_request_queue": 500,
            "max_allowed_in_request_queue": 2000,

            # Otimizações adicionais
            "checking_mem_usage": 256,
            "suggest_mode": 0,
            "max_suggest_pieces": 0,
            "whole_pieces_threshold": 20,
        }
    )

    download_limit = _env_int("OF_TORRENT_DOWNLOAD_LIMIT", 0, 0, None)
    upload_limit = _env_int("OF_TORRENT_UPLOAD_LIMIT", 0, 0, None)
    limits = {}
    if download_limit > 0:
        limits["download_rate_limit"] = download_limit
    if upload_limit > 0:
        limits["upload_rate_limit"] = upload_limit
    if limits:
        _apply_settings_safe(limits)
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


def _handle_info_hash(handle):
    try:
        return _info_hash_str(handle.info_hash())
    except Exception:
        pass
    try:
        info_hashes = handle.info_hashes()
        getter = getattr(info_hashes, "get_best", None)
        if callable(getter):
            return _info_hash_str(getter())
    except Exception:
        pass
    return None


def _params_info_hash(atp):
    try:
        if hasattr(atp, "info_hashes"):
            info_hashes = getattr(atp, "info_hashes")
            getter = getattr(info_hashes, "get_best", None)
            if callable(getter):
                return _info_hash_str(getter())
            v1 = getattr(info_hashes, "v1", None)
            if v1:
                return _info_hash_str(v1)
        ih = getattr(atp, "info_hash", None)
        if ih:
            return _info_hash_str(ih)
    except Exception:
        pass
    if isinstance(atp, dict):
        for key in ("info_hash", "infoHash"):
            if atp.get(key):
                return _info_hash_str(atp.get(key))
    return None


def _remember_handle(handle):
    ih = _handle_info_hash(handle)
    if ih:
        handles[ih] = handle
    return ih


def _find_handle_by_info_hash(info_hash):
    if not info_hash:
        return None
    h = handles.get(info_hash)
    if h is not None:
        return h
    try:
        for th in ses.get_torrents():
            if _handle_info_hash(th) == info_hash:
                handles[info_hash] = th
                return th
    except Exception:
        pass
    return None


def _validate_save_path(save_path):
    if not save_path:
        raise _rpc_error("save_path required", "INVALID_SAVE_PATH")
    if os.path.exists(save_path) and not os.path.isdir(save_path):
        raise _rpc_error("Save path is not a directory", "INVALID_SAVE_PATH", path=save_path)

    try:
        os.makedirs(save_path, exist_ok=True)
    except Exception as e:
        raise _rpc_error("Could not create save path: %s" % e, "INVALID_SAVE_PATH", path=save_path)

    probe_path = os.path.join(save_path, ".of_torrent_write_test")
    try:
        with open(probe_path, "w", encoding="utf-8") as f:
            f.write("ok")
        try:
            os.remove(probe_path)
        except Exception:
            pass
    except Exception as e:
        raise _rpc_error("Save path is not writable: %s" % e, "SAVE_PATH_NOT_WRITABLE", path=save_path)


def _free_bytes(path):
    try:
        st = os.statvfs(path)
        return int(st.f_bavail * st.f_frsize)
    except Exception:
        return None


def _ensure_unmanaged(handle):
    try:
        handle.unset_flags(lt.torrent_flags.auto_managed)
    except Exception:
        pass


def _tune_handle_for_download(handle):
    try:
        handle.set_max_connections(1000)
    except Exception:
        pass
    try:
        handle.set_max_uploads(-1)
    except Exception:
        pass
    try:
        handle.force_reannounce()
    except Exception:
        pass
    try:
        handle.force_dht_announce()
    except Exception:
        pass


def add_torrent(source, save_path):
    if not source:
        raise _rpc_error("source required", "INVALID_SOURCE")

    _validate_save_path(save_path)

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
        torrent_info_hash = _info_hash_str(ti.info_hash())
        existing = _find_handle_by_info_hash(torrent_info_hash)
        if existing is not None:
            _ensure_unmanaged(existing)
            _tune_handle_for_download(existing)
            try:
                existing.resume()
            except Exception:
                pass
            return torrent_info_hash
        try:
            atp = lt.add_torrent_params()
            atp.ti = ti
            atp.save_path = save_path
        except Exception:
            atp = {"ti": ti, "save_path": save_path}
    else:
        try:
            atp = lt.parse_magnet_uri(source)
        except Exception as e:
            raise _rpc_error("Invalid magnet/torrent source: %s" % e, "INVALID_SOURCE")

        torrent_info_hash = _params_info_hash(atp)
        existing = _find_handle_by_info_hash(torrent_info_hash)
        if existing is not None:
            _ensure_unmanaged(existing)
            _tune_handle_for_download(existing)
            try:
                existing.resume()
            except Exception:
                pass
            return torrent_info_hash

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

    try:
        h = ses.add_torrent(atp)
    except Exception as e:
        # libtorrent duplicate errors vary by version; try to recover by info hash.
        torrent_info_hash = _params_info_hash(atp)
        existing = _find_handle_by_info_hash(torrent_info_hash)
        if existing is not None:
            _ensure_unmanaged(existing)
            _tune_handle_for_download(existing)
            try:
                existing.resume()
            except Exception:
                pass
            return torrent_info_hash
        raise _rpc_error("Could not add torrent: %s" % e, "ADD_TORRENT_FAILED")

    # Ensure we are not auto-managed and not paused.
    _ensure_unmanaged(h)
    _tune_handle_for_download(h)
    try:
        h.resume()
    except Exception:
        pass

    ih = _remember_handle(h)
    if not ih:
        raise _rpc_error("Torrent added but info hash is unavailable", "MISSING_INFO_HASH")
    return ih


def _get_handle(torrent_id):
    if not torrent_id:
        raise _rpc_error("torrentId required", "INVALID_TORRENT_ID")
    h = _find_handle_by_info_hash(torrent_id)
    if h is None:
        raise _rpc_error("torrent not found", "TORRENT_NOT_FOUND", torrentId=torrent_id)
    return h


def pause_torrent(torrent_id):
    h = _get_handle(torrent_id)
    _ensure_unmanaged(h)
    h.pause()
    return True


def resume_torrent(torrent_id):
    h = _get_handle(torrent_id)
    _ensure_unmanaged(h)
    _tune_handle_for_download(h)
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
    upload_rate = int(getattr(s, "upload_rate", 0) or 0)

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
    state_code = None
    try:
        state_code = int(s.state)
    except Exception:
        try:
            state = str(s.state)
        except Exception:
            state = None
    if state is None and state_code is not None:
        state_names = {
            0: "queued",
            1: "checking",
            2: "downloading_metadata",
            3: "downloading",
            4: "finished",
            5: "seeding",
            6: "allocating",
            7: "checking_resume_data",
        }
        state = state_names.get(state_code, str(state_code))

    is_finished = bool(getattr(s, "is_finished", False))
    has_metadata = bool(getattr(s, "has_metadata", False))
    paused = bool(getattr(s, "paused", False))
    name = ""
    error_message = ""
    try:
        name = str(getattr(s, "name", "") or "")
    except Exception:
        name = ""
    try:
        errc = getattr(s, "errc", None)
        if errc:
            raw_error_message = str(errc.message() if hasattr(errc, "message") else errc).strip()
            error_value = None
            try:
                error_value = int(errc.value()) if hasattr(errc, "value") else None
            except Exception:
                error_value = None
            if raw_error_message and raw_error_message.lower() not in ("success", "no error") and error_value != 0:
                error_message = raw_error_message
    except Exception:
        error_message = ""

    ih = _handle_info_hash(h)

    # Stop seeding ASAP once completed.
    if is_finished:
        try:
            _ensure_unmanaged(h)
            h.pause()
        except Exception:
            pass

    if error_message:
        status_message = "Erro: %s" % error_message
    elif is_finished:
        status_message = "Concluído"
    elif paused:
        status_message = "Pausado"
    elif not has_metadata:
        status_message = "Buscando metadata"
    elif num_peers <= 0 and download_rate <= 0:
        status_message = "Conectando aos peers"
    elif download_rate <= 0:
        status_message = "Aguardando peças"
    else:
        status_message = "Baixando"

    return {
        "infoHash": ih,
        "progress": max(0.0, min(100.0, progress)),
        "downloadRate": download_rate,
        "uploadRate": upload_rate,
        "totalDone": total_done,
        "totalWanted": total_wanted,
        "eta": eta,
        "peers": num_peers,
        "seeds": num_seeds,
        "state": state,
        "stateCode": state_code,
        "statusMessage": status_message,
        "paused": paused,
        "isFinished": is_finished,
        "hasMetadata": has_metadata,
        "errorMessage": error_message or None,
        "name": name or None,
        "savePath": getattr(s, "save_path", None) or None,
        "freeBytes": _free_bytes(getattr(s, "save_path", None) or "."),
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
    return {
        "ok": True,
        "libtorrent": v,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "listenInterfaces": listen_interfaces,
        "torrents": len(handles),
    }


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
        if len(line) > 1024 * 1024:
            raise _rpc_error("request too large", "REQUEST_TOO_LARGE")
        req = json.loads(line)
        if not isinstance(req, dict):
            raise _rpc_error("request must be a JSON object", "INVALID_REQUEST")
        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        if not isinstance(params, dict):
            raise _rpc_error("params must be an object", "INVALID_PARAMS")

        if method not in METHODS:
            out = {"id": req_id, "error": {"message": "unknown method", "code": "UNKNOWN_METHOD"}}
        else:
            res = METHODS[method](params)
            out = {"id": req_id, "result": res}
    except Exception as e:
        code = getattr(e, "rpc_code", "TORRENT_AGENT_ERROR")
        extra = getattr(e, "rpc_extra", {}) or {}
        _log("RPC error [%s]: %s" % (code, str(e)))
        out = {
            "id": (req.get("id") if isinstance(req, dict) else None),
            "error": {"message": str(e), "code": code, **extra},
        }

    _write_stdout(out)

#!/usr/bin/env python3
"""
Servidor de Desenvolvimento Local — Cooperativa Plataforma
============================================================
Stack: Python 3 + Flask + sqlite3 (nativo, zero dependências externas além do Flask)

Substitui em localhost:4747:
  - Cloudflare Worker (sinalização WebRTC / nonce SIWE)
  - Polygon Blockchain (registro de identidade)
  - Mensageria P2P mock

Uso:
  pip install flask
  python3 server.py
  python3 server.py --port 4747
"""

import sys
import os
import sqlite3
import json
import secrets
import time
import socket
import argparse
import threading
from contextlib import contextmanager
from datetime import datetime
from flask import Flask, request, jsonify, Response, send_from_directory
from demo_routing import get_demo_route, get_live_route
from demo_fares import estimate_fare
from werkzeug.serving import make_server

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ─── Configuração ──────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=int(os.environ.get("DEV_SERVER_PORT", 4747)))
args, _ = parser.parse_known_args()

PORT = args.port
WEB_PORT = int(os.environ.get("DEMO_WEB_PORT", "8085"))
INSTANCE_ID = os.environ.get("DEMO_INSTANCE_ID", "")
DB_PATH = os.path.join(os.path.dirname(__file__), "demo-data.sqlite")
SESSION_TTL = 5 * 60  # segundos
DEMO_SERVER_VERSION = "ride-fare-v6"

DEMO_DRIVER_DID = "0x1563915e194D8CfBA1943570603F7606A3115508"
DEMO_CLIENT_DID = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A"
DEMO_AUTOPILOT_STEP_SECONDS = float(os.environ.get("DEMO_AUTOPILOT_STEP_SECONDS", "2.0"))

# Trajeto comprimido para a demonstração: aproximação do passageiro e viagem.
DEMO_PICKUP_ROUTE = [
    (-23.5489, -46.6388),
    (-23.5495, -46.6420),
    (-23.5500, -46.6450),
    (-23.5505, -46.6490),
    (-23.5510, -46.6520),
    (-23.5516, -46.6545),
    (-23.5524, -46.6555),
    (-23.5533, -46.6558),
]
DEMO_TRIP_ROUTE = [
    (-23.5533, -46.6558),
    (-23.5550, -46.6590),
    (-23.5572, -46.6630),
    (-23.5590, -46.6675),
    (-23.5610, -46.6720),
    (-23.5630, -46.6765),
    (-23.5650, -46.6810),
    (-23.5670, -46.6850),
]

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
_db_lock = threading.Lock()
_demo_pilots = {}

# ─── SQLite ────────────────────────────────────────────────────────────────────

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def seed_demo_data():
    with get_db() as conn:
        driver_meta = json.dumps({
            "role": "driver",
            "displayName": "Carlos Silva",
            "vehicle": "Toyota Corolla Cinza (ABC-1D23)",
            "rating": 4.95,
            "rides": 142,
            "version": "1.0"
        })
        client_meta = json.dumps({
            "role": "client",
            "displayName": "Vitor Maia",
            "rating": 5.0,
            "rides": 28,
            "version": "1.0"
        })
        conn.execute(
            "INSERT OR REPLACE INTO identities (did, metadata, registered, created_at) VALUES (?, ?, 1, ?)",
            (DEMO_DRIVER_DID, driver_meta, time.time())
        )
        conn.execute(
            "INSERT OR REPLACE INTO identities (did, metadata, registered, created_at) VALUES (?, ?, 1, ?)",
            (DEMO_CLIENT_DID, client_meta, time.time())
        )

def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS signaling (
                key     TEXT PRIMARY KEY,
                value   TEXT NOT NULL,
                expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS identities (
                did         TEXT PRIMARY KEY COLLATE NOCASE,
                metadata    TEXT NOT NULL,
                registered  INTEGER NOT NULL DEFAULT 1,
                created_at  REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS p2p_sessions (
                session_id  TEXT PRIMARY KEY,
                caller      TEXT NOT NULL COLLATE NOCASE,
                callee      TEXT NOT NULL COLLATE NOCASE,
                state       TEXT NOT NULL DEFAULT 'calling',
                created_at  REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS p2p_messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT NOT NULL,
                from_did    TEXT NOT NULL COLLATE NOCASE,
                to_did      TEXT NOT NULL COLLATE NOCASE,
                payload     TEXT NOT NULL,
                ts          REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS nonces (
                nonce       TEXT PRIMARY KEY,
                created_at  REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS fare_quotes (
                quote_id TEXT PRIMARY KEY,
                caller TEXT NOT NULL COLLATE NOCASE,
                callee TEXT NOT NULL COLLATE NOCASE,
                fare TEXT NOT NULL,
                expires REAL NOT NULL
            );
        """)
        # Migração aditiva: preserva as corridas e identidades já existentes.
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(p2p_sessions)")}
        if "fare" not in columns:
            conn.execute("ALTER TABLE p2p_sessions ADD COLUMN fare TEXT")
    seed_demo_data()

def clean_expired():
    now = time.time()
    with get_db() as conn:
        conn.execute("DELETE FROM signaling WHERE expires < ?", (now,))
        conn.execute("DELETE FROM nonces WHERE created_at < ?", (now - 600,))
        conn.execute("DELETE FROM fare_quotes WHERE expires < ?", (now,))
        conn.execute("DELETE FROM p2p_messages WHERE ts < ?", ((now - 1800) * 1000,))


def insert_p2p_payload(session_id, from_did, to_did, payload):
    """Entrega uma mensagem usando exatamente o envelope consumido pelo app."""
    payload = dict(payload)
    payload.setdefault("timestamp", int(time.time() * 1000))
    with get_db() as conn:
        conn.execute(
            "INSERT INTO p2p_messages (session_id, from_did, to_did, payload, ts) VALUES (?, ?, ?, ?, ?)",
            (session_id, from_did, to_did, json.dumps(payload), time.time() * 1000),
        )


def stop_demo_pilot(session_id):
    pilot = _demo_pilots.pop(session_id, None)
    if pilot:
        pilot["stop"].set()
        thread = pilot.get("thread")
        if thread and thread is not threading.current_thread():
            thread.join(timeout=2)


def start_demo_driver_pilot(session_id, passenger_did):
    """Executa o comportamento do motorista sem acrescentar controles à UI mobile."""
    stop_demo_pilot(session_id)
    stop_event = threading.Event()

    def wait(steps=1.0):
        return stop_event.wait(DEMO_AUTOPILOT_STEP_SECONDS * steps)

    def emit(payload):
        if stop_event.is_set():
            return False
        insert_p2p_payload(session_id, DEMO_DRIVER_DID, passenger_did, payload)
        return True

    def drive_route(route, speed):
        for index, (latitude, longitude) in enumerate(route):
            if wait(1.0):
                return False
            next_point = route[min(index + 1, len(route) - 1)]
            heading = 0.0
            if next_point != (latitude, longitude):
                import math
                heading = (
                    math.degrees(
                        math.atan2(next_point[1] - longitude, next_point[0] - latitude)
                    )
                    + 360
                ) % 360
            if not emit({
                "type": "location",
                "latitude": latitude,
                "longitude": longitude,
                "speed": speed,
                "heading": heading,
            }):
                return False
        return True

    def run():
        try:
            if wait(0.5):
                return
            with get_db() as conn:
                conn.execute(
                    "UPDATE p2p_sessions SET state = 'active' WHERE session_id = ?",
                    (session_id,),
                )
            emit({"type": "status", "status": "accepted"})

            if wait(0.7):
                return
            emit({
                "type": "message",
                "text": "Olá! Corrida aceita. Já estou a caminho.",
                "senderId": DEMO_DRIVER_DID,
            })

            if not drive_route(DEMO_PICKUP_ROUTE, 10.5):
                return
            emit({"type": "status", "status": "arrived"})
            emit({
                "type": "message",
                "text": "Cheguei ao local de embarque.",
                "senderId": DEMO_DRIVER_DID,
            })

            if wait(3.0):
                return
            emit({"type": "status", "status": "in_progress"})
            emit({
                "type": "message",
                "text": "Viagem iniciada. Seguiremos pela melhor rota.",
                "senderId": DEMO_DRIVER_DID,
            })

            if not drive_route(DEMO_TRIP_ROUTE, 12.0):
                return
            if wait(1.0):
                return
            emit({"type": "status", "status": "completed"})
            emit({
                "type": "message",
                "text": "Viagem concluída. Obrigado por usar a Cooperativa!",
                "senderId": DEMO_DRIVER_DID,
            })
            with get_db() as conn:
                conn.execute(
                    "UPDATE p2p_sessions SET state = 'completed' WHERE session_id = ?",
                    (session_id,),
                )
        finally:
            current = _demo_pilots.get(session_id)
            if current and current.get("stop") is stop_event:
                _demo_pilots.pop(session_id, None)

    thread = threading.Thread(target=run, daemon=True, name=f"demo-driver-{session_id[:12]}")
    _demo_pilots[session_id] = {"thread": thread, "stop": stop_event}
    thread.start()


def schedule_demo_driver_reply(session_id, passenger_did, text):
    pilot = _demo_pilots.get(session_id)
    if not pilot:
        return
    stop_event = pilot["stop"]

    normalized = text.lower()
    if "portaria" in normalized or "esper" in normalized:
        reply = "Perfeito, aviso assim que eu chegar."
    elif "obrig" in normalized:
        reply = "Por nada! Até já."
    else:
        reply = "Mensagem recebida. Estou a caminho."

    def send_reply():
        if stop_event.wait(min(0.8, DEMO_AUTOPILOT_STEP_SECONDS)):
            return
        with get_db() as conn:
            row = conn.execute(
                "SELECT state FROM p2p_sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
        if row and row["state"] not in ("disconnected", "completed"):
            insert_p2p_payload(
                session_id,
                DEMO_DRIVER_DID,
                passenger_did,
                {"type": "message", "text": reply, "senderId": DEMO_DRIVER_DID},
            )

    threading.Thread(target=send_reply, daemon=True).start()

# ─── KV helpers (compatível com o Worker) ─────────────────────────────────────

def kv_set(key, value):
    expires = time.time() + SESSION_TTL
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO signaling (key, value, expires) VALUES (?, ?, ?)",
            (key, json.dumps(value), expires)
        )

def kv_get(key):
    with get_db() as conn:
        row = conn.execute(
            "SELECT value, expires FROM signaling WHERE key = ?", (key,)
        ).fetchone()
    if not row:
        return None
    if time.time() > row["expires"]:
        kv_del(key)
        return None
    return json.loads(row["value"])

def kv_del(key):
    with get_db() as conn:
        conn.execute("DELETE FROM signaling WHERE key = ?", (key,))

def kv_keys():
    clean_expired()
    with get_db() as conn:
        rows = conn.execute("SELECT key FROM signaling").fetchall()
    return [r["key"] for r in rows]

# ─── CORS ──────────────────────────────────────────────────────────────────────

@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

@app.route("/", defaults={"path": ""}, methods=["OPTIONS"])
@app.route("/<path:path>", methods=["OPTIONS"])
def options(_path=""):
    return Response("", 204)

def j(data, status=200):
    return jsonify(data), status

# ─── Endpoints compatíveis com Cloudflare Worker ───────────────────────────────

@app.get("/nonce")
def get_nonce():
    nonce = secrets.token_hex(16)
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO nonces (nonce, created_at) VALUES (?, ?)",
                     (nonce, time.time()))
    return j({"nonce": nonce})

@app.get("/health")
def health():
    with get_db() as conn:
        sessions = conn.execute(
            "SELECT COUNT(*) as c FROM p2p_sessions WHERE state IN ('calling', 'active')"
        ).fetchone()["c"]
        identities = conn.execute("SELECT COUNT(*) as c FROM identities").fetchone()["c"]
    return j({
        "ok": True,
        "mode": "dev-local",
        "server": "cooperativa-dev-server",
        "demo_version": DEMO_SERVER_VERSION,
        "port": PORT,
        "instance_id": INSTANCE_ID,
        "active_sessions": sessions,
        "registered_identities": identities,
    })

@app.post("/signal")
def post_signal():
    b = request.get_json(silent=True) or {}
    if not b.get("sessionId") or not b.get("type") or not b.get("from"):
        return j({"error": "missing fields"}, 400)
    if len(json.dumps(b)) > 8192:
        return j({"error": "too large"}, 413)

    sig_type = b["type"]
    to = b.get("to") or b["from"]
    key = f"{b['sessionId']}:{sig_type}:{to}"

    if sig_type == "ice":
        existing = kv_get(key) or []
        existing.append(b.get("candidate"))
        kv_set(key, existing)
    else:
        kv_set(key, {"sdp": b.get("sdp"), "from": b["from"]})

    return j({"success": True, "key": key})

@app.get("/signal")
def get_signal():
    session_id = request.args.get("sessionId")
    sig_type = request.args.get("type")
    to = request.args.get("to")
    if not session_id or not sig_type or not to:
        return j({"error": "missing params"}, 400)
    key = f"{session_id}:{sig_type}:{to}"
    raw = kv_get(key)
    if raw is None:
        return j({"payload": None})
    if sig_type == "ice":
        kv_del(key)
        return j({"payload": {"candidates": raw}})
    return j({"payload": raw})

@app.get("/incoming")
def get_incoming():
    to = request.args.get("to")
    if not to:
        return j({"error": "missing ?to"}, 400)
    suffix = f":offer:{to.lower()}"
    match = next((k for k in kv_keys() if k.lower().endswith(suffix)), None)
    if not match:
        return j({"offer": None})
    raw = kv_get(match)
    if not raw:
        return j({"offer": None})
    session_id = match.split(":offer:")[0]
    return j({"offer": raw, "sessionId": session_id})

# ─── Endpoints exclusivos do modo dev ─────────────────────────────────────────

def new_fare_quote():
    # Somente o trecho embarque → destino entra no preço. Não usa o tempo
    # acelerado da animação nem a aproximação do motorista.
    fare = estimate_fare(get_demo_route("trip"))
    fare.update(quoteId=secrets.token_hex(16), expiresAt=int((time.time() + 600) * 1000))
    return fare


@app.post("/mock/fare/quote")
def mock_fare_quote():
    b = request.get_json(silent=True) or {}
    caller, callee = b.get("caller"), b.get("callee")
    if not all(isinstance(did, str) and did.strip() for did in (caller, callee)):
        return j({"error": "Informe passageiro e motorista para estimar a corrida."}, 400)
    fare = new_fare_quote()
    with get_db() as conn:
        conn.execute("DELETE FROM fare_quotes WHERE expires < ?", (time.time(),))
        conn.execute("INSERT INTO fare_quotes VALUES (?, ?, ?, ?, ?)",
                     (fare["quoteId"], caller, callee, json.dumps(fare), fare["expiresAt"] / 1000))
    return j({"fare": fare})

@app.post("/mock/register")
def mock_register():
    b = request.get_json(silent=True) or {}
    did = b.get("did")
    metadata = b.get("metadata")
    if not did or not metadata:
        return j({"error": "missing did or metadata"}, 400)
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO identities (did, metadata, registered, created_at) VALUES (?, ?, 1, ?)",
            (did, metadata, time.time())
        )
    tx_hash = "0x" + secrets.token_hex(32)
    return j({"ok": True, "did": did, "txHash": tx_hash})

@app.get("/mock/identity/<did>")
def mock_get_identity(did):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM identities WHERE did = ? COLLATE NOCASE", (did,)).fetchone()
    if not row:
        return j({"registered": False})
    metadata = None
    try:
        metadata = json.loads(row["metadata"])
    except Exception:
        pass
    return j({"registered": True, "did": row["did"], "metadata": metadata,
              "created_at": row["created_at"]})

@app.post("/mock/p2p/call")
def mock_p2p_call():
    b = request.get_json(silent=True) or {}
    session_id = b.get("sessionId")
    caller = b.get("caller")
    callee = b.get("callee")
    manual_peer = bool(b.get("manualPeer"))
    if not session_id or not caller or not callee:
        return j({"error": "missing fields"}, 400)
    quote_id = b.get("fareQuoteId")
    if quote_id:
        with get_db() as conn:
            quote = conn.execute("SELECT * FROM fare_quotes WHERE quote_id = ?", (quote_id,)).fetchone()
        if not quote or quote["expires"] < time.time():
            return j({"error": "Estimativa expirada. Calcule o preço novamente antes de chamar."}, 409)
        if quote["caller"].lower() != caller.lower() or quote["callee"].lower() != callee.lower():
            return j({"error": "Esta estimativa pertence a outra chamada."}, 409)
        fare = json.loads(quote["fare"])
    else:
        # Compatibilidade com o painel e os roteiros anteriores.
        fare = new_fare_quote()
    stop_demo_pilot(session_id)
    with get_db() as conn:
        conn.execute("DELETE FROM p2p_messages WHERE session_id = ?", (session_id,))
        conn.execute(
            "INSERT OR REPLACE INTO p2p_sessions (session_id, caller, callee, state, created_at, fare) VALUES (?, ?, ?, 'calling', ?, ?)",
            (session_id, caller, callee, time.time(), json.dumps(fare))
        )
    # Registra no KV para notificar a tela incoming-call do destinatário em tempo real
    kv_set(f"{session_id}:offer:{callee}", {
        "sdp": {"type": "offer", "sdp": "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"},
        "from": caller, "fare": fare
    })
    auto_accepted = callee.lower() == DEMO_DRIVER_DID.lower() and not manual_peer
    if auto_accepted:
        start_demo_driver_pilot(session_id, caller)
    return j({
        "ok": True,
        "sessionId": session_id,
        "autoAccepted": auto_accepted,
        "peerMode": "manual" if manual_peer else "automatic",
        "fare": fare,
    })

@app.get("/mock/p2p/session/<session_id>")
def mock_p2p_session(session_id):
    """Expõe somente o estado necessário para reproduzir a negociação P2P."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT session_id, caller, callee, state, fare FROM p2p_sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
    if not row:
        return j({"error": "session not found"}, 404)
    result = dict(row)
    result["fare"] = json.loads(result["fare"]) if result["fare"] else None
    return j(result)

@app.post("/mock/p2p/answer")
def mock_p2p_answer():
    b = request.get_json(silent=True) or {}
    session_id = b.get("sessionId")
    if not session_id:
        return j({"error": "missing sessionId"}, 400)
    with get_db() as conn:
        row = conn.execute("SELECT caller, callee, state, fare FROM p2p_sessions WHERE session_id = ?", (session_id,)).fetchone()
        if not row:
            return j({"error": "Chamada não encontrada."}, 404)
        if row["state"] not in ("calling", "active"):
            return j({"error": "Esta chamada já foi encerrada."}, 409)
        fare = json.loads(row["fare"]) if row["fare"] else None
        if b.get("fareQuoteId") and (not fare or b["fareQuoteId"] != fare["quoteId"]):
            return j({"error": "Esta oferta mudou. Aguarde uma nova chamada para conferir o preço."}, 409)
        conn.execute("UPDATE p2p_sessions SET state = 'active' WHERE session_id = ?", (session_id,))
        # Usa a mesma conexão para não bloquear a transação no Windows.
        conn.execute("DELETE FROM signaling WHERE key = ?", (f"{session_id}:offer:{row['callee']}",))
    return j({"ok": True, "fare": fare})

@app.post("/mock/demo/trigger_call")
def mock_demo_trigger_call():
    """Dispara uma chamada P2P do passageiro Vitor para o motorista Carlos"""
    session_id = f"demo_session_{int(time.time())}"
    caller = DEMO_CLIENT_DID
    callee = DEMO_DRIVER_DID
    fare = new_fare_quote()
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO p2p_sessions (session_id, caller, callee, state, created_at, fare) VALUES (?, ?, ?, 'calling', ?, ?)",
            (session_id, caller, callee, time.time(), json.dumps(fare))
        )
    kv_set(f"{session_id}:offer:{callee}", {
        "sdp": {"type": "offer", "sdp": "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"},
        "from": caller, "fare": fare
    })
    return j({"ok": True, "sessionId": session_id, "caller": caller, "callee": callee, "message": "Chamada enviada para Carlos Silva!"})

@app.post("/mock/demo/quick_message")
def mock_demo_quick_message():
    """Injeta mensagem do motorista para o passageiro na sessão ativa"""
    b = request.get_json(silent=True) or {}
    text = b.get("text", "Olá! Já estou a caminho.")
    with get_db() as conn:
        row = conn.execute("SELECT * FROM p2p_sessions WHERE state IN ('calling', 'active') ORDER BY created_at DESC LIMIT 1").fetchone()
        if not row:
            session_id = f"demo_session_{int(time.time())}"
            conn.execute(
                "INSERT OR REPLACE INTO p2p_sessions (session_id, caller, callee, state, created_at) VALUES (?, ?, ?, 'active', ?)",
                (session_id, DEMO_CLIENT_DID, DEMO_DRIVER_DID, time.time())
            )
            session_id_to_use = session_id
            to_did = DEMO_CLIENT_DID
        else:
            session_id_to_use = row["session_id"]
            to_did = row["caller"]

        payload = {
            "type": "message",
            "text": text,
            "senderId": DEMO_DRIVER_DID,
            "timestamp": int(time.time() * 1000)
        }
        conn.execute(
            "INSERT INTO p2p_messages (session_id, from_did, to_did, payload, ts) VALUES (?, ?, ?, ?, ?)",
            (session_id_to_use, DEMO_DRIVER_DID, to_did, json.dumps(payload), time.time() * 1000)
        )
    return j({"ok": True, "sessionId": session_id_to_use, "text": text})

@app.post("/mock/demo/advance_status")
def mock_demo_advance_status():
    """Atualiza o status da corrida (arrived, in_progress, completed)"""
    b = request.get_json(silent=True) or {}
    status = b.get("status", "arrived")
    with get_db() as conn:
        row = conn.execute("SELECT * FROM p2p_sessions WHERE state IN ('calling', 'active') ORDER BY created_at DESC LIMIT 1").fetchone()
        if not row:
            return j({"error": "nenhuma sessão ativa"}, 404)
        session_id_to_use = row["session_id"]
        to_did = row["caller"]
        payload = {
            "type": "status",
            "status": status,
            "timestamp": int(time.time() * 1000)
        }
        conn.execute(
            "INSERT INTO p2p_messages (session_id, from_did, to_did, payload, ts) VALUES (?, ?, ?, ?, ?)",
            (session_id_to_use, DEMO_DRIVER_DID, to_did, json.dumps(payload), time.time() * 1000)
        )
    return j({"ok": True, "status": status})

@app.post("/mock/p2p/send")
def mock_p2p_send():
    b = request.get_json(silent=True) or {}
    session_id = b.get("sessionId")
    from_did = b.get("from")
    payload = b.get("payload")
    if not session_id or not from_did or not payload:
        return j({"error": "missing fields"}, 400)
    with get_db() as conn:
        row = conn.execute("SELECT * FROM p2p_sessions WHERE session_id = ?",
                           (session_id,)).fetchone()
        if not row:
            return j({"error": "session not found"}, 404)
        to_did = row["callee"] if row["caller"].lower() == from_did.lower() else row["caller"]
        conn.execute(
            "INSERT INTO p2p_messages (session_id, from_did, to_did, payload, ts) VALUES (?, ?, ?, ?, ?)",
            (session_id, from_did, to_did, json.dumps(payload), time.time() * 1000)
        )
        terminal_status = payload.get("type") == "status" and payload.get("status") in ("completed", "cancelled")
        if terminal_status:
            conn.execute(
                "UPDATE p2p_sessions SET state = ? WHERE session_id = ?",
                (payload.get("status"), session_id),
            )

    if terminal_status:
        stop_demo_pilot(session_id)
    elif (
        payload.get("type") == "message"
        and row["callee"].lower() == DEMO_DRIVER_DID.lower()
        and row["caller"].lower() == from_did.lower()
    ):
        schedule_demo_driver_reply(session_id, from_did, str(payload.get("text", "")))
    return j({"ok": True})

@app.get("/mock/p2p/receive")
def mock_p2p_receive():
    session_id = request.args.get("sessionId")
    to = request.args.get("to")
    since = float(request.args.get("since", 0))
    if not session_id or not to:
        return j({"payloads": []})
    with get_db() as conn:
        msgs = conn.execute(
            "SELECT payload, ts FROM p2p_messages WHERE session_id = ? AND to_did = ? COLLATE NOCASE AND ts > ? ORDER BY ts ASC LIMIT 50",
            (session_id, to, since)
        ).fetchall()
    payloads = [{"payload": json.loads(m["payload"]), "ts": m["ts"]} for m in msgs]
    return j({"payloads": payloads})

@app.post("/mock/p2p/inject")
def mock_p2p_inject():
    b = request.get_json(silent=True) or {}
    session_id = b.get("sessionId")
    target_did = b.get("targetDid")
    payload = b.get("payload")
    if not session_id or not target_did or not payload:
        return j({"error": "missing fields"}, 400)
    payload["timestamp"] = payload.get("timestamp") or int(time.time() * 1000)
    with get_db() as conn:
        conn.execute(
            "INSERT INTO p2p_messages (session_id, from_did, to_did, payload, ts) VALUES (?, ?, ?, ?, ?)",
            (session_id, "dev-panel", target_did, json.dumps(payload), time.time() * 1000)
        )
    return j({"ok": True, "injected": payload})

@app.post("/mock/p2p/disconnect")
def mock_p2p_disconnect():
    b = request.get_json(silent=True) or {}
    session_id = b.get("sessionId")
    if session_id:
        stop_demo_pilot(session_id)
        with get_db() as conn:
            conn.execute("UPDATE p2p_sessions SET state = 'disconnected' WHERE session_id = ?",
                         (session_id,))
    return j({"ok": True})

@app.get("/mock/sessions")
def mock_sessions():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM p2p_sessions ORDER BY created_at DESC LIMIT 50").fetchall()
    return j({"sessions": [dict(r) for r in rows]})

@app.get("/mock/identities")
def mock_identities():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM identities ORDER BY created_at DESC").fetchall()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["metadata"] = json.loads(d["metadata"])
        except Exception:
            d["metadata"] = None
        result.append(d)
    return j({"identities": result})

@app.get("/mock/messages")
def mock_messages():
    session_id = request.args.get("sessionId")
    if not session_id:
        return j({"messages": []})
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM p2p_messages WHERE session_id = ? ORDER BY ts DESC LIMIT 100",
            (session_id,)
        ).fetchall()
    msgs = []
    for r in rows:
        d = dict(r)
        try:
            d["payload"] = json.loads(d["payload"])
        except Exception:
            pass
        msgs.append(d)
    return j({"messages": msgs})

def reset_demo_data():
    for session_id in list(_demo_pilots.keys()):
        stop_demo_pilot(session_id)
    for simulation in list(_active_sims.values()):
        simulation["stop"].set()
    _active_sims.clear()
    with get_db() as conn:
        conn.executescript("""
            DELETE FROM signaling;
            DELETE FROM identities;
            DELETE FROM p2p_sessions;
            DELETE FROM p2p_messages;
            DELETE FROM nonces;
            DELETE FROM fare_quotes;
            DELETE FROM sqlite_sequence WHERE name = 'p2p_messages';
        """)
    seed_demo_data()


@app.route("/mock/reset", methods=["POST", "DELETE"])
def mock_reset():
    reset_demo_data()
    return j({"ok": True, "message": "Banco de dados resetado com perfis de demonstração (Carlos Silva e Vitor Maia)."})

# ─── Endpoints de Mapa / Simulação de Trajeto ─────────────────────────────────
# Rotas reais em SP para simular motorista em movimento no mapa

MAP_ROUTES = {
    "consolacao_pinheiros": [
        {"lat": -23.5505, "lng": -46.6558},
        {"lat": -23.5520, "lng": -46.6590},
        {"lat": -23.5540, "lng": -46.6630},
        {"lat": -23.5560, "lng": -46.6680},
        {"lat": -23.5580, "lng": -46.6720},
        {"lat": -23.5600, "lng": -46.6760},
        {"lat": -23.5620, "lng": -46.6800},
        {"lat": -23.5640, "lng": -46.6830},
    ],
    "madalena_jardins": [
        {"lat": -23.5545, "lng": -46.6900},
        {"lat": -23.5530, "lng": -46.6850},
        {"lat": -23.5515, "lng": -46.6800},
        {"lat": -23.5500, "lng": -46.6750},
        {"lat": -23.5485, "lng": -46.6700},
        {"lat": -23.5470, "lng": -46.6650},
        {"lat": -23.5460, "lng": -46.6600},
        {"lat": -23.5450, "lng": -46.6558},
    ],
    "centro_paulista": [
        {"lat": -23.5489, "lng": -46.6388},
        {"lat": -23.5495, "lng": -46.6420},
        {"lat": -23.5500, "lng": -46.6450},
        {"lat": -23.5505, "lng": -46.6490},
        {"lat": -23.5510, "lng": -46.6520},
        {"lat": -23.5516, "lng": -46.6545},
        {"lat": -23.5524, "lng": -46.6555},
        {"lat": -23.5533, "lng": -46.6558},
    ],
    "itaim_faria_lima": [
        {"lat": -23.5780, "lng": -46.6780},
        {"lat": -23.5765, "lng": -46.6820},
        {"lat": -23.5750, "lng": -46.6845},
        {"lat": -23.5730, "lng": -46.6870},
        {"lat": -23.5710, "lng": -46.6890},
        {"lat": -23.5690, "lng": -46.6900},
        {"lat": -23.5670, "lng": -46.6895},
        {"lat": -23.5650, "lng": -46.6880},
    ],
}

# Estado das simulações em andamento (em memória)
_active_sims = {}  # session_id -> { thread, stop_event }

@app.get("/mock/map/routes")
def mock_map_routes():
    """Lista rotas disponíveis para simulação"""
    routes_info = {}
    for key, points in MAP_ROUTES.items():
        routes_info[key] = {
            "name": key.replace("_", " → ").title(),
            "points": len(points),
            "start": points[0],
            "end": points[-1],
        }
    return j({"routes": routes_info})

@app.post("/mock/map/simulate")
def mock_map_simulate():
    """
    Inicia simulação de trajeto no mapa.
    Envia atualizações de localização com intervalo configurável.
    Body: { sessionId, targetDid, routeKey, intervalMs?, loop? }
    """
    import threading
    import math
    import random

    b = request.get_json(silent=True) or {}
    session_id = b.get("sessionId")
    target_did = b.get("targetDid")
    route_key = b.get("routeKey", "consolacao_pinheiros")
    interval_ms = max(500, min(10000, int(b.get("intervalMs", 2000))))
    loop = bool(b.get("loop", False))

    if not session_id or not target_did:
        return j({"error": "missing sessionId or targetDid"}, 400)

    route = MAP_ROUTES.get(route_key)
    if not route:
        return j({"error": f"route '{route_key}' not found. Available: {list(MAP_ROUTES.keys())}"}, 400)

    # Para simulação anterior desta sessão, se houver
    if session_id in _active_sims:
        _active_sims[session_id]["stop"].set()

    stop_event = threading.Event()
    _active_sims[session_id] = {"stop": stop_event, "route": route_key}

    def run_sim():
        step = 0
        while not stop_event.is_set():
            if step >= len(route):
                if loop:
                    step = 0
                else:
                    _active_sims.pop(session_id, None)
                    break

            point = route[step]
            # Adiciona leve ruído para parecer GPS real
            lat = point["lat"] + (random.random() - 0.5) * 0.0003
            lng = point["lng"] + (random.random() - 0.5) * 0.0003

            # Calcula heading para o próximo ponto
            heading = 0.0
            if step < len(route) - 1:
                nxt = route[step + 1]
                d_lng = nxt["lng"] - point["lng"]
                d_lat = nxt["lat"] - point["lat"]
                heading = (math.degrees(math.atan2(d_lng, d_lat)) + 360) % 360

            payload = {
                "type": "location",
                "latitude": lat,
                "longitude": lng,
                "speed": 8 + random.random() * 6,   # 8–14 m/s (≈ 30–50 km/h)
                "heading": heading,
                "timestamp": int(time.time() * 1000),
            }

            try:
                with get_db() as conn:
                    row = conn.execute(
                        "SELECT * FROM p2p_sessions WHERE session_id = ?", (session_id,)
                    ).fetchone()
                    if row:
                        conn.execute(
                            "INSERT INTO p2p_messages (session_id, from_did, to_did, payload, ts) VALUES (?, ?, ?, ?, ?)",
                            (session_id, "map-sim", target_did, json.dumps(payload), time.time() * 1000)
                        )
            except Exception as e:
                print(f"[map-sim] erro ao gravar: {e}")

            step += 1
            stop_event.wait(interval_ms / 1000)

    t = threading.Thread(target=run_sim, daemon=True)
    t.start()
    _active_sims[session_id]["thread"] = t

    return j({
        "ok": True,
        "sessionId": session_id,
        "targetDid": target_did,
        "route": route_key,
        "points": len(route),
        "intervalMs": interval_ms,
        "loop": loop,
    })

@app.post("/mock/map/stop")
def mock_map_stop():
    """Para simulação de trajeto de uma sessão"""
    b = request.get_json(silent=True) or {}
    session_id = b.get("sessionId")
    if not session_id:
        return j({"error": "missing sessionId"}, 400)
    if session_id in _active_sims:
        _active_sims[session_id]["stop"].set()
        _active_sims.pop(session_id, None)
    return j({"ok": True, "stopped": session_id})

@app.get("/mock/map/active")
def mock_map_active():
    """Lista simulações de mapa ativas"""
    active = [
        {"sessionId": sid, "route": info.get("route", "?")}
        for sid, info in _active_sims.items()
        if not info["stop"].is_set()
    ]
    return j({"active": active, "count": len(active)})

# ─── Mapa real da sessão web ───────────────────────────────────────────────────

@app.get("/mock/map/route")
def demo_live_route():
    """Rota pelas ruas a partir das coordenadas reais do GPS do aparelho."""
    def parse_pair(raw):
        try:
            latitude_text, longitude_text = raw.split(",", 1)
            latitude = float(latitude_text)
            longitude = float(longitude_text)
        except (AttributeError, ValueError):
            raise ValueError("coordenadas inválidas")
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise ValueError("coordenadas inválidas")
        return (longitude, latitude)

    try:
        origin = parse_pair(request.args.get("from"))
        destination = parse_pair(request.args.get("to"))
    except ValueError as error:
        return j({"error": str(error)}, 400)

    phase = request.args.get("phase", "trip")
    if phase not in ("pickup", "trip"):
        phase = "trip"
    try:
        return j(get_live_route(origin, destination, phase))
    except ValueError as error:
        return j({"error": str(error)}, 400)


@app.get("/mock/map/route/<phase>")
def demo_street_route(phase):
    if phase not in ("pickup", "trip"):
        return j({"error": "invalid route phase"}, 400)
    return j(get_demo_route(phase))

@app.get("/mock/map/view")
def demo_map_view():
    return send_from_directory(os.path.join(app.root_path, "static"), "ride-map.html")

@app.get("/mock/map/leaflet/<path:filename>")
def demo_map_library(filename):
    library = os.path.abspath(os.path.join(app.root_path, "..", "mobile", "node_modules", "leaflet", "dist"))
    return send_from_directory(library, filename, max_age=86400)

# ─── Painel Web ────────────────────────────────────────────────────────────────

@app.get("/panel")
def panel():
    return Response(get_panel_html(), mimetype="text/html; charset=utf-8")


@app.get("/panel/qrcode.js")
def panel_qrcode_js():
    return send_from_directory(
        os.path.join(app.root_path, "static"), "qrcode.min.js", max_age=86400
    )

# ─── Start ─────────────────────────────────────────────────────────────────────

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"

# ─── HTML do Painel ────────────────────────────────────────────────────────────

def get_panel_html():
    # Se o operador já abriu o painel pelo IP da rede, esse é o endereço mais
    # confiável para o celular. Em localhost, descobre o IPv4 da máquina.
    request_host = request.host.split(":")[0]
    panel_host = request_host if request_host not in ("localhost", "127.0.0.1") else get_local_ip()
    panel_server_url = f"http://{panel_host}:{PORT}"
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cooperativa — Painel de Testes</title>
<style>
  :root {{
    --bg:#0f172a;--surface:#1e293b;--surface2:#263148;
    --border:#334155;--text:#f8fafc;--muted:#94a3b8;
    --accent:#6366f1;--green:#10b981;--yellow:#f59e0b;
    --red:#ef4444;--orange:#f97316;
  }}
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;font-size:14px}}
  header{{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;gap:16px}}
  header h1{{font-size:18px;font-weight:700}}
  .dev-badge{{background:var(--orange);color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:.5px}}
  .layout{{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:20px 24px;max-width:1400px}}
  .card{{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}}
  .card-header{{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}}
  .card-title{{font-weight:600;font-size:14px}}
  .card-body{{padding:16px 18px}}
  .full-width{{grid-column:1/-1}}
  table{{width:100%;border-collapse:collapse}}
  th{{color:var(--muted);font-size:11px;font-weight:600;text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);letter-spacing:.5px;text-transform:uppercase}}
  td{{padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text);font-size:13px}}
  tr:last-child td{{border-bottom:none}}
  tr:hover td{{background:var(--surface2)}}
  .badge{{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}}
  .badge-green{{background:#064e3b;color:#6ee7b7}}
  .badge-blue{{background:#1e3a5f;color:#93c5fd}}
  .badge-yellow{{background:#451a03;color:#fcd34d}}
  .badge-red{{background:#450a0a;color:#fca5a5}}
  .badge-gray{{background:#1e293b;color:var(--muted);border:1px solid var(--border)}}
  .mono{{font-family:monospace;font-size:12px;color:var(--muted)}}
  .btn{{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;transition:opacity .15s}}
  .btn:hover{{opacity:.85}}
  .btn-sm{{padding:4px 10px;font-size:12px}}
  .btn-green{{background:var(--green)}}
  .btn-red{{background:var(--red)}}
  .btn-yellow{{background:var(--yellow);color:#000}}
  .btn-outline{{background:transparent;border:1px solid var(--border);color:var(--text)}}
  .btn-outline:hover{{background:var(--surface2)}}
  input,select,textarea{{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 12px;font-size:13px;width:100%;outline:none;font-family:inherit}}
  input:focus,select:focus,textarea:focus{{border-color:var(--accent)}}
  .form-row{{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}}
  .form-group{{display:flex;flex-direction:column;gap:5px;flex:1;min-width:120px}}
  label{{color:var(--muted);font-size:12px;font-weight:500}}
  .empty{{color:var(--muted);text-align:center;padding:28px;font-size:13px}}
  .stat-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}}
  .stat{{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px}}
  .stat-value{{font-size:26px;font-weight:700;color:var(--text)}}
  .stat-label{{font-size:12px;color:var(--muted);margin-top:4px}}
  .log{{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;max-height:220px;overflow-y:auto;font-family:monospace;font-size:12px;color:#a3e635}}
  .log-entry{{margin-bottom:4px}}
  .log-ts{{color:var(--muted)}}
  .tabs{{display:flex;gap:4px;padding:12px 18px 0;border-bottom:1px solid var(--border)}}
  .tab{{padding:8px 16px;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;font-weight:500;font-size:13px}}
  .tab.active{{color:var(--text);border-bottom-color:var(--accent)}}
  .tab-content{{display:none;padding:16px 18px}}
  .tab-content.active{{display:block}}
  .did-chip{{font-family:monospace;font-size:11px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:2px 8px;color:var(--muted);display:inline-block}}
  .refresh-btn{{color:var(--muted);cursor:pointer;font-size:18px;background:none;border:none;padding:2px 6px;border-radius:6px}}
  .refresh-btn:hover{{background:var(--surface2);color:var(--text)}}
  #toast{{position:fixed;bottom:24px;right:24px;background:var(--green);color:#fff;padding:10px 20px;border-radius:10px;font-weight:600;opacity:0;transition:opacity .3s;pointer-events:none;z-index:999}}
  #toast.show{{opacity:1}}
  .qr-layout{{display:grid;grid-template-columns:1.15fr auto auto;gap:18px;align-items:start}}
  .qr-card{{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center;min-width:250px}}
  .qr-card b{{display:block;font-size:14px;margin-bottom:2px}}
  .qr-card span{{color:var(--muted);font-size:12px}}
  .qr-box{{background:#fff;border-radius:10px;padding:10px;width:222px;height:222px;display:flex;align-items:center;justify-content:center;margin:0 auto 10px}}
  .qr-box canvas,.qr-box img{{display:block;max-width:100%;height:auto!important}}
  .qr-meta{{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 11px;margin:10px 0;font-size:12px;line-height:1.7;word-break:break-all}}
  .qr-hint{{color:var(--muted);font-size:12px;line-height:1.6;margin-top:8px}}
  @media (max-width:1050px){{.qr-layout{{grid-template-columns:1fr}}}}
</style>
</head>
<body>
<header>
  <div style="font-size:22px">🚗</div>
  <div>
    <h1>Cooperativa — Painel de Testes</h1>
    <div style="color:var(--muted);font-size:12px;margin-top:3px">Dev Server · localhost:{PORT}</div>
  </div>
  <span class="dev-badge">DEV MODE</span>
  <div style="margin-left:auto;display:flex;gap:8px">
    <button class="btn btn-outline btn-sm" onclick="refreshAll()">↻ Atualizar</button>
    <button class="btn btn-red btn-sm" onclick="resetAll()">🗑 Limpar tudo</button>
  </div>
</header>

<div style="padding:20px 24px">
  <div class="stat-grid">
    <div class="stat"><div class="stat-value" id="stat-sessions">-</div><div class="stat-label">Sessões ativas</div></div>
    <div class="stat"><div class="stat-value" id="stat-identities">-</div><div class="stat-label">Identidades</div></div>
    <div class="stat"><div class="stat-value" id="stat-messages">-</div><div class="stat-label">Mensagens</div></div>
    <div class="stat"><div class="stat-value" id="stat-status" style="font-size:16px">-</div><div class="stat-label">Status servidor</div></div>
  </div>

  <div class="layout">
    <!-- Sessão completa em duas janelas mobile -->
    <div class="card full-width" style="border:2px solid var(--green);background:linear-gradient(135deg,rgba(16,185,129,.10),rgba(99,102,241,.10))">
      <div class="card-header" style="background:rgba(16,185,129,.12)">
        <span class="card-title" style="font-size:16px">📱 Sessão completa no mesmo computador</span>
        <span class="badge badge-green">PASSAGEIRO + MOTORISTA</span>
      </div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:18px;align-items:start">
          <div>
            <div style="font-size:18px;font-weight:750;margin-bottom:7px">Abra os dois aplicativos em formato mobile</div>
            <div style="color:var(--muted);line-height:1.55;margin-bottom:14px">
              As janelas usam o aplicativo real da demo, com armazenamento separado. Faça o login em cada uma,
              deixe o motorista aguardando chamadas e solicite a corrida como passageiro.
            </div>
            <button class="btn btn-green" style="font-size:14px;padding:11px 18px" onclick="startBrowserDemoSession()">
              ▶ Iniciar sessão passageiro + motorista
            </button>
            <div style="display:flex;gap:8px;margin-top:9px">
              <button class="btn btn-outline btn-sm" onclick="openDemoPeer('client')">Abrir somente passageiro</button>
              <button class="btn btn-outline btn-sm" onclick="openDemoPeer('driver')">Abrir somente motorista</button>
            </div>
            <div id="browser-demo-status" style="color:var(--muted);font-size:12px;margin-top:11px">
              O navegador pode abrir janelas ou guias, conforme a configuração local. A interface permanece limitada a 430 px.
            </div>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:13px">
            <div style="font-weight:700;margin-bottom:10px">Login das duas contas</div>
            <div style="color:var(--muted);font-size:12px;margin-bottom:12px">As duas janelas já possuem uma identidade protegida. Digite a senha e toque em Entrar, sem importar chaves.</div>
            <div style="display:grid;grid-template-columns:1fr auto;gap:7px;align-items:center;margin-bottom:8px">
              <div><b>Senha do passageiro e do motorista</b><div class="mono">Demo@123</div></div>
              <button class="btn btn-outline btn-sm" onclick="copyDemoPassword()">📋 Copiar senha</button>
              <div><b>DID do motorista</b><div class="mono">0x1563…5508</div></div>
              <button class="btn btn-outline btn-sm" onclick="copyDriverDid()">📋 Copiar DID</button>
            </div>
            <details style="margin-top:12px;font-size:12px">
              <summary style="cursor:pointer;color:var(--muted)">Importação manual (avançado)</summary>
              <p>Para demonstrar recuperação, use Usar outra identidade → Importar identidade e defina uma nova senha.</p>
              <button class="btn btn-outline btn-sm" onclick="copyDemoKey('client')">📋 Chave de Vitor Maia</button>
              <button class="btn btn-outline btn-sm" onclick="copyDemoKey('driver')">📋 Chave de Carlos Silva</button>
            </details>
          </div>
        </div>
      </div>
    </div>

    <!-- Pareamento do APK por QR code -->
    <div class="card full-width" style="border:2px solid var(--accent)">
      <div class="card-header" style="background:rgba(99,102,241,.12)">
        <span class="card-title" style="font-size:16px">📲 Conectar APK por QR code</span>
        <span class="badge badge-blue">ANDROID · MESMA REDE WI-FI</span>
      </div>
      <div class="card-body">
        <div class="qr-layout">
          <div>
            <div style="font-size:18px;font-weight:750;margin-bottom:7px">Pareie cada celular com esta sessão</div>
            <div style="color:var(--muted);line-height:1.55;margin-bottom:10px">
              No APK da Cooperativa, toque em <b>Ler QR do painel</b> e escaneie o código do papel
              correspondente ao aparelho. O QR configura o endereço do servidor, a sessão e o papel
              de passageiro ou motorista.
            </div>
            <div class="qr-meta">
              Servidor: <span id="pairing-server" class="mono">—</span><br>
              Sessão: <span id="pairing-session" class="mono">—</span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" onclick="newPairingSession()">🔄 Nova sessão para QR</button>
              <button class="btn btn-outline btn-sm" onclick="renderPairingQr()">↻ Redesenhar QRs</button>
            </div>
            <div class="qr-hint">
              O celular e este computador precisam estar na mesma rede Wi-Fi. O APK usa HTTP local,
              então não é necessário HTTPS para o pareamento. Cada aparelho recebe um QR diferente:
              um para Vitor Maia (passageiro) e outro para Carlos Silva (motorista).
            </div>
          </div>
          <div class="qr-card">
            <div class="qr-box" id="qr-client" aria-label="QR code do passageiro"></div>
            <b>👤 Passageiro</b>
            <span>Vitor Maia · conta de demonstração</span>
          </div>
          <div class="qr-card">
            <div class="qr-box" id="qr-driver" aria-label="QR code do motorista"></div>
            <b>🚗 Motorista</b>
            <span>Carlos Silva · conta de demonstração</span>
          </div>
        </div>
        <details style="margin-top:12px;font-size:12px;color:var(--muted)">
          <summary style="cursor:pointer">Detalhes técnicos do pareamento</summary>
          <pre id="pairing-json" class="mono" style="white-space:pre-wrap;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:8px"></pre>
        </details>
      </div>
    </div>

    <!-- Painel de Demonstração (TCC) -->
    <div class="card full-width" style="border: 2px solid var(--accent); background: linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(16,185,129,0.08) 100%);">
      <div class="card-header" style="background: rgba(99,102,241,0.15)">
        <span class="card-title" style="font-size: 15px; display:flex; align-items:center; gap:8px;">
          🎬 <b>Controle de Gravação da Demonstração (TCC)</b>
        </span>
        <span class="badge badge-green">AMBIENTE ISOLADO DE DEMO</span>
      </div>
      <div class="card-body">
        <div style="display:grid; grid-template-columns: 1fr 1fr 1.3fr; gap:16px;">
          <!-- Motorista Demo -->
          <div style="background:var(--surface2); padding:12px 14px; border-radius:8px; border:1px solid var(--border)">
            <div style="font-weight:700; color:#10b981; margin-bottom:4px; font-size:13px">🚗 Motorista Credenciado (Demo)</div>
            <div style="font-size:14px; font-weight:700">Carlos Silva</div>
            <div style="font-size:12px; color:var(--muted)">Toyota Corolla Cinza · ABC-1D23 · ★ 4.95</div>
            <div class="mono" style="margin:8px 0; word-break:break-all; font-size:11px; background:var(--bg); padding:4px 6px; border-radius:4px">0x1563915e194D8CfBA1943570603F7606A3115508</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px">
              <span class="badge badge-green">✓ Polygon On-Chain</span>
              <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText('0x1563915e194D8CfBA1943570603F7606A3115508'); showToast('DID do Carlos copiado!')">📋 Copiar DID</button>
            </div>
          </div>

          <!-- Passageiro Demo -->
          <div style="background:var(--surface2); padding:12px 14px; border-radius:8px; border:1px solid var(--border)">
            <div style="font-weight:700; color:#6366f1; margin-bottom:4px; font-size:13px">👤 Passageiro (Demo)</div>
            <div style="font-size:14px; font-weight:700">Vitor Maia</div>
            <div style="font-size:12px; color:var(--muted)">Autenticação SSI / EIP-4361 · ★ 5.0</div>
            <div class="mono" style="margin:8px 0; word-break:break-all; font-size:11px; background:var(--bg); padding:4px 6px; border-radius:4px">0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px">
              <span class="badge badge-blue">✓ Polygon On-Chain</span>
              <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText('0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A'); showToast('DID do Vitor copiado!')">📋 Copiar DID</button>
            </div>
          </div>

          <!-- Ações Rápidas de 1 Clique -->
          <div style="background:var(--surface2); padding:12px 14px; border-radius:8px; border:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
            <div style="font-weight:700; color:#f59e0b; font-size:13px">⚡ Ações de 1 Clique para a Gravação</div>
            
            <button class="btn btn-green btn-sm" onclick="triggerIncomingCall()">
              🔔 Fazer Tocar Celular do Motorista (Simular Corrida)
            </button>

            <button class="btn btn-sm" onclick="startDemoSimulation()">
              🚀 Iniciar Simulação de GPS no Mapa (Av. Paulista)
            </button>

            <div style="display:flex; gap:6px;">
              <button class="btn btn-outline btn-sm" style="flex:1" onclick="sendQuickMsg('Estou a caminho! Chegando em 3 min.')">💬 "A caminho"</button>
              <button class="btn btn-outline btn-sm" style="flex:1" onclick="sendQuickMsg('Cheguei ao local de embarque!')">💬 "Cheguei"</button>
            </div>

            <div style="display:flex; gap:6px;">
              <button class="btn btn-yellow btn-sm" style="flex:1" onclick="advanceDemoStatus('arrived')">📍 Chegou</button>
              <button class="btn btn-yellow btn-sm" style="flex:1" onclick="advanceDemoStatus('in_progress')">🚗 Em Viagem</button>
              <button class="btn btn-yellow btn-sm" style="flex:1" onclick="advanceDemoStatus('completed')">🏁 Concluir</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Sessões -->
    <div class="card">
      <div class="card-header"><span class="card-title">📡 Sessões P2P Mock</span><button class="refresh-btn" onclick="loadSessions()">↻</button></div>
      <div id="sessions-table"><div class="empty">Nenhuma sessão ativa</div></div>
    </div>

    <!-- Identidades -->
    <div class="card">
      <div class="card-header"><span class="card-title">🔑 Identidades Registradas</span><button class="refresh-btn" onclick="loadIdentities()">↻</button></div>
      <div id="identities-table"><div class="empty">Nenhuma identidade registrada</div></div>
    </div>

    <!-- Injetor -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">💉 Injetar Dados no App</span>
        <span style="color:var(--muted);font-size:12px">Simula o par remoto</span>
      </div>
      <div>
        <div class="tabs">
          <div class="tab active" onclick="switchTab(this,'tab-loc')">📍 Localização</div>
          <div class="tab" onclick="switchTab(this,'tab-msg')">💬 Mensagem</div>
          <div class="tab" onclick="switchTab(this,'tab-sta')">🏁 Status</div>
          <div class="tab" onclick="switchTab(this,'tab-raw')">⚙️ Raw</div>
        </div>

        <div class="tab-content active" id="tab-loc">
          <div class="form-row" style="margin-bottom:10px">
            <div class="form-group"><label>Sessão</label><select id="sel-s-loc"><option value="">—</option></select></div>
            <div class="form-group"><label>Para (DID)</label><select id="sel-t-loc"><option value="">—</option></select></div>
          </div>
          <div class="form-row" style="margin-bottom:10px">
            <div class="form-group"><label>Lat</label><input id="lat" type="number" step="0.0001" value="-23.5505"></div>
            <div class="form-group"><label>Lng</label><input id="lng" type="number" step="0.0001" value="-46.6333"></div>
            <div class="form-group"><label>Vel (m/s)</label><input id="spd" type="number" step="0.1" value="8.3"></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm" onclick="injectLocation()">Enviar</button>
            <button class="btn btn-outline btn-sm" onclick="startSim()">▶ Simular trajeto</button>
            <button class="btn btn-red btn-sm" id="stop-sim" style="display:none" onclick="stopSim()">⏹ Parar</button>
          </div>
        </div>

        <div class="tab-content" id="tab-msg">
          <div class="form-row" style="margin-bottom:10px">
            <div class="form-group"><label>Sessão</label><select id="sel-s-msg"><option value="">—</option></select></div>
            <div class="form-group"><label>Para</label><select id="sel-t-msg"><option value="">—</option></select></div>
          </div>
          <div class="form-group" style="margin-bottom:10px"><label>Texto</label><input id="msg-txt" placeholder="Estou chegando..."></div>
          <button class="btn btn-sm btn-green" onclick="injectMsg()">Enviar mensagem</button>
        </div>

        <div class="tab-content" id="tab-sta">
          <div class="form-row" style="margin-bottom:12px">
            <div class="form-group"><label>Sessão</label><select id="sel-s-sta"><option value="">—</option></select></div>
            <div class="form-group"><label>Para</label><select id="sel-t-sta"><option value="">—</option></select></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-outline" onclick="injectStatus('accepted')">✓ Aceito</button>
            <button class="btn btn-sm btn-outline" onclick="injectStatus('arrived')">📍 Chegou</button>
            <button class="btn btn-sm btn-yellow" onclick="injectStatus('in_progress')">🚗 Em viagem</button>
            <button class="btn btn-sm btn-green" onclick="injectStatus('completed')">🏁 Concluído</button>
            <button class="btn btn-sm btn-red" onclick="injectStatus('cancelled')">✕ Cancelado</button>
          </div>
        </div>

        <div class="tab-content" id="tab-raw">
          <div class="form-row" style="margin-bottom:10px">
            <div class="form-group"><label>Sessão</label><select id="sel-s-raw"><option value="">—</option></select></div>
            <div class="form-group"><label>Para</label><select id="sel-t-raw"><option value="">—</option></select></div>
          </div>
          <div class="form-group" style="margin-bottom:10px"><label>JSON</label>
            <textarea id="raw-json" rows="3">{{"type":"message","text":"Olá do painel!","senderId":"dev-panel","timestamp":0}}</textarea>
          </div>
          <button class="btn btn-sm" onclick="injectRaw()">Injetar</button>
        </div>
      </div>
    </div>

    <!-- Log -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">📋 Log de Mensagens</span>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="log-sel" style="width:auto;font-size:12px" onchange="loadMessages()"><option value="">— sessão —</option></select>
          <button class="refresh-btn" onclick="loadMessages()">↻</button>
        </div>
      </div>
      <div id="msg-log" class="card-body"><div class="empty">Selecione uma sessão</div></div>
    </div>

    <!-- Simulação de Mapa GPS -->
    <div class="card full-width">
      <div class="card-header">
        <span class="card-title">🗺️ Simulação de Mapa GPS</span>
        <span style="color:var(--muted);font-size:12px">Simula motorista em movimento no mapa</span>
      </div>
      <div class="card-body">
        <div class="form-row" style="margin-bottom:14px">
          <div class="form-group"><label>Sessão</label><select id="map-sel-s"><option value="">—</option></select></div>
          <div class="form-group"><label>Enviar para (DID)</label><select id="map-sel-t"><option value="">—</option></select></div>
          <div class="form-group"><label>Rota</label><select id="map-route-sel"></select></div>
          <div class="form-group" style="max-width:110px"><label>Intervalo (ms)</label><input id="map-interval" type="number" value="2000" min="500" max="10000" step="500"></div>
          <div class="form-group" style="max-width:90px;justify-content:flex-end"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input id="map-loop" type="checkbox"> Loop</label></div>
          <div class="form-group" style="max-width:140px"><label>&nbsp;</label><button class="btn btn-green" onclick="startMapSim()">▶ Iniciar trajeto</button></div>
        </div>
        <div id="active-sims"><div class="empty">Carregando simulações...</div></div>
      </div>
    </div>

    <!-- Registro Manual -->
    <div class="card full-width">
      <div class="card-header"><span class="card-title">👤 Registrar Identidade Manualmente</span></div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group" style="max-width:320px"><label>DID (0x...)</label><input id="reg-did" placeholder="0x..."></div>
          <div class="form-group" style="max-width:160px"><label>Papel</label>
            <select id="reg-role"><option value="driver">Motorista</option><option value="client">Cliente</option></select>
          </div>
          <div class="form-group"><label>Nome</label><input id="reg-name" placeholder="João Motorista"></div>
          <div class="form-group" style="max-width:130px"><label>&nbsp;</label><button class="btn" onclick="registerId()">Registrar</button></div>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="toast">✓</div>

<script src="/panel/qrcode.js"></script>
<script>
const API='';
const PANEL_SERVER_URL={json.dumps(panel_server_url)};
let sessions=[],identities=[],simTimer=null,simLat=-23.5505,simLng=-46.6333;
let browserDemoSessionId='browser-'+Date.now().toString(36);
const DEMO_KEYS={{
  client:'0x1111111111111111111111111111111111111111111111111111111111111111',
  driver:'0x2222222222222222222222222222222222222222222222222222222222222222'
}};
const DRIVER_DID='0x1563915e194D8CfBA1943570603F7606A3115508';

function mobileDemoUrl(peer){{
  const base=window.location.protocol+'//'+window.location.hostname+':{WEB_PORT}/';
  return base+'?demoSession='+encodeURIComponent(browserDemoSessionId)+'&demoPeer='+peer;
}}

function pairingPayload(peer){{
  return JSON.stringify({{v:1,server:PANEL_SERVER_URL,session:browserDemoSessionId,peer}});
}}

function renderPairingQr(){{
  const client=document.getElementById('qr-client');
  const driver=document.getElementById('qr-driver');
  const session=document.getElementById('pairing-session');
  const server=document.getElementById('pairing-server');
  const details=document.getElementById('pairing-json');
  if(session)session.textContent=browserDemoSessionId;
  if(server)server.textContent=PANEL_SERVER_URL;
  if(details)details.textContent=JSON.stringify({{v:1,server:PANEL_SERVER_URL,session:browserDemoSessionId}},null,2);
  if(typeof QRCode==='undefined'){{
    if(client)client.textContent='Biblioteca de QR indisponível.';
    if(driver)driver.textContent='Biblioteca de QR indisponível.';
    return;
  }}
  for(const [element,peer] of [[client,'client'],[driver,'driver']]){{
    if(!element)continue;
    element.innerHTML='';
    new QRCode(element,{{text:pairingPayload(peer),width:200,height:200,colorDark:'#0f172a',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M}});
  }}
}}

function newPairingSession(){{
  browserDemoSessionId='browser-'+Date.now().toString(36);
  renderPairingQr();
  showToast('Nova sessão para QR gerada.');
}}

function popupFeatures(peer){{
  const width=430,height=Math.min(900,screen.availHeight-40),gap=18;
  const total=width*2+gap;
  const start=Math.max(0,Math.round((screen.availWidth-total)/2));
  const left=peer==='client'?start:start+width+gap;
  return `popup=yes,width=${{width}},height=${{height}},left=${{left}},top=20,resizable=yes,scrollbars=yes`;
}}

function openDemoPeer(peer){{
  const label=peer==='client'?'passageiro':'motorista';
  const opened=window.open(mobileDemoUrl(peer),'cooperativa-'+browserDemoSessionId+'-'+peer,popupFeatures(peer));
  const status=document.getElementById('browser-demo-status');
  if(!opened){{
    status.innerHTML='O navegador bloqueou a janela. <a style="color:#93c5fd" target="_blank" href="'+mobileDemoUrl(peer)+'">Abrir '+label+' nesta guia</a>';
    showToast('Permita pop-ups para abrir as duas telas.',true);
    return null;
  }}
  try{{opened.focus()}}catch{{}}
  status.textContent='Sessão '+browserDemoSessionId+' aberta. Faça o login nas duas telas.';
  return opened;
}}

function startBrowserDemoSession(){{
  browserDemoSessionId='browser-'+Date.now().toString(36);
  renderPairingQr();
  const client=openDemoPeer('client');
  const driver=openDemoPeer('driver');
  if(client&&driver) showToast('Duas telas mobile abertas: passageiro e motorista.');
}}

function copyDemoKey(peer){{
  navigator.clipboard.writeText(DEMO_KEYS[peer]);
  showToast('Chave do '+(peer==='client'?'passageiro':'motorista')+' copiada.');
}}

function copyDemoPassword(){{navigator.clipboard.writeText('Demo@123');showToast('Senha das contas de demonstração copiada.')}}

function copyDriverDid(){{navigator.clipboard.writeText(DRIVER_DID);showToast('DID do motorista copiado.')}}

window.onload=()=>{{refreshAll();loadMapRoutes();renderPairingQr();setInterval(refreshAll,5000);setInterval(loadActiveMapSims,4000)}};

async function refreshAll(){{await Promise.all([loadHealth(),loadSessions(),loadIdentities(),loadMessages()])}}

async function loadHealth(){{
  try{{
    const d=await fetch(API+'/health').then(r=>r.json());
    document.getElementById('stat-sessions').textContent=d.active_sessions??'-';
    document.getElementById('stat-identities').textContent=d.registered_identities??'-';
    document.getElementById('stat-status').textContent=d.ok?'🟢 Online':'🔴 Offline';
  }}catch{{document.getElementById('stat-status').textContent='🔴 Offline'}}
}}

async function loadSessions(){{
  try{{
    const d=await fetch(API+'/mock/sessions').then(r=>r.json());
    sessions=d.sessions||[];
    updateSelects();
    const el=document.getElementById('sessions-table');
    if(!sessions.length){{el.innerHTML='<div class="empty">Nenhuma sessão</div>';return}}
    let h='<table><thead><tr><th>Session ID</th><th>Caller</th><th>Callee</th><th>Estado</th><th>Criado</th></tr></thead><tbody>';
    for(const s of sessions){{
      const st=s.state==='active'?'<span class="badge badge-green">active</span>':s.state==='calling'?'<span class="badge badge-yellow">calling</span>':'<span class="badge badge-gray">'+s.state+'</span>';
      h+=`<tr><td class="mono">${{s.session_id.slice(0,16)}}...</td><td><span class="did-chip">${{s.caller.slice(0,10)}}...</span></td><td><span class="did-chip">${{s.callee.slice(0,10)}}...</span></td><td>${{st}}</td><td class="mono">${{new Date(s.created_at*1000).toLocaleTimeString()}}</td></tr>`;
    }}
    el.innerHTML=h+'</tbody></table>';
    const ls=document.getElementById('log-sel'),cur=ls.value;
    ls.innerHTML='<option value="">— sessão —</option>';
    for(const s of sessions){{const o=document.createElement('option');o.value=s.session_id;o.textContent=s.session_id.slice(0,20)+'... ('+s.state+')';ls.appendChild(o)}}
    if(cur)ls.value=cur;
  }}catch(e){{console.error(e)}}
}}

async function loadIdentities(){{
  try{{
    const d=await fetch(API+'/mock/identities').then(r=>r.json());
    identities=d.identities||[];
    updateSelects();
    const el=document.getElementById('identities-table');
    if(!identities.length){{el.innerHTML='<div class="empty">Nenhuma identidade</div>';return}}
    let h='<table><thead><tr><th>DID</th><th>Papel</th><th>Nome</th><th>Reg.</th></tr></thead><tbody>';
    for(const id of identities){{
      const role=id.metadata?.role==='driver'?'<span class="badge badge-green">motorista</span>':'<span class="badge badge-blue">cliente</span>';
      h+=`<tr><td><span class="did-chip">${{id.did.slice(0,14)}}...${{id.did.slice(-6)}}</span></td><td>${{role}}</td><td>${{id.metadata?.displayName??'—'}}</td><td class="mono">${{new Date(id.created_at*1000).toLocaleTimeString()}}</td></tr>`;
    }}
    el.innerHTML=h+'</tbody></table>';
  }}catch(e){{console.error(e)}}
}}

function updateSelects(){{
  const sPairs=[['sel-s-loc','sel-t-loc'],['sel-s-msg','sel-t-msg'],['sel-s-sta','sel-t-sta'],['sel-s-raw','sel-t-raw'],['map-sel-s','map-sel-t']];
  for(const[ss,st] of sPairs){{
    const els=document.getElementById(ss),cur=els.value;
    els.innerHTML='<option value="">—</option>';
    for(const s of sessions){{const o=document.createElement('option');o.value=s.session_id;o.textContent=s.session_id.slice(0,18)+'... ('+s.state+')';els.appendChild(o)}}
    if(cur)els.value=cur;
    const elt=document.getElementById(st),curT=elt.value;
    elt.innerHTML='<option value="">—</option>';
    for(const id of identities){{const o=document.createElement('option');o.value=id.did;o.textContent=(id.metadata?.displayName??id.did.slice(0,10))+' ('+(id.metadata?.role??'?')+')';elt.appendChild(o)}}
    if(curT)elt.value=curT;
  }}
}}

async function loadMessages(){{
  const sid=document.getElementById('log-sel').value;
  const el=document.getElementById('msg-log');
  if(!sid){{el.innerHTML='<div class="empty">Selecione uma sessão</div>';return}}
  try{{
    const d=await fetch(API+'/mock/messages?sessionId='+sid).then(r=>r.json());
    const msgs=d.messages||[];
    document.getElementById('stat-messages').textContent=msgs.length;
    if(!msgs.length){{el.innerHTML='<div class="empty">Sem mensagens</div>';return}}
    let h='<div class="log">';
    for(const m of msgs){{
      const ts=new Date(m.ts).toLocaleTimeString();
      const from=m.from_did==='dev-panel'?'🖥️ painel':m.from_did.slice(0,10)+'...';
      const type=m.payload?.type??'?';
      let detail='';
      if(type==='message')detail=': "'+m.payload.text+'"';
      else if(type==='location')detail=`: (${{m.payload.latitude?.toFixed(4)}},${{m.payload.longitude?.toFixed(4)}})`;
      else if(type==='status')detail=': '+m.payload.status;
      h+=`<div class="log-entry"><span class="log-ts">[${{ts}}]</span> ${{from}} → ${{m.to_did.slice(0,10)}}... · <strong>${{type}}</strong>${{detail}}</div>`;
    }}
    el.innerHTML=h+'</div>';
    const logEl=el.querySelector('.log');
    if(logEl)logEl.scrollTop=logEl.scrollHeight;
  }}catch(e){{el.innerHTML='<div class="empty">Erro</div>'}}
}}

function getP(ss,st){{
  const sid=document.getElementById(ss).value,tdid=document.getElementById(st).value;
  if(!sid||!tdid){{showToast('Selecione sessão e target!',true);return null}}
  return{{sessionId:sid,targetDid:tdid}}
}}

async function doInject(sid,tdid,payload){{
  const r=await fetch(API+'/mock/p2p/inject',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{sessionId:sid,targetDid:tdid,payload}})}});
  const d=await r.json();
  if(d.ok){{showToast('✓ Injetado: '+payload.type);loadMessages()}}
  else showToast('Erro',true);
}}

async function injectLocation(){{
  const p=getP('sel-s-loc','sel-t-loc');if(!p)return;
  await doInject(p.sessionId,p.targetDid,{{type:'location',latitude:+document.getElementById('lat').value,longitude:+document.getElementById('lng').value,speed:+document.getElementById('spd').value,heading:0,timestamp:Date.now()}});
}}

function startSim(){{
  const p=getP('sel-s-loc','sel-t-loc');if(!p)return;
  simLat=+document.getElementById('lat').value||(-23.5505);
  simLng=+document.getElementById('lng').value||(-46.6333);
  document.getElementById('stop-sim').style.display='inline-block';
  simTimer=setInterval(async()=>{{
    simLat+=(Math.random()-.5)*0.0008;simLng+=(Math.random()-.5)*0.0008;
    document.getElementById('lat').value=simLat.toFixed(6);
    document.getElementById('lng').value=simLng.toFixed(6);
    await doInject(p.sessionId,p.targetDid,{{type:'location',latitude:simLat,longitude:simLng,speed:8+Math.random()*5,heading:Math.random()*360,timestamp:Date.now()}});
  }},2000);
}}

function stopSim(){{clearInterval(simTimer);simTimer=null;document.getElementById('stop-sim').style.display='none';showToast('Simulação parada')}}

async function injectMsg(){{
  const p=getP('sel-s-msg','sel-t-msg');if(!p)return;
  const txt=document.getElementById('msg-txt').value.trim();if(!txt){{showToast('Digite mensagem',true);return}}
  await doInject(p.sessionId,p.targetDid,{{type:'message',text:txt,senderId:'dev-panel',timestamp:Date.now()}});
}}

async function injectStatus(status){{
  const p=getP('sel-s-sta','sel-t-sta');if(!p)return;
  await doInject(p.sessionId,p.targetDid,{{type:'status',status,timestamp:Date.now()}});
}}

async function injectRaw(){{
  const p=getP('sel-s-raw','sel-t-raw');if(!p)return;
  let pl;try{{pl=JSON.parse(document.getElementById('raw-json').value)}}catch{{showToast('JSON inválido!',true);return}}
  pl.timestamp=pl.timestamp||Date.now();
  await doInject(p.sessionId,p.targetDid,pl);
}}

async function registerId(){{
  const did=document.getElementById('reg-did').value.trim();
  const role=document.getElementById('reg-role').value;
  const name=document.getElementById('reg-name').value.trim();
  if(!did||!name){{showToast('Preencha DID e nome',true);return}}
  const r=await fetch(API+'/mock/register',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{did,metadata:JSON.stringify({{role,displayName:name,version:'1.0'}})}})}}).then(r=>r.json());
  if(r.ok){{showToast('✓ Identidade registrada');loadIdentities()}}
}}

async function resetAll(){{
  if(!confirm('Limpar todos os dados de teste?'))return;
  await fetch(API+'/mock/reset',{{method:'DELETE'}});
  showToast('🗑 Banco limpo');refreshAll();
}}

function switchTab(el,id){{
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');document.getElementById(id).classList.add('active');
}}

// ── Simulação de Mapa GPS ─────────────────────────────────────────────────────

let mapRoutes={{}};

async function loadMapRoutes(){{
  try{{
    const d=await fetch(API+'/mock/map/routes').then(r=>r.json());
    mapRoutes=d.routes||{{}};
    const sel=document.getElementById('map-route-sel');
    if(!sel)return;
    sel.innerHTML='';
    for(const[key,info] of Object.entries(mapRoutes)){{
      const o=document.createElement('option');o.value=key;o.textContent=info.name+' ('+info.points+' pts)';sel.appendChild(o);
    }}
  }}catch(e){{console.warn('Rotas de mapa indisponíveis',e)}}
}}

async function loadActiveMapSims(){{
  try{{
    const d=await fetch(API+'/mock/map/active').then(r=>r.json());
    const el=document.getElementById('active-sims');
    if(!el)return;
    if(!d.active.length){{el.innerHTML='<div class="empty">Nenhuma simulação ativa</div>';return}}
    let h='<table><thead><tr><th>Sessão</th><th>Rota</th><th>Ação</th></tr></thead><tbody>';
    for(const sim of d.active){{
      h+=`<tr><td class="mono">${{sim.sessionId.slice(0,18)}}...</td><td>${{sim.route}}</td><td><button class="btn btn-red btn-sm" onclick="stopMapSim('${{sim.sessionId}}')">⏹ Stop</button></td></tr>`;
    }}
    el.innerHTML=h+'</tbody></table>';
  }}catch{{}}
}}

async function startMapSim(){{
  const sid=document.getElementById('map-sel-s').value;
  const tdid=document.getElementById('map-sel-t').value;
  if(!sid||!tdid){{showToast('Selecione sessão e target!',true);return}}
  const routeKey=document.getElementById('map-route-sel')?.value||'consolacao_pinheiros';
  const intervalMs=parseInt(document.getElementById('map-interval')?.value||'2000');
  const loop=document.getElementById('map-loop')?.checked||false;
  const r=await fetch(API+'/mock/map/simulate',{{method:'POST',headers:{{'Content-Type':'application/json'}},
    body:JSON.stringify({{sessionId:sid,targetDid:tdid,routeKey,intervalMs,loop}})}}).then(r=>r.json());
  if(r.ok){{showToast('Simulação iniciada: '+routeKey);loadActiveMapSims()}}
  else showToast('Erro: '+(r.error||'?'),true);
}}

async function stopMapSim(sessionId){{
  await fetch(API+'/mock/map/stop',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{sessionId}})}});
  showToast('Simulação parada');loadActiveMapSims();
}}

function showToast(msg,isError=false){{
  const el=document.getElementById('toast');el.textContent=msg;
  el.style.background=isError?'#ef4444':'#10b981';
  el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2500);
}}

async function triggerIncomingCall(){{
  try{{
    const r=await fetch(API+'/mock/demo/trigger_call',{{method:'POST'}});
    const d=await r.json();
    if(d.ok){{showToast('🔔 Notificação enviada para o celular de Carlos Silva!');refreshAll()}}
    else showToast('Erro ao disparar chamada',true);
  }}catch(e){{showToast('Falha na requisição',true)}}
}}

async function sendQuickMsg(text){{
  try{{
    const r=await fetch(API+'/mock/demo/quick_message',{{
      method:'POST',
      headers:{{'Content-Type':'application/json'}},
      body:JSON.stringify({{text}})
    }});
    const d=await r.json();
    if(d.ok){{showToast('💬 Enviado: "'+text+'"');refreshAll()}}
    else showToast('Erro ao enviar mensagem',true);
  }}catch(e){{showToast('Falha na requisição',true)}}
}}

async function advanceDemoStatus(status){{
  try{{
    const r=await fetch(API+'/mock/demo/advance_status',{{
      method:'POST',
      headers:{{'Content-Type':'application/json'}},
      body:JSON.stringify({{status}})
    }});
    const d=await r.json();
    if(d.ok){{showToast('🏁 Status atualizado: '+status);refreshAll()}}
    else showToast('Nenhuma sessão ativa',true);
  }}catch(e){{showToast('Falha ao atualizar status',true)}}
}}

async function startDemoSimulation(){{
  try{{
    const s=sessions.find(x=>x.state==='calling'||x.state==='active');
    const sid=s?s.session_id:'demo_session_paulista';
    const target=s?s.caller:'0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
    const r=await fetch(API+'/mock/map/simulate',{{
      method:'POST',
      headers:{{'Content-Type':'application/json'}},
      body:JSON.stringify({{
        sessionId:sid,
        targetDid:target,
        routeKey:'consolacao_pinheiros',
        intervalMs:1500,
        loop:true
      }})
    }}).then(res=>res.json());
    if(r.ok){{showToast('🚀 Simulação de deslocamento GPS em SP iniciada!');loadActiveMapSims()}}
    else showToast('Erro ao iniciar trajeto: '+(r.error||'?'),true);
  }}catch(e){{showToast('Falha ao iniciar simulação',true)}}
}}
</script>
</body></html>"""


# O servidor precisa ser iniciado somente depois de todas as rotas e funções
# (inclusive get_panel_html) terem sido definidas. Caso contrário, a primeira
# requisição a /panel ocorre enquanto essa função ainda não existe.
if __name__ == "__main__":
    init_db()
    local_ip = get_local_ip()
    ready_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", ".runtime", "server.ready")
    )

    print()
    print("╔════════════════════════════════════════════╗")
    print("║  Cooperativa — Servidor de Demo Local      ║")
    print("╠════════════════════════════════════════════╣")
    print(f"║  API:    http://localhost:{PORT}             ║")
    print(f"║  Painel: http://localhost:{PORT}/panel       ║")
    print(f"║  DB:     {os.path.basename(DB_PATH)}               ║")
    print("╠════════════════════════════════════════════╣")
    print("║  Modo: DEV_MOCK (sem blockchain real)      ║")
    print("╚════════════════════════════════════════════╝")
    print()
    if local_ip != "localhost":
        print(f"  📱 Para celular físico: http://{local_ip}:{PORT}")
        print(f"     DEV_SERVER_URL: \"http://{local_ip}:{PORT}\"")
    print()

    http_server = make_server("0.0.0.0", PORT, app, threaded=True)
    os.makedirs(os.path.dirname(ready_path), exist_ok=True)
    with open(ready_path, "w", encoding="utf-8") as ready_file:
        json.dump({"pid": os.getpid(), "port": PORT, "ready": True}, ready_file)

    try:
        http_server.serve_forever()
    finally:
        try:
            os.remove(ready_path)
        except FileNotFoundError:
            pass

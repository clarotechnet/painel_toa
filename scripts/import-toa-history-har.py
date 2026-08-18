from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from toa_datalake_store import TOADatalakeStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa respostas de Historico do TOA de um HAR local")
    parser.add_argument("har", type=Path)
    args = parser.parse_args()
    payload = json.loads(args.har.read_text(encoding="utf-8"))
    store = TOADatalakeStore(Path(__file__).resolve().parents[1] / "data" / "toa_datalake.sqlite3")
    imported = []
    for entry in payload.get("log", {}).get("entries", []):
        request = entry.get("request", {})
        url = urlparse(str(request.get("url", "")))
        query = parse_qs(url.query)
        if query.get("m") != ["activity"] or query.get("a") != ["history"]:
            continue
        post = parse_qs(str(request.get("postData", {}).get("text", "")))
        aid = str((post.get("aid") or [""])[0])
        content = entry.get("response", {}).get("content", {})
        if content.get("encoding") == "base64":
            continue
        response = json.loads(str(content.get("text", "{}")))
        rows = response.get("activityHistory", {}).get("rows", [])
        if aid and rows:
            imported.append(store.ingest_history({"activity_id": aid, "rows": rows,
                                                  "observed_at": entry.get("startedDateTime", "")}))
    print(json.dumps({"ok": True, "har": str(args.har), "histories": imported}, ensure_ascii=False))


if __name__ == "__main__":
    main()

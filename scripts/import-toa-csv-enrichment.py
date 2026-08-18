from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from toa_datalake_store import TOADatalakeStore


def key(value: object) -> str:
    return "".join(
        character for character in unicodedata.normalize("NFKD", str(value or ""))
        if not unicodedata.combining(character)
    ).casefold().strip()


def digits(value: object) -> str:
    return "".join(re.findall(r"\d", str(value or "")))


def value(row: dict[str, str], name: str, occurrence: int = 0) -> str:
    wanted = key(name)
    matches = [str(item or "").strip() for header, item in row.items() if key(header) == wanted]
    return matches[occurrence] if occurrence < len(matches) else ""


def bucket_from_filename(path: Path) -> str:
    match = re.match(r"Atividades-(.+?)_\d{2}_\d{2}_(?:\d{2}|\d{4})(?:\s+\(\d+\))?\.csv$", path.name, re.I)
    return match.group(1).upper() if match else ""


def read_rows(path: Path) -> list[dict[str, str]]:
    raw = path.read_bytes()
    try:
        source = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        source = raw.decode("windows-1252")
    return list(csv.DictReader(source.splitlines()))


def main() -> None:
    parser = argparse.ArgumentParser(description="Enriquece o datalake com CSVs TOA sem substituir o status ao vivo.")
    parser.add_argument("files", nargs="+")
    parser.add_argument("--db", default="data/toa_datalake.sqlite3")
    args = parser.parse_args()

    details: list[dict[str, object]] = []
    seen: set[str] = set()
    for name in args.files:
        path = Path(name)
        if not path.is_file():
            continue
        bucket = bucket_from_filename(path)
        for row in read_rows(path):
            aid = digits(value(row, "ID da Atividade"))
            if not aid or aid in seen:
                continue
            seen.add(aid)
            service_window = value(row, "Janela de Serviço") or value(row, "Intervalo de Tempo")
            detail: dict[str, object] = {
                "activity_id": aid,
                "contract": digits(value(row, "Contrato")),
                "service_window": service_window,
                "start_time": value(row, "Início"),
                "end_time": value(row, "Fim"),
                "bucket": bucket,
                "scheduled_date": value(row, "Data"),
            }
            orders = []
            for index in range(1, 11):
                os_number = digits(value(row, f"Número da O.S {index}"))
                if not os_number:
                    continue
                orders.append({
                    "os_number": os_number,
                    "task_index": str(index),
                    "service": value(row, f"Tipo OS {index}"),
                    "status": value(row, f"Status da O.S {index}"),
                    "close_code": digits(value(row, f"Cód de Baixa {index}")),
                })
            detail["orders"] = orders
            details.append(detail)

    if not details:
        raise SystemExit("Nenhuma atividade valida encontrada nos CSVs.")
    result = TOADatalakeStore(Path(args.db)).ingest({
        "source": "toa-csv-enrichment",
        "observed_at": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds"),
        "details": details,
    })
    print(json.dumps({"ok": True, "files": len(args.files), "details": len(details), "result": result}, ensure_ascii=False))


if __name__ == "__main__":
    main()

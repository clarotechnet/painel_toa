import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from toa_capture import EXPECTED_VERSION, TOACaptureLot, parse_contracts


MAX_LOT_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True)
class CaptureLotFile:
    key: str
    path: Path
    name: str
    relative_path: str
    size: int
    modified_at: str
    aid_count: int
    version: str

    def public_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "relative_path": self.relative_path,
            "size": self.size,
            "modified_at": self.modified_at,
            "aid_count": self.aid_count,
            "version": self.version,
        }


class TOACaptureCatalog:
    """Lists and analyzes approved TECHCAP files without side effects."""

    def __init__(self, root: Path, lot_roots: Iterable[Path] | None = None) -> None:
        self.root = root.resolve()
        configured = tuple(lot_roots or (
            self.root / "references" / "techcap-v5.6",
            self.root / "logs" / "toa-captures",
        ))
        self.lot_roots = tuple(path.resolve() for path in configured)

    def _metadata(self, path: Path) -> tuple[str, int] | None:
        if path.stat().st_size > MAX_LOT_BYTES:
            return None
        try:
            with path.open("r", encoding="utf-8") as stream:
                payload = json.load(stream)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        metadata = payload.get("metadata")
        if not isinstance(metadata, dict):
            return None
        version = str(metadata.get("version", "")).strip()
        if version != EXPECTED_VERSION:
            return None
        source = str(metadata.get("source", "")).strip()
        if source != "TECHCAP.state.queue" and not source.startswith("TECHCAP V5.6"):
            return None
        entries = payload.get("os_list")
        if not isinstance(entries, list):
            return None
        return version, len(entries)

    def _key(self, path: Path) -> str:
        return hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:20]

    def list_lots(self) -> list[CaptureLotFile]:
        lots: list[CaptureLotFile] = []
        for lot_root in self.lot_roots:
            if not lot_root.is_dir():
                continue
            for path in lot_root.rglob("*.json"):
                metadata = self._metadata(path)
                if metadata is None:
                    continue
                version, aid_count = metadata
                stat = path.stat()
                try:
                    relative = path.resolve().relative_to(self.root).as_posix()
                except ValueError:
                    relative = path.name
                lots.append(CaptureLotFile(
                    key=self._key(path),
                    path=path.resolve(),
                    name=path.name,
                    relative_path=relative,
                    size=stat.st_size,
                    modified_at=datetime.fromtimestamp(stat.st_mtime).isoformat(
                        timespec="seconds"
                    ),
                    aid_count=aid_count,
                    version=version,
                ))
        return sorted(lots, key=lambda item: item.modified_at, reverse=True)

    def public_state(self) -> dict[str, Any]:
        lots = self.list_lots()
        return {
            "ok": True,
            "dry_run_only": True,
            "write_enabled": False,
            "inventory_write_enabled": False,
            "live_toa_enabled": False,
            "lots": [lot.public_dict() for lot in lots],
            "default_lot": lots[0].key if lots else "",
        }

    def _resolve(self, key: str) -> CaptureLotFile:
        normalized = str(key).strip()
        for lot in self.list_lots():
            if lot.key == normalized:
                return lot
        raise ValueError("Lote TECHCAP nao encontrado ou nao permitido")

    def analyze(self, key: str, contracts: Iterable[object]) -> dict[str, Any]:
        lot_file = self._resolve(key)
        normalized_contracts = parse_contracts(contracts)
        if not normalized_contracts:
            raise ValueError("Informe ao menos um contrato")
        if len(normalized_contracts) > 2_000:
            raise ValueError("O teste aceita no maximo 2.000 contratos por analise")
        lot = TOACaptureLot.from_path(lot_file.path)
        return {
            "ok": True,
            "dry_run_only": True,
            "write_enabled": False,
            "inventory_write_enabled": False,
            "live_toa_enabled": False,
            "lot": lot_file.public_dict(),
            "requested_contracts": normalized_contracts,
            "results": lot.review_contracts(normalized_contracts),
        }

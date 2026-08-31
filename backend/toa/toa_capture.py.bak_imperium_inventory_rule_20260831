"""Read-only validator for TECHCAP V5.6 capture exports.

This module is intentionally read-only and isolated from write-capable systems. It
normalizes captured TOA data and produces review decisions only. Nothing here
cannot close an order, transfer stock, or call an external write endpoint.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence


EXPECTED_VERSION = "5.6-queue"
DRY_RUN_ONLY = True

ALLOWED_DECISIONS = {
    "candidate_after_validation",
    "no_inventory_movement",
    "blocked_manual_review",
    "manual_review",
}
PRODUCTIVE_CODES = {"409", "430"}
IMPRODUCTIVE_CODES = {"103", "105", "106", "107", "125", "305"}
COMPLETE_STATUSES = {"complete", "completed", "concluida", "concluido"}
INTEGRATION_ERROR_PATTERN = re.compile(
    r"\b(?:erro|falha)\s+(?:de\s+)?integracao\b"
    r"|\bintegration\s+error\b"
    r"|\berro\s+interno\b"
    r"|\bservidor\s+nao\s+confirmou\b"
    r"|\btimed\s*out\b"
    r"|\btimeout\b",
    re.IGNORECASE,
)


class CaptureSchemaError(ValueError):
    """Raised when a TECHCAP export cannot be indexed safely."""


@dataclass(slots=True)
class NormalizedCapture:
    aid: str
    contract: str
    scheduled_date: str
    city: str
    work_type: str
    activity_status: str
    technician_observation: str
    tasks: list[dict[str, Any]]
    close_codes: list[str]
    installed_equipment: list[dict[str, Any]]
    removed_equipment: list[dict[str, Any]]
    customer_equipment: list[dict[str, Any]]
    materials: list[dict[str, Any]]
    assigned_technician: dict[str, Any]
    route_provider: dict[str, Any]
    inventory_providers: list[dict[str, Any]]
    form_submitters: list[dict[str, Any]]
    pools: list[str]
    operational_classification: str
    validation_errors: list[str]
    validation_warnings: list[str]
    decision: str
    decision_reasons: list[str]
    dry_run_only: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _text(value: object) -> str:
    return str(value if value is not None else "").strip()


def _normalized_text(value: object) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFD", _text(value)).casefold()
        if unicodedata.category(character) != "Mn"
    )


def _unique(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def parse_contracts(value: str | Iterable[object]) -> list[str]:
    if isinstance(value, str):
        parts = re.split(r"[\s,;|]+", value)
    else:
        parts = [_text(item) for item in value]
    return _unique(_text(part) for part in parts if _text(part))


def _classify_codes(codes: Sequence[str]) -> str:
    unique_codes = set(codes)
    if not unique_codes:
        return "sem-codigo"
    productive = unique_codes & PRODUCTIVE_CODES
    improductive = unique_codes & IMPRODUCTIVE_CODES
    unknown = unique_codes - PRODUCTIVE_CODES - IMPRODUCTIVE_CODES
    if productive and not improductive and not unknown:
        return "produtiva"
    if improductive and not productive and not unknown:
        return "improdutiva"
    if (productive and improductive) or (unknown and (productive or improductive)):
        return "mista"
    return "nao-mapeada"


def _task_key(task: dict[str, Any]) -> tuple[str, str]:
    return (_text(task.get("index")), _text(task.get("os_number")))


def _inventory_key(item: dict[str, Any]) -> str:
    return _text(item.get("invid")) or "|".join(
        (
            _text(item.get("serial")),
            _text(item.get("material_code")),
            _text(item.get("action_code")),
            _text(item.get("pool")),
        )
    )


def _form_key(item: dict[str, Any]) -> str:
    return _text(item.get("form_data_id")) or "|".join(
        (
            _text(item.get("activity_id")),
            _text(item.get("label")),
            _text(item.get("created_at")),
        )
    )


def _integration_error(activity: dict[str, Any]) -> bool:
    summary = " ".join(
        (
            _text(activity.get("completion_summary")),
            _text(activity.get("observation")),
        )
    )
    return bool(INTEGRATION_ERROR_PATTERN.search(_normalized_text(summary)))


def _activity_date(activity: dict[str, Any]) -> str:
    for field in ("start_time", "end_time", "date", "scheduled_date"):
        match = re.match(r"^(\d{4}-\d{2}-\d{2})", _text(activity.get(field)))
        if match:
            return match.group(1)
    return ""


def _dedupe_dicts(
    values: object,
    key_function,
    label: str,
    errors: list[str],
    warnings: list[str],
) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        errors.append(f"{label}_not_a_list")
        return []
    result: list[dict[str, Any]] = []
    positions: dict[object, int] = {}
    for position, raw_item in enumerate(values):
        if not isinstance(raw_item, dict):
            errors.append(f"{label}_item_not_an_object:{position}")
            continue
        item = copy.deepcopy(raw_item)
        key = key_function(item)
        if not key or (isinstance(key, tuple) and not any(key)):
            errors.append(f"{label}_identity_missing:{position}")
            continue
        previous_position = positions.get(key)
        if previous_position is None:
            positions[key] = len(result)
            result.append(item)
            continue
        if result[previous_position] == item:
            warnings.append(f"{label}_duplicate_ignored:{key}")
        else:
            errors.append(f"{label}_duplicate_conflict:{key}")
    return result


def _legacy_form_scope_is_safe(entry: dict[str, Any]) -> bool:
    history = entry.get("history")
    if not isinstance(history, list):
        return False
    return any(
        isinstance(record, dict)
        and _text(record.get("decision")) == "legacy_snapshot_migrated"
        for record in history
    )


def _decision(
    *,
    classification: str,
    source_decision: str,
    work_type: str,
    activity_status: str,
    close_codes: list[str],
    tasks: list[dict[str, Any]],
    inventory: list[dict[str, Any]],
    assigned_technician: dict[str, Any],
    route_confirmed: bool,
    integration_error: bool,
    errors: list[str],
    source_reasons: list[str],
) -> tuple[str, list[str]]:
    reasons = list(source_reasons)
    is_disconnection = "desconex" in _normalized_text(work_type)
    is_complete = _normalized_text(activity_status) in COMPLETE_STATUSES

    if is_disconnection:
        # Disconnections now follow the same evidence checks as other work.
        # Remove only the legacy type-based block emitted by the collector.
        reasons = [
            reason for reason in reasons
            if reason not in {
                "disconnect_automation_blocked",
                "disconnection_automation_blocked",
            }
        ]
        reasons.append("disconnection_policy_allows_validation")

    if integration_error:
        reasons.append("integration_error_in_summary")
    if not is_complete:
        reasons.append("activity_not_complete")
    if not close_codes:
        reasons.append("close_code_missing")

    if errors or integration_error or not is_complete or not close_codes:
        reasons.extend(errors)
        return "manual_review", _unique(reasons)

    if classification == "improdutiva":
        if inventory:
            reasons.append("improductive_activity_has_inventory")
            return "manual_review", _unique(reasons)
        if source_decision not in {"no_inventory_movement", "manual_review"}:
            reasons.append("source_decision_conflicts_with_improductive_activity")
            return "manual_review", _unique(reasons)
        reasons.append("improductive_inventory_movement_blocked")
        return "no_inventory_movement", _unique(reasons)

    if classification != "produtiva":
        reasons.append("operational_classification_requires_review")
        return "manual_review", _unique(reasons)

    if not _text(assigned_technician.get("id")):
        reasons.append("assigned_technician_missing")
        return "manual_review", _unique(reasons)
    if not route_confirmed:
        reasons.append("route_not_confirmed")
        return "manual_review", _unique(reasons)
    if any(_normalized_text(task.get("status")) != "e" for task in tasks):
        reasons.append("task_status_not_productive")
        return "manual_review", _unique(reasons)
    if not inventory:
        reasons.append("inventory_missing")
        return "manual_review", _unique(reasons)
    source_candidate = source_decision == "candidate_after_validation"
    legacy_disconnection_block = (
        is_disconnection and source_decision == "blocked_manual_review"
    )
    if not source_candidate and not legacy_disconnection_block:
        reasons.append("source_did_not_authorize_candidate")
        return "manual_review", _unique(reasons)
    if legacy_disconnection_block:
        reasons.append("legacy_disconnection_block_overridden")

    reasons.append("external_payload_validation_required")
    return "candidate_after_validation", _unique(reasons)


def normalize_entry(entry: dict[str, Any]) -> NormalizedCapture:
    errors: list[str] = []
    warnings: list[str] = []
    os_data = entry.get("os")
    if not isinstance(os_data, dict):
        os_data = {}
        errors.append("os_not_an_object")
    activity = os_data.get("activity")
    if not isinstance(activity, dict):
        activity = {}
        errors.append("activity_not_an_object")

    entry_aid = _text(entry.get("aid"))
    activity_aid = _text(activity.get("aid"))
    aid = entry_aid or activity_aid
    if not entry_aid or not activity_aid:
        errors.append("activity_identity_missing")
    elif entry_aid != activity_aid:
        errors.append("activity_aid_conflict")

    entry_contract = _text(entry.get("contract"))
    activity_contract = _text(activity.get("contract"))
    contract = entry_contract or activity_contract
    if not entry_contract or not activity_contract:
        errors.append("activity_contract_missing")
    elif entry_contract != activity_contract:
        errors.append("activity_contract_conflict")

    route = os_data.get("route") if isinstance(os_data.get("route"), dict) else {}
    route_aid = _text(route.get("aid"))
    route_confirmed = bool(route_aid and activity_aid and route_aid == activity_aid)
    if route_aid and route_aid != activity_aid:
        errors.append("route_aid_conflict")
    elif not route_aid:
        warnings.append("route_aid_missing")

    tasks = _dedupe_dicts(
        os_data.get("tasks", []), _task_key, "task", errors, warnings
    )
    for position, task in enumerate(tasks):
        if not _text(task.get("index")) or not _text(task.get("os_number")):
            errors.append(f"task_identity_incomplete:{position}")
        if not _text(task.get("status")):
            errors.append(f"task_status_missing:{position}")
        if not _text(task.get("close_code")):
            errors.append(f"task_close_code_missing:{position}")
    close_codes = _unique(_text(task.get("close_code")) for task in tasks)

    raw_inventory = _dedupe_dicts(
        os_data.get("inventory", []),
        _inventory_key,
        "inventory",
        errors,
        warnings,
    )
    inventory: list[dict[str, Any]] = []
    installed: list[dict[str, Any]] = []
    removed: list[dict[str, Any]] = []
    customer: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []
    pools: list[str] = []
    for position, item in enumerate(raw_inventory):
        item_aid = _text(item.get("activity_id"))
        if not item_aid:
            errors.append(f"inventory_activity_id_missing:{position}")
            continue
        if item_aid != activity_aid:
            errors.append(f"inventory_activity_id_conflict:{position}")
            continue
        pool = _text(item.get("pool")).casefold()
        kind = _text(item.get("kind")).casefold()
        if pool and pool not in pools:
            pools.append(pool)
        inventory.append(item)
        if kind == "material":
            materials.append(item)
            if item.get("quantity") in (None, ""):
                warnings.append(f"material_quantity_missing:{position}")
        elif kind == "equipment":
            if pool == "install":
                installed.append(item)
            elif pool == "deinstall":
                removed.append(item)
            elif pool == "customer":
                customer.append(item)
            else:
                warnings.append(f"equipment_pool_unmapped:{position}:{pool or 'empty'}")
        else:
            warnings.append(f"inventory_kind_unmapped:{position}:{kind or 'empty'}")

    forms = _dedupe_dicts(
        os_data.get("forms", []), _form_key, "form", errors, warnings
    )
    legacy_scope = _legacy_form_scope_is_safe(entry)
    for position, form in enumerate(forms):
        form_aid = _text(form.get("activity_id"))
        if not form_aid:
            if (
                _text(form.get("association_source")) == "legacy_batch_scope"
                or legacy_scope
            ):
                form["activity_id"] = activity_aid
                form["association_source"] = "legacy_batch_scope"
                warnings.append(f"form_activity_id_inferred_from_legacy_scope:{position}")
            else:
                errors.append(f"form_activity_id_missing:{position}")
        elif form_aid != activity_aid:
            errors.append(f"form_activity_id_conflict:{position}")

    responsibility = os_data.get("responsibility")
    if not isinstance(responsibility, dict):
        responsibility = {}
        errors.append("responsibility_not_an_object")
    assigned = copy.deepcopy(
        responsibility.get("assigned_technician")
        if isinstance(responsibility.get("assigned_technician"), dict)
        else {}
    )
    route_provider = copy.deepcopy(
        responsibility.get("route_provider")
        if isinstance(responsibility.get("route_provider"), dict)
        else {}
    )
    inventory_providers = copy.deepcopy(
        responsibility.get("inventory_providers")
        if isinstance(responsibility.get("inventory_providers"), list)
        else []
    )
    form_submitters = copy.deepcopy(
        responsibility.get("form_submitters")
        if isinstance(responsibility.get("form_submitters"), list)
        else []
    )
    activity_technician_id = _text(activity.get("technician_id"))
    assigned_id = _text(assigned.get("id"))
    if activity_technician_id and assigned_id and activity_technician_id != assigned_id:
        errors.append("assigned_technician_conflict")

    classification_data = entry.get("classification")
    if not isinstance(classification_data, dict):
        classification_data = {}
        errors.append("operational_classification_missing")
    source_classification = _text(classification_data.get("category"))
    computed_classification = _classify_codes(close_codes)
    classification = source_classification or computed_classification
    if source_classification and source_classification != computed_classification:
        errors.append("operational_classification_conflict")
    source_codes = {
        _text(code) for code in classification_data.get("codes", []) if _text(code)
    }
    if source_codes and source_codes != set(close_codes):
        errors.append("classification_close_codes_conflict")

    automation = entry.get("automation")
    if not isinstance(automation, dict):
        automation = {}
        errors.append("automation_decision_missing")
    source_decision = _text(automation.get("decision"))
    if source_decision not in ALLOWED_DECISIONS:
        errors.append("automation_decision_invalid")
        source_decision = "manual_review"
    raw_reasons = automation.get("reasons")
    source_reasons = (
        [_text(reason) for reason in raw_reasons if _text(reason)]
        if isinstance(raw_reasons, list)
        else []
    )

    work_type = _text(activity.get("work_type"))
    activity_status = _text(activity.get("status"))
    if not work_type:
        errors.append("activity_work_type_missing")
    integration_error = _integration_error(activity)
    if integration_error:
        errors.append("integration_error_in_summary")
    if _normalized_text(activity_status) not in COMPLETE_STATUSES:
        errors.append("activity_not_complete")
    if classification == "produtiva" and not assigned_id:
        errors.append("assigned_technician_missing")

    errors = _unique(errors)
    warnings = _unique(warnings)
    decision, decision_reasons = _decision(
        classification=classification,
        source_decision=source_decision,
        work_type=work_type,
        activity_status=activity_status,
        close_codes=close_codes,
        tasks=tasks,
        inventory=inventory,
        assigned_technician=assigned,
        route_confirmed=route_confirmed,
        integration_error=integration_error,
        errors=errors,
        source_reasons=source_reasons,
    )

    return NormalizedCapture(
        aid=aid,
        contract=contract,
        scheduled_date=_activity_date(activity),
        city=_text(activity.get("city")),
        work_type=work_type,
        activity_status=activity_status,
        technician_observation=_text(activity.get("observation")),
        tasks=tasks,
        close_codes=close_codes,
        installed_equipment=installed,
        removed_equipment=removed,
        customer_equipment=customer,
        materials=materials,
        assigned_technician=assigned,
        route_provider=route_provider,
        inventory_providers=inventory_providers,
        form_submitters=form_submitters,
        pools=pools,
        operational_classification=classification,
        validation_errors=errors,
        validation_warnings=warnings,
        decision=decision,
        decision_reasons=decision_reasons,
        dry_run_only=True,
    )


class TOACaptureLot:
    """Validated, read-only index of one TECHCAP V5.6 export."""

    def __init__(
        self,
        metadata: dict[str, Any],
        orders: Sequence[NormalizedCapture],
        *,
        validation_errors: Sequence[str] = (),
        validation_warnings: Sequence[str] = (),
        source_path: Path | None = None,
    ) -> None:
        self.metadata = copy.deepcopy(metadata)
        self.orders = tuple(orders)
        self.validation_errors = tuple(validation_errors)
        self.validation_warnings = tuple(validation_warnings)
        self.source_path = source_path
        self.by_aid = {order.aid: order for order in self.orders}
        contracts: defaultdict[str, list[NormalizedCapture]] = defaultdict(list)
        for order in self.orders:
            if order.contract:
                contracts[order.contract].append(order)
        self.by_contract = {
            contract: tuple(items) for contract, items in contracts.items()
        }

    @classmethod
    def from_path(cls, path: str | Path) -> TOACaptureLot:
        source_path = Path(path).expanduser().resolve()
        try:
            payload = json.loads(source_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise CaptureSchemaError(f"Nao foi possivel ler o lote: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise CaptureSchemaError(f"JSON TECHCAP invalido: {exc}") from exc
        return cls.from_dict(payload, source_path=source_path)

    @classmethod
    def from_dict(
        cls, payload: object, *, source_path: Path | None = None
    ) -> TOACaptureLot:
        if not isinstance(payload, dict):
            raise CaptureSchemaError("O lote TECHCAP deve ser um objeto JSON")
        metadata = payload.get("metadata")
        if not isinstance(metadata, dict):
            raise CaptureSchemaError("metadata ausente ou invalido")
        version = _text(metadata.get("version"))
        if version != EXPECTED_VERSION:
            raise CaptureSchemaError(
                f"Versao TECHCAP nao suportada: {version or 'ausente'}; "
                f"esperada: {EXPECTED_VERSION}"
            )
        source = _text(metadata.get("source"))
        if "TECHCAP V5.6" not in source:
            raise CaptureSchemaError("metadata.source nao identifica o TECHCAP V5.6")
        raw_orders = payload.get("os_list")
        if not isinstance(raw_orders, list):
            raise CaptureSchemaError("os_list ausente ou invalido")

        global_errors: list[str] = []
        global_warnings: list[str] = []
        declared_count = metadata.get("count")
        if declared_count is not None and declared_count != len(raw_orders):
            global_errors.append(
                f"metadata_count_mismatch:{declared_count}:{len(raw_orders)}"
            )
        rejections = payload.get("rejections", [])
        if not isinstance(rejections, list):
            global_errors.append("rejections_not_a_list")
            rejections = []
        rejection_count = metadata.get("rejectionCount", len(rejections))
        if rejection_count != len(rejections):
            global_errors.append(
                f"rejection_count_mismatch:{rejection_count}:{len(rejections)}"
            )
        if rejections:
            global_warnings.append(f"capture_rejections_present:{len(rejections)}")

        entries: list[dict[str, Any]] = []
        seen_aids: set[str] = set()
        for position, raw_entry in enumerate(raw_orders):
            if not isinstance(raw_entry, dict):
                raise CaptureSchemaError(f"os_list[{position}] nao e um objeto")
            entry_aid = _text(raw_entry.get("aid"))
            if not entry_aid:
                raise CaptureSchemaError(f"os_list[{position}] nao possui AID")
            if entry_aid in seen_aids:
                raise CaptureSchemaError(f"AID duplicado no lote: {entry_aid}")
            seen_aids.add(entry_aid)
            entries.append(raw_entry)

        orders = [normalize_entry(entry) for entry in entries]
        return cls(
            metadata,
            orders,
            validation_errors=_unique(global_errors),
            validation_warnings=_unique(global_warnings),
            source_path=source_path,
        )

    def find_contract(self, contract: object) -> tuple[NormalizedCapture, ...]:
        return self.by_contract.get(_text(contract), ())

    def find_aid(self, aid: object) -> NormalizedCapture | None:
        return self.by_aid.get(_text(aid))

    def review_contracts(self, contracts: Iterable[object]) -> list[dict[str, Any]]:
        reviews: list[dict[str, Any]] = []
        for contract in parse_contracts(contracts):
            matches = self.find_contract(contract)
            if not matches:
                reviews.append(
                    {
                        "contract": contract,
                        "found": False,
                        "decision": "manual_review",
                        "decision_reasons": ["contract_not_found"],
                        "dry_run_only": True,
                    }
                )
                continue
            for order in matches:
                review = order.to_dict()
                review["found"] = True
                reviews.append(review)
        return reviews


def _provider_label(provider: dict[str, Any]) -> str:
    return (
        _text(provider.get("name"))
        or _text(provider.get("external_id"))
        or _text(provider.get("id"))
        or "nao informado"
    )


def _print_inventory(title: str, items: list[dict[str, Any]]) -> None:
    print(f"  {title}: {len(items)}")
    for item in items:
        identity = (
            _text(item.get("serial"))
            or _text(item.get("material_code"))
            or _text(item.get("invid"))
            or "sem identificador"
        )
        description = _text(item.get("description")) or _text(item.get("type"))
        quantity = item.get("quantity", "")
        suffix = f" | {description}" if description else ""
        if quantity not in (None, ""):
            suffix += f" | quantidade={quantity}"
        print(f"    - {identity}{suffix}")


def print_dry_run_report(
    lot: TOACaptureLot, contracts: Iterable[object] | None = None
) -> None:
    selected = parse_contracts(contracts or lot.by_contract.keys())
    print("=== TECHCAP V5.6 -> DOMINIUM | DRY-RUN SOMENTE LEITURA ===")
    print(f"Arquivo: {lot.source_path or 'memoria'}")
    print(f"Versao: {lot.metadata.get('version', '')}")
    print(f"AIDs indexados: {len(lot.by_aid)}")
    print("Escrita externa: DESABILITADA")
    if lot.validation_errors:
        print("Erros globais: " + ", ".join(lot.validation_errors))
    if lot.validation_warnings:
        print("Alertas globais: " + ", ".join(lot.validation_warnings))

    for contract in selected:
        matches = lot.find_contract(contract)
        print("\n" + "-" * 72)
        print(f"Contrato {contract}: {'ENCONTRADO' if matches else 'NAO ENCONTRADO'}")
        if not matches:
            print("Decisao: manual_review")
            print("Motivos: contract_not_found")
            print("Dry-run: CONFIRMADO")
            continue
        for order_number, order in enumerate(matches, start=1):
            if len(matches) > 1:
                print(f"Atividade {order_number} de {len(matches)}")
            print(f"AID: {order.aid}")
            print(f"Cidade: {order.city or 'nao informada'}")
            print(f"Tipo: {order.work_type or 'nao informado'}")
            print(f"Status: {order.activity_status or 'nao informado'}")
            print(f"Classificacao: {order.operational_classification}")
            print(f"Tarefas: {len(order.tasks)}")
            for task in order.tasks:
                print(
                    "  - indice={index} | OS={os_number} | status={status} | "
                    "codigo={close_code}".format(**task)
                )
            _print_inventory("Equipamentos instalados", order.installed_equipment)
            _print_inventory("Equipamentos retirados", order.removed_equipment)
            _print_inventory("Equipamentos customer", order.customer_equipment)
            _print_inventory("Materiais/miscelaneas", order.materials)
            print("  Responsabilidades:")
            print(
                f"    - tecnico atribuido: {_provider_label(order.assigned_technician)}"
            )
            print(f"    - route_provider: {_provider_label(order.route_provider)}")
            print(
                "    - inventory_providers: "
                + ", ".join(_provider_label(item) for item in order.inventory_providers)
                if order.inventory_providers
                else "    - inventory_providers: nenhum"
            )
            print(
                "    - form_submitters: "
                + ", ".join(_provider_label(item) for item in order.form_submitters)
                if order.form_submitters
                else "    - form_submitters: nenhum"
            )
            print(
                "Campos invalidos/ausentes: "
                + (", ".join(order.validation_errors) or "nenhum")
            )
            print(
                "Alertas: "
                + (", ".join(order.validation_warnings) or "nenhum")
            )
            print(f"Decisao: {order.decision}")
            print(
                "Motivos: "
                + (", ".join(order.decision_reasons) or "nenhum")
            )
            print("Dry-run: CONFIRMADO")


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Valida um lote TECHCAP V5.6 em modo somente leitura."
    )
    parser.add_argument("lot", type=Path, help="Caminho do JSON exportado pelo TECHCAP")
    parser.add_argument(
        "--contracts",
        default="",
        help="Contratos separados por virgula, ponto e virgula ou espaco",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emite o resultado normalizado em JSON",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _argument_parser().parse_args(argv)
    try:
        lot = TOACaptureLot.from_path(args.lot)
    except CaptureSchemaError as exc:
        print(f"Erro de validacao: {exc}", file=sys.stderr)
        return 2
    contracts = parse_contracts(args.contracts) if args.contracts else list(lot.by_contract)
    if args.json:
        payload = {
            "metadata": copy.deepcopy(lot.metadata),
            "validation_errors": list(lot.validation_errors),
            "validation_warnings": list(lot.validation_warnings),
            "results": lot.review_contracts(contracts),
            "dry_run_only": True,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_dry_run_report(lot, contracts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

import json
import re
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation


MATERIAL_INVENTORY_TYPE = 106


@dataclass(frozen=True)
class TOAInventoryItem:
    inventory_id: str
    category: str
    equipment_type: str
    type_name: str
    code: str
    description: str
    serial: str
    quantity: str
    pool: str
    action: str
    point: str
    point_location: str
    technician_id: int
    activity_id: int

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class TOAInventory:
    materials: tuple[TOAInventoryItem, ...]
    equipment: tuple[TOAInventoryItem, ...]

    @property
    def items(self) -> tuple[TOAInventoryItem, ...]:
        return self.equipment + self.materials

    def to_dict(self) -> dict:
        return {
            "count": len(self.items),
            "material_count": len(self.materials),
            "equipment_count": len(self.equipment),
            "materials": [item.to_dict() for item in self.materials],
            "equipment": [item.to_dict() for item in self.equipment],
        }


def _extract_json_value(source: str, key: str) -> str:
    marker = f'"{key}"'
    key_position = source.find(marker)
    if key_position < 0:
        raise ValueError(f'O retorno TOA nao possui a secao "{key}"')
    position = source.find(":", key_position + len(marker))
    if position < 0:
        raise ValueError(f'A secao "{key}" do TOA e invalida')
    position += 1
    while position < len(source) and source[position].isspace():
        position += 1
    if position >= len(source) or source[position] not in "[{":
        raise ValueError(f'A secao "{key}" do TOA nao e uma lista ou objeto')

    opening = source[position]
    closing = "]" if opening == "[" else "}"
    depth = 0
    in_string = False
    escaped = False
    for end in range(position, len(source)):
        character = source[end]
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == opening:
            depth += 1
        elif character == closing:
            depth -= 1
            if depth == 0:
                return source[position : end + 1]
    raise ValueError(f'A secao "{key}" do TOA esta incompleta')


def _structure_text(item: dict, field: str) -> str:
    structure = item.get("_identifier_structure")
    if not isinstance(structure, dict):
        return ""
    value = structure.get(field)
    if not isinstance(value, dict):
        return ""
    return str(value.get("text", "")).strip()


def _quantity(value: object) -> str:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(f"Quantidade TOA invalida: {value}") from None
    if number <= 0:
        raise ValueError(f"Quantidade TOA deve ser positiva: {value}")
    normalized = format(number.normalize(), "f")
    return normalized.rstrip("0").rstrip(".") if "." in normalized else normalized


def _equipment_type(type_name: str) -> str:
    normalized = re.sub(r"[^A-Z0-9]+", " ", type_name.upper())
    if "EMTA" in normalized:
        return "emta"
    if "DECODER" in normalized:
        return "decoder"
    if "SMART" in normalized or "CARD" in normalized:
        return "smart"
    return "auto"


def parse_toa_inventory(source: str | bytes) -> TOAInventory:
    if isinstance(source, bytes):
        source = source.decode("utf-8-sig")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("O retorno TOA esta vazio")

    try:
        inventory_value = json.loads(_extract_json_value(source, "Inventory"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"A secao Inventory do TOA e invalida: {exc.msg}") from exc
    if isinstance(inventory_value, dict):
        raw_items = list(inventory_value.values())
    elif isinstance(inventory_value, list):
        raw_items = inventory_value
    else:
        raise ValueError("A secao Inventory do TOA nao contem itens")

    materials = []
    equipment = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        inventory_type = int(raw_item.get("invtype", 0) or 0)
        code = str(raw_item.get("192", "") or "").strip()
        toa_description = _structure_text(raw_item, "192")
        if code and toa_description.startswith(code + "_"):
            description = toa_description[len(code) + 1 :].strip()
        else:
            description = toa_description
        type_name = _structure_text(raw_item, "invtype")
        item = TOAInventoryItem(
            inventory_id=str(raw_item.get("invid", "") or "").strip(),
            category=(
                "material" if inventory_type == MATERIAL_INVENTORY_TYPE else "equipment"
            ),
            equipment_type=(
                "material"
                if inventory_type == MATERIAL_INVENTORY_TYPE
                else _equipment_type(type_name)
            ),
            type_name=type_name,
            code=code,
            description=description,
            serial=str(raw_item.get("invsn", "") or "").strip().upper(),
            quantity=_quantity(raw_item.get("quantity", 0)),
            pool=str(raw_item.get("invpool", "") or "").strip(),
            action=_structure_text(raw_item, "419"),
            point=str(raw_item.get("335", "") or "").strip(),
            point_location=_structure_text(raw_item, "307"),
            technician_id=int(raw_item.get("inv_pid", 0) or 0),
            activity_id=int(raw_item.get("inv_aid", 0) or 0),
        )
        if item.category == "material":
            if not item.code:
                continue
            materials.append(item)
        elif item.serial:
            equipment.append(item)
    return TOAInventory(tuple(materials), tuple(equipment))


def parse_toa_clipboard(source: str | bytes) -> TOAInventory:
    if isinstance(source, bytes):
        source = source.decode("utf-8-sig")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("A colagem TOA esta vazia")

    fields = [
        value.strip().strip('"')
        for value in re.split(r"[\r\n\t]+", source)
        if value.strip().strip('"')
    ]
    starts = [
        index
        for index, value in enumerate(fields)
        if re.fullmatch(r"\d{9}", value)
    ]
    if not starts:
        raise ValueError("A colagem TOA nao possui IDs de equipamento")

    materials = []
    equipment = []
    for block_index, start in enumerate(starts):
        end = starts[block_index + 1] if block_index + 1 < len(starts) else len(fields)
        inventory_id = fields[start]
        values = fields[start + 1 : end]
        material_match = next(
            (
                re.fullmatch(r"(\d{8})_(.+)", value)
                for value in values
                if re.fullmatch(r"\d{8}_.+", value)
            ),
            None,
        )
        quantity_values = [
            int(value)
            for value in values
            if re.fullmatch(r"\d{1,5}", value) and 0 < int(value) <= 0xFFFF
        ]
        quantity = str(quantity_values[-1] if quantity_values else 1)
        point = next(
            (value for value in values if re.fullmatch(r"\d{8}", value)),
            "",
        )
        action = next(
            (value for value in values if _equipment_type(value) == "auto" and "stalad" in value.lower()),
            "",
        )
        point_location = next(
            (value for value in values if value.lower() in {"sala", "quarto", "cozinha", "outros"}),
            "",
        )

        if material_match is not None:
            code, description = material_match.groups()
            materials.append(
                TOAInventoryItem(
                    inventory_id=inventory_id,
                    category="material",
                    equipment_type="material",
                    type_name="HFC",
                    code=code,
                    description=description.strip(),
                    serial="",
                    quantity=quantity,
                    pool="instalado",
                    action=action,
                    point=point,
                    point_location=point_location,
                    technician_id=0,
                    activity_id=0,
                )
            )
            continue

        type_name = next(
            (
                value
                for value in values
                if _equipment_type(value) != "auto"
            ),
            "",
        )
        equipment_type = _equipment_type(type_name)
        serial = next(
            (
                value.upper()
                for value in values
                if re.fullmatch(r"[A-Za-z0-9]{12}", value)
            ),
            "",
        )
        if equipment_type == "auto" or not serial:
            continue
        equipment.append(
            TOAInventoryItem(
                inventory_id=inventory_id,
                category="equipment",
                equipment_type=equipment_type,
                type_name=type_name,
                code="",
                description="",
                serial=serial,
                quantity=quantity,
                pool="instalado",
                action=action,
                point=point,
                point_location=point_location,
                technician_id=0,
                activity_id=0,
            )
        )

    if not materials and not equipment:
        raise ValueError("Nenhum equipamento ou miscelanea foi reconhecido na colagem TOA")
    return TOAInventory(tuple(materials), tuple(equipment))

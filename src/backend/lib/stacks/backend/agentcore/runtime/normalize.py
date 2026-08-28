"""Trace normalizer: Strands/observability source records -> Trace_Events.

`normalize_records` is pure and total: it emits exactly the Trace_Events derived
from mappable source records, records an indication for each unmapped record, and
never raises (Req 7.4, 7.5).

Requirements: 7.4, 7.5
"""

from __future__ import annotations

from typing import Any

from trace_schema import EVENT_TYPES, TraceEvent, is_conformant


def _map_record(record: Any) -> TraceEvent | None:
    """Map a single source record to a TraceEvent, or None if unmappable."""
    if not isinstance(record, dict):
        return None
    event_type = record.get("eventType")
    agent_id = record.get("agentId")
    if event_type not in EVENT_TYPES:
        return None
    if not isinstance(agent_id, str) or agent_id == "":
        return None
    candidate = TraceEvent(
        eventType=event_type,
        agentId=agent_id,
        payload=record.get("payload", {}) if isinstance(record.get("payload"), dict) else {},
    )
    return candidate if is_conformant(candidate) else None


def normalize_records(records: list[Any]) -> tuple[list[TraceEvent], list[Any]]:
    """Return (events, unmapped) for a batch of source records.

    `events` are the conformant Trace_Events derived from mappable records, in
    input order; `unmapped` collects the source records that could not be mapped
    (an indication that they were skipped). Never raises.
    """
    events: list[TraceEvent] = []
    unmapped: list[Any] = []
    for record in records:
        mapped = _map_record(record)
        if mapped is None:
            unmapped.append(record)
        else:
            events.append(mapped)
    return events, unmapped

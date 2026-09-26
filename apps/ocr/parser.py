"""Conservative, deterministic extraction. Confidence is not a probability."""

import re
import unicodedata


RECIPIENT_MARKER = (
    r"\b(?:DESTINATARIO|DESTINATARIA|RECEBEDOR|RECEBEDORA|"
    r"ENTREGAR\s+A|ENTREGA\s+PARA|SHIP\s+TO|CONSIGNEE)\b"
)
SENDER_MARKER = (
    r"\b(?:REMETENTE|EXPEDIDOR|EMITENTE|ENDERECO\s+DE\s+DEVOLUCAO|"
    r"RETURN\s+ADDRESS|RETURN\s+TO|SHIP\s+FROM|SENDER)\b"
)
NAME_METADATA = (
    rf"{SENDER_MARKER}|\b(?:BLOCO|BL\.?|TORRE|APARTAMENTO|APTO|APT|AP|"
    r"ENDERECO|CEP|RUA|AVENIDA|AV\.?|ALAMEDA|RODOVIA|TRAVESSA|PRACA|"
    r"CODIGO|RASTREAMENTO|TRACKING|PEDIDO|VOLUME|NOTA\s+FISCAL|NF)\b"
)


def normalized(text: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFD", text)
        if not unicodedata.combining(character)
    )


def _bounded_tail(text: str, marker: re.Match[str]) -> str:
    """Return text after a recipient marker, stopping at sender metadata."""
    clean = normalized(text).upper()
    start = marker.end()
    separator = re.match(r"\s*[:\-–—]?\s*", clean[start:])
    if separator:
        start += separator.end()
    sender = re.search(SENDER_MARKER, clean[start:])
    end = start + sender.start() if sender else len(text)
    return text[start:end].strip(" \t:-–—,;")


def _recipient_segments(lines: list[tuple[str, float]]) -> list[tuple[str, float, bool]]:
    """Collect only text belonging to explicitly marked recipient sections."""
    segments: list[tuple[str, float, bool]] = []
    anchors = [
        index
        for index, (text, _confidence) in enumerate(lines)
        if re.search(RECIPIENT_MARKER, normalized(text).upper())
    ]
    for index in anchors:
        text, confidence = lines[index]
        clean = normalized(text).upper()
        marker = re.search(RECIPIENT_MARKER, clean)
        if marker:
            tail = _bounded_tail(text, marker)
            if tail:
                segments.append((tail, confidence, True))

        # Labels normally place name and address immediately below the heading.
        # The small window avoids drifting into another unrelated label panel.
        for following in range(index + 1, min(len(lines), index + 7)):
            candidate, score = lines[following]
            candidate_clean = normalized(candidate).upper()
            if re.search(SENDER_MARKER, candidate_clean):
                break
            if re.search(RECIPIENT_MARKER, candidate_clean):
                break
            segments.append((candidate, score, False))
    return segments


def _name_candidate(text: str, explicit: bool) -> str | None:
    clean = normalized(text).upper().strip()
    clean = re.sub(r"^NOME\s*[:\-]?\s*", "", clean)
    original = re.sub(r"^\s*NOME\s*[:\-]?\s*", "", text, flags=re.IGNORECASE).strip()
    stop = re.search(NAME_METADATA, clean)
    if stop:
        original = original[: stop.start()].strip(" \t:-–—,;")
        clean = clean[: stop.start()].strip()
    if not original or any(character.isdigit() for character in original):
        return None
    if not re.fullmatch(r"[A-Z][A-Z' -]{1,159}", clean):
        return None
    words = [word for word in clean.split() if word]
    minimum_words = 1 if explicit else 2
    if not minimum_words <= len(words) <= 8:
        return None
    return original[:160]


def _set_pattern_field(
    fields: dict[str, dict[str, str | float | None]],
    key: str,
    pattern: str,
    segments: list[tuple[str, float, bool]],
) -> None:
    for text, confidence, _explicit in segments:
        clean = normalized(text).upper()
        match = re.search(pattern, clean)
        if match and confidence > float(fields[key]["confidence"] or 0):
            value = text[match.start(1) : match.end(1)].strip(" \t:-–—,;")
            fields[key] = {
                "value": value,
                "confidence": round(min(0.98, max(0, confidence)), 3),
            }


def parse_lines(lines: list[tuple[str, float]]) -> dict:
    fields: dict[str, dict[str, str | float | None]] = {
        key: {"value": None, "confidence": 0.0}
        for key in [
            "recipientName",
            "block",
            "apartment",
            "trackingCode",
            "carrier",
            "address",
        ]
    }
    all_segments = [(text, confidence, False) for text, confidence in lines]
    recipient_segments = _recipient_segments(lines)
    has_recipient_marker = bool(recipient_segments) or any(
        re.search(RECIPIENT_MARKER, normalized(text).upper()) for text, _confidence in lines
    )
    has_sender_marker = any(
        re.search(SENDER_MARKER, normalized(text).upper()) for text, _confidence in lines
    )

    # Tracking and carrier describe the shipment, so they are safe to read globally.
    _set_pattern_field(
        fields,
        "trackingCode",
        r"\b([A-Z]{2}\d{9}[A-Z]{2})\b",
        all_segments,
    )
    _set_pattern_field(
        fields,
        "carrier",
        r"\b(CORREIOS|JADLOG|LOGGI|SEDEX|MERCADO LIVRE|AMAZON)\b",
        all_segments,
    )

    # Recipient-scoped fields must never be taken from a marked sender section.
    # Without a positive recipient marker, a sender-labelled document is left for
    # human confirmation instead of producing a confident but incorrect match.
    scoped_segments = recipient_segments
    if not has_recipient_marker and not has_sender_marker:
        scoped_segments = all_segments

    _set_pattern_field(
        fields,
        "block",
        r"\b(?:BLOCO|BL\.?|TORRE)\s*[:\-]?\s*([A-Z0-9]{1,8})\b",
        scoped_segments,
    )
    _set_pattern_field(
        fields,
        "apartment",
        r"\b(?:APARTAMENTO|APTO|APT|AP)\b\.?\s*[:\-]?\s*([A-Z0-9]{1,8})\b",
        scoped_segments,
    )
    _set_pattern_field(
        fields,
        "address",
        r"\b((?:RUA|AVENIDA|AV\.|ALAMEDA|RODOVIA|TRAVESSA|PRACA)\s+.{3,180})",
        scoped_segments,
    )

    for text, confidence, inline in scoped_segments:
        value = _name_candidate(text, explicit=has_recipient_marker or inline)
        if value:
            cap = 0.95 if has_recipient_marker else 0.65
            fields["recipientName"] = {
                "value": value,
                "confidence": round(min(max(0, confidence), cap), 3),
            }
            break

    return fields

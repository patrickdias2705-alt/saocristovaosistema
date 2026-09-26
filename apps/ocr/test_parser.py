import os
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from parser import parse_lines
os.environ["OCR_SKIP_PRELOAD"] = "true"
from main import app, preprocess  # noqa: E402


def test_label():
    result = parse_lines([("Destinatário: Maria Aparecida Silva", .98),
                          ("Bloco 18 Apartamento 66", .97), ("AB123456789BR", .99)])
    assert result["recipientName"]["value"] == "Maria Aparecida Silva"
    assert result["block"]["value"] == "18"
    assert result["apartment"]["value"] == "66"
    assert result["trackingCode"]["value"] == "AB123456789BR"


def test_missing_is_null_not_invented():
    result = parse_lines([("correios", .9)])
    assert result["recipientName"]["value"] is None
    assert result["block"]["confidence"] == 0


def test_low_confidence_does_not_increase():
    assert parse_lines([("Bloco 18", .2)])["block"]["confidence"] == .2


def test_recipient_section_wins_over_sender_name_and_unit():
    result = parse_lines([
        ("REMETENTE", .99),
        ("Loja Exemplo Comercio", .99),
        ("Rua da Origem, 20 Bloco 2 Apto 11", .98),
        ("DESTINATÁRIO", .96),
        ("Maria Aparecida Silva", .94),
        ("Rua São Cristóvão, 100 Bloco 18 Apartamento 66", .92),
    ])
    assert result["recipientName"]["value"] == "Maria Aparecida Silva"
    assert result["block"]["value"] == "18"
    assert result["apartment"]["value"] == "66"
    assert "São Cristóvão" in result["address"]["value"]


def test_inline_sender_and_recipient_are_split():
    result = parse_lines([
        ("Remetente: Loja Central - Destinatário: João da Silva", .97),
        ("Bloco B Apto 42", .95),
    ])
    assert result["recipientName"]["value"] == "João da Silva"
    assert result["block"]["value"] == "B"
    assert result["apartment"]["value"] == "42"


def test_sender_only_never_becomes_recipient():
    result = parse_lines([
        ("Remetente: Loja Exemplo Comercio", .99),
        ("Rua da Origem Bloco 2 Apto 11", .98),
        ("AB123456789BR", .97),
    ])
    assert result["recipientName"]["value"] is None
    assert result["block"]["value"] is None
    assert result["apartment"]["value"] is None
    assert result["trackingCode"]["value"] == "AB123456789BR"


def test_recipient_text_stops_before_sender_on_same_line():
    result = parse_lines([
        ("Destinatário: Ana Souza Remetente: Mercado Exemplo", .96),
    ])
    assert result["recipientName"]["value"] == "Ana Souza"


def test_invalid_image():
    with pytest.raises(HTTPException) as error:
        preprocess(b"not an image")
    assert error.value.status_code == 422


def test_auth_required():
    response = TestClient(app).post("/recognize", files={"file": ("x.png", b"x", "image/png")})
    assert response.status_code == 401

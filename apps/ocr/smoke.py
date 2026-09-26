"""Manual real-model smoke; deliberately separate from deterministic unit tests."""
import io
from pathlib import Path
import time

from PIL import Image, ImageDraw, ImageFont

from providers import PaddleOCRProvider
from main import preprocess
from parser import parse_lines


def mixed_sender_recipient_label() -> bytes:
    image = Image.new("RGB", (1500, 1100), "white")
    draw = ImageDraw.Draw(image)
    font_path = "C:/Windows/Fonts/arial.ttf"
    if not Path(font_path).exists():
        font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    heading = ImageFont.truetype(font_path, 46)
    body = ImageFont.truetype(font_path, 54)
    draw.rectangle((40, 40, 1460, 1060), outline="black", width=3)
    draw.text((80, 85), "REMETENTE", fill="black", font=heading)
    draw.text((80, 155), "Loja Exemplo Comercio", fill="black", font=body)
    draw.text((80, 235), "Bloco 2  Apto 11", fill="black", font=body)
    draw.line((70, 340, 1430, 340), fill="black", width=3)
    draw.text((80, 390), "DESTINATARIO", fill="black", font=heading)
    draw.text((80, 470), "Joao da Silva", fill="black", font=body)
    draw.text((80, 550), "Bloco B  Apto 42", fill="black", font=body)
    draw.text((80, 680), "Correios", fill="black", font=body)
    draw.text((80, 770), "AB123456789BR", fill="black", font=body)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


started = time.perf_counter()
provider = PaddleOCRProvider()
image = preprocess((Path(__file__).resolve().parents[2] / "docs/demo-label.png").read_bytes())
result = parse_lines(provider.recognize(image))
assert result["block"]["value"] == "18", "Block not recognized"
assert result["apartment"]["value"] == "66", "Apartment not recognized"
assert "MARIA" in (result["recipientName"]["value"] or "").upper(), "Recipient not recognized"

mixed = parse_lines(provider.recognize(preprocess(mixed_sender_recipient_label())))
assert "JOAO" in (mixed["recipientName"]["value"] or "").upper(), "Recipient section lost"
assert mixed["block"]["value"] == "B", "Sender block was selected"
assert mixed["apartment"]["value"] == "42", "Sender apartment was selected"
print(f"Real PaddleOCR smokes passed ({time.perf_counter() - started:.1f}s)")

"""Generate a fictional, high-contrast OCR validation label (not customer data)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
image = Image.new("RGB", (1400, 900), "white")
draw = ImageDraw.Draw(image)
font_path = "C:/Windows/Fonts/arial.ttf"
if not Path(font_path).exists():
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font = ImageFont.truetype(font_path, 50)
small = ImageFont.truetype(font_path, 32)
draw.rectangle((45, 45, 1355, 855), outline="black", width=3)
draw.text((85, 80), "ETIQUETA DE DEMONSTRACAO", fill="black", font=small)
draw.text((85, 165), "Destinatario: Maria Aparecida Silva", fill="black", font=font)
draw.text((85, 270), "Bloco 18", fill="black", font=font)
draw.text((85, 370), "Apartamento 66", fill="black", font=font)
draw.text((85, 485), "Condominio Sao Cristovao", fill="black", font=small)
draw.text((85, 560), "Correios", fill="black", font=font)
draw.text((85, 670), "AB123456789BR", fill="black", font=font)
draw.text((85, 790), "DADOS FICTICIOS - SEM VALIDADE POSTAL", fill="black", font=small)
target = root / "docs" / "demo-label.png"
image.save(target)
print("Created docs/demo-label.png")

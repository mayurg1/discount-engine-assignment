"""Generate deterministic, text-based PDF fixtures for PDF cart upload tests.

This uses only Python's standard library and writes simple PDF 1.4 files with
native Helvetica text and vector table borders. It intentionally does not create
images, so PDF.js can extract each cell's text and coordinates.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "sample-data"
ROWS = [
    ("Cushion Cover", "Natura Casa", "Amazon India", "Rs.1,299"),
    ("Bed Sheet Set", "Natura Casa", "Flipkart", "Rs.849"),
    ("Wall Shelf", "LivSpace Pro", "Amazon India", "Rs.599"),
    ("Ceramic Vase", "LivSpace Pro", "Noon", "Rs.2,499"),
    ("Cutting Board", "Nordic Basics", "Amazon India", "Rs.449"),
    ("Desk Organiser", "Nordic Basics", "Flipkart", "Rs.899"),
]


def escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def text(x: int, y: int, value: str, size: int = 10, bold: bool = False) -> str:
    font = "F2" if bold else "F1"
    return f"BT /{font} {size} Tf {x} {y} Td ({escape_pdf_text(value)}) Tj ET"


def make_content(rows: list[tuple[str, str, str, str]]) -> bytes:
    left, top, row_height = 45, 680, 30
    widths = [160, 150, 140, 110]
    headers = ["Product", "Brand", "Platform", "Base Price"]
    commands = ["0.08 w", text(45, 748, "Opptra Cart", 16, True), text(45, 725, "Order #OP-9921", 10), text(180, 725, "Date: 15 Jan 2025", 10)]
    table_bottom = top - row_height * (len(rows) + 1)
    x = left
    for width in widths:
        commands.append(f"{x} {top} m {x} {table_bottom} l S")
        x += width
    commands.append(f"{x} {top} m {x} {table_bottom} l S")
    for index in range(len(rows) + 2):
        y = top - index * row_height
        commands.append(f"{left} {y} m {left + sum(widths)} {y} l S")
    x_positions = [left + 7]
    for width in widths[:-1]:
        x_positions.append(x_positions[-1] + width)
    for x, label in zip(x_positions, headers):
        commands.append(text(x, top - 19, label, 10, True))
    for index, values in enumerate(rows):
        y = top - row_height * (index + 1) - 19
        for x, value in zip(x_positions, values):
            commands.append(text(x, y, value, 10))
    return ("\n".join(commands) + "\n").encode("latin-1")


def write_pdf(path: Path, rows: list[tuple[str, str, str, str]]) -> None:
    stream = make_content(rows)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"endstream",
    ]
    data = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, object_data in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{number} 0 obj\n".encode("ascii"))
        data.extend(object_data)
        data.extend(b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    data.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    path.write_bytes(data)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write_pdf(OUTPUT / "sample-cart.pdf", ROWS)
    invalid_rows = list(ROWS)
    invalid_rows[2] = (*invalid_rows[2][:3], "not-a-price")
    write_pdf(OUTPUT / "sample-cart-invalid.pdf", invalid_rows)
    print("Generated sample-data/sample-cart.pdf and sample-data/sample-cart-invalid.pdf")


if __name__ == "__main__":
    main()

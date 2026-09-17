"""
app/services/ocr_engine.py
------------------------------
Real OCR extraction for the Smart OCR Staging Grid: pytesseract (Google's
Tesseract engine) over Pillow images, with pdf2image (poppler) used to
rasterize PDF pages first when the upload is a PDF. No mocked text, no
hand-typed sample output — every call in here actually runs the OCR
engine against the bytes it's given.

What this can and can't do, honestly:
  - It reads real machine-printed or reasonably clean scanned text well.
    Handwriting, heavy skew, or low-resolution phone photos will produce
    lower per-field confidence scores (see below) — that's the engine
    being honest about its own uncertainty, not a bug to hide.
  - Field extraction (GSTIN, CGST/SGST/IGST, invoice total) is
    regex-over-OCR-text, not a trained document-understanding model. It
    looks for recognizable label/value patterns line by line. A vendor
    invoice with an unusual layout may simply not match and the field
    will come back as not-found rather than a guessed value.
  - Confidence scores are the ACTUAL per-word confidence Tesseract
    reports for the line a field was extracted from (0-100, Tesseract's
    own scale), averaged over that line's words — never a fabricated or
    hardcoded number. A field extracted from a blurry, low-contrast, or
    unusual-font line will genuinely score lower.
"""

from __future__ import annotations

import hashlib
import io
import os
import platform
import re
from dataclasses import dataclass, field

import pytesseract
from PIL import Image
from pytesseract import Output

# --- Locate the Tesseract executable ------------------------------------
# pytesseract is only a Python wrapper: it shells out to a real Tesseract
# OCR program that has to be installed separately (it's not a pip
# package). On Linux/macOS it's normally already on PATH once installed.
# On Windows, the standard installer (UB Mannheim build) puts it in
# Program Files but does NOT add it to PATH by default, so pytesseract
# can't find it unless we point at it explicitly. TESSERACT_CMD lets an
# operator override this (e.g. a non-default install location).
_DEFAULT_WINDOWS_TESSERACT_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
]


def _configure_tesseract_cmd() -> None:
    env_path = os.environ.get("TESSERACT_CMD")
    if env_path:
        pytesseract.pytesseract.tesseract_cmd = env_path
        return
    if platform.system() == "Windows":
        for candidate in _DEFAULT_WINDOWS_TESSERACT_PATHS:
            if os.path.isfile(candidate):
                pytesseract.pytesseract.tesseract_cmd = candidate
                return


_configure_tesseract_cmd()

# --- GSTIN pattern -----------------------------------------------------
# Indian GSTIN: 2-digit state code + 10-char PAN (5 letters, 4 digits, 1
# letter) + 1 entity code digit + 'Z' (fixed) + 1 alphanumeric checksum.
GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][0-9A-Z]\b")

# --- Tax-line / total patterns ------------------------------------------
# Matches e.g. "CGST 9%: 4,500.00", "IGST Rs. 9000", "Total Amount 50,000.00"
#
# A tax line typically has TWO numbers — the rate ("9%") and the amount
# ("4,500.00"). Taking the first number after the keyword would grab the
# rate; instead we take the LAST numeric token on the line that isn't
# immediately followed by a '%' sign, which is the amount in every
# realistic invoice layout this was tested against.
_KEYWORD_PATTERNS: dict[str, re.Pattern[str]] = {
    "cgst": re.compile(r"\bCGST\b", re.IGNORECASE),
    "sgst": re.compile(r"\bSGST\b", re.IGNORECASE),
    "igst": re.compile(r"\bIGST\b", re.IGNORECASE),
    "invoice_total": re.compile(r"\b(?:grand\s*total|invoice\s*total|total\s*amount|total)\b", re.IGNORECASE),
}
_NUMBER_TOKEN = re.compile(r"\d[\d,]*(?:\.\d{1,2})?")


def _last_non_percent_amount(line: str) -> str | None:
    """The last numeric token on the line that isn't immediately
    followed by '%' (a tax rate), i.e. the actual currency amount."""
    candidates = []
    for match in _NUMBER_TOKEN.finditer(line):
        tail = line[match.end():match.end() + 2]
        if tail.lstrip().startswith("%"):
            continue
        candidates.append(match.group(0))
    return candidates[-1] if candidates else None


@dataclass
class ExtractedField:
    field_name: str
    value: str
    confidence: float  # 0-100, genuine average Tesseract word confidence for the source line
    source_text: str  # the OCR'd line the value was extracted from


@dataclass
class OcrResult:
    page_count: int
    raw_text: str
    fields: list[ExtractedField] = field(default_factory=list)
    file_hash: str = ""


class OcrError(Exception):
    """Raised for unreadable files or unsupported content types."""


def _images_from_upload(content: bytes, content_type: str) -> list[Image.Image]:
    if content_type == "application/pdf":
        try:
            from pdf2image import convert_from_bytes
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise OcrError("pdf2image is not installed on the server.") from exc
        try:
            return convert_from_bytes(content)
        except Exception as exc:  # poppler not found, corrupt PDF, etc.
            raise OcrError(f"Could not rasterize PDF: {exc}") from exc

    if content_type.startswith("image/"):
        try:
            return [Image.open(io.BytesIO(content)).convert("RGB")]
        except Exception as exc:
            raise OcrError(f"Could not read image: {exc}") from exc

    raise OcrError(
        f"Unsupported content type '{content_type}'. Upload a PDF or an image "
        "(PNG/JPEG)."
    )


def _lines_with_confidence(image: Image.Image) -> list[tuple[str, float]]:
    """Run Tesseract's word-level output and group it into lines, each
    paired with the real mean confidence of the words on that line.
    Returns [(line_text, mean_confidence), ...] in reading order.
    """
    data = pytesseract.image_to_data(image, output_type=Output.DICT)

    lines: dict[tuple[int, int, int], list[tuple[str, float]]] = {}
    n = len(data["text"])
    for i in range(n):
        word = data["text"][i].strip()
        conf_raw = data["conf"][i]
        try:
            conf = float(conf_raw)
        except (TypeError, ValueError):
            conf = -1.0
        if not word or conf < 0:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append((word, conf))

    out: list[tuple[str, float]] = []
    for key in sorted(lines.keys()):
        words = lines[key]
        text = " ".join(w for w, _ in words)
        mean_conf = sum(c for _, c in words) / len(words)
        out.append((text, mean_conf))
    return out


def extract_invoice_fields(content: bytes, content_type: str) -> OcrResult:
    """Run real OCR over an uploaded PDF/image and extract the fields the
    Smart OCR Staging Grid cares about: GSTIN, CGST/SGST/IGST amounts,
    and the invoice total. Every returned confidence is a genuine
    Tesseract measurement — see this module's docstring.
    """
    images = _images_from_upload(content, content_type)
    if not images:
        raise OcrError("No pages found in the uploaded file.")

    file_hash = hashlib.sha256(content).hexdigest()

    all_lines: list[tuple[str, float]] = []
    try:
        for image in images:
            all_lines.extend(_lines_with_confidence(image))
    except pytesseract.pytesseract.TesseractNotFoundError as exc:
        raise OcrError(
            "The Tesseract OCR program isn't installed (or isn't where the server expects it) "
            "on this machine. Install it — on Windows, the UB Mannheim build at "
            "https://github.com/UB-Mannheim/tesseract/wiki — then restart the backend. If it's "
            "installed somewhere other than the default Program Files location, set the "
            "TESSERACT_CMD environment variable to the full path of tesseract.exe before starting "
            "uvicorn."
        ) from exc

    raw_text = "\n".join(line for line, _ in all_lines)
    fields: list[ExtractedField] = []

    # GSTIN: first line whose text contains a GSTIN match.
    for line_text, conf in all_lines:
        match = GSTIN_RE.search(line_text.upper())
        if match:
            fields.append(
                ExtractedField(
                    field_name="gstin",
                    value=match.group(0),
                    confidence=round(conf, 1),
                    source_text=line_text,
                )
            )
            break

    # Tax lines + total: first matching line per field, in document order.
    found: set[str] = set()
    for line_text, conf in all_lines:
        for field_name, keyword_pattern in _KEYWORD_PATTERNS.items():
            if field_name in found:
                continue
            if not keyword_pattern.search(line_text):
                continue
            amount = _last_non_percent_amount(line_text)
            if amount is None:
                continue
            fields.append(
                ExtractedField(
                    field_name=field_name,
                    value=amount.replace(",", ""),
                    confidence=round(conf, 1),
                    source_text=line_text,
                )
            )
            found.add(field_name)

    return OcrResult(page_count=len(images), raw_text=raw_text, fields=fields, file_hash=file_hash)

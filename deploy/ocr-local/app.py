"""
Локальный OCR документов (СТС / позже паспорт) — только 127.0.0.1.
Фото не уходят во внешние API.
"""
from __future__ import annotations

import base64
import io
import os
import re
import tempfile
from typing import Any, Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

from sts_parse import parse_sts_text
from passport_parse import parse_passport_text


app = FastAPI(title="uchet1-ocr-local", version="0.1.1")

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _engine = RapidOCR()
    return _engine


class OcrImage(BaseModel):
    mime: str | None = "image/jpeg"
    data_base64: str


class OcrRequest(BaseModel):
    doc_type: Literal["sts", "passport_rf", "auto"] = "sts"
    images: list[OcrImage] = Field(default_factory=list)


def decode_image(img: OcrImage, *, preprocess: bool = True) -> Image.Image:
    raw = (img.data_base64 or "").strip()
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    raw = "".join(raw.split())
    if len(raw) < 80:
        raise HTTPException(400, "empty image")
    try:
        buf = base64.b64decode(raw, validate=False)
    except Exception as e:
        raise HTTPException(400, f"bad base64: {e}") from e
    if len(buf) < 80:
        raise HTTPException(400, "image too small")
    if len(buf) > 12_000_000:
        raise HTTPException(400, "image too large")
    try:
        from PIL import ImageEnhance, ImageFilter, ImageOps

        pil = Image.open(io.BytesIO(buf))
        pil = ImageOps.exif_transpose(pil).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"cannot open image: {e}") from e
    if preprocess:
        try:
            from PIL import ImageEnhance, ImageFilter, ImageOps

            gray = ImageOps.autocontrast(pil.convert("L"), cutoff=1)
            gray = ImageEnhance.Contrast(gray).enhance(1.35)
            gray = gray.filter(ImageFilter.SHARPEN)
            pil = gray.convert("RGB")
        except Exception:
            pass
    # ограничить размер — 2 CPU / 4GB; мелкие кадры чуть увеличить
    max_side = 1800
    min_side = 1100
    w, h = pil.size
    long_side = max(w, h)
    if long_side < min_side:
        scale = min_side / long_side
        pil = pil.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    else:
        scale = min(1.0, max_side / long_side)
        if scale < 0.999:
            pil = pil.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS
            )
    return pil


def pil_to_arr(pil: Image.Image) -> np.ndarray:
    return np.asarray(pil.convert("RGB"))


def run_ocr(arr: np.ndarray) -> str:
    engine = get_engine()
    result, _ = engine(arr)
    if not result:
        return ""
    lines: list[str] = []
    for row in result:
        # row: [box, text, score]
        if not row or len(row) < 2:
            continue
        text = str(row[1] or "").strip()
        if text:
            lines.append(text)
    return "\n".join(lines)


def ocr_passport_best(pil: Image.Image) -> tuple[str, int]:
    """
    Разворот часто снимают «на боку» (телефон landscape).
    Пробуем 0/90/180/270 и берём текст с лучшим score парсера.
    Для landscape сначала 90/270 — чаще «поставить» бланк вертикально.
    """
    best_text = ""
    best_score = -1
    best_rot = 0
    w, h = pil.size
    rotations = (90, 270, 0, 180) if w >= h else (0, 90, 180, 270)
    for rot in rotations:
        frame = pil if rot == 0 else pil.rotate(rot, expand=True)
        text = run_ocr(pil_to_arr(frame))
        parsed = parse_passport_text(text)
        score = int(parsed.get("score") or 0)
        fio = str((parsed.get("fields") or {}).get("fio") or "")
        if re.search(r"(ич|вна|евич|овна)$", fio.split()[-1] if fio.split() else "", re.I):
            score += 6
        if score > best_score or (score == best_score and len(text) > len(best_text)):
            best_score = score
            best_text = text
            best_rot = rot
    if best_rot and best_text:
        best_text = f"{best_text}\n<!--rot:{best_rot}-->"
    return best_text, best_score


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "ocr-local",
        "mode": "on-prem",
        "engine": "rapidocr-onnxruntime",
        "loaded": _engine is not None,
        "version": "0.1.1",
    }


@app.post("/ocr/parse")
def ocr_parse(body: OcrRequest):
    if not body.images:
        raise HTTPException(400, "images required")
    if len(body.images) > 4:
        raise HTTPException(400, "max 4 images")

    doc = body.doc_type
    if doc == "auto":
        doc = "sts"

    texts: list[str] = []
    if doc == "passport_rf":
        for img in body.images:
            pil = decode_image(img)
            text, _ = ocr_passport_best(pil)
            texts.append(text)
    else:
        for img in body.images:
            arr = pil_to_arr(decode_image(img))
            texts.append(run_ocr(arr))

    joined = "\n---\n".join(t for t in texts if t)

    if doc == "sts":
        parsed = parse_sts_text(joined)
        fields = parsed["fields"]
        ok = parsed["filled"] >= 1 and (
            bool(fields.get("car_plate"))
            or bool(fields.get("car_vin"))
            or (bool(fields.get("car_brand")) and bool(fields.get("car_year")))
        )
        return JSONResponse(
            {
                "ok": ok,
                "doc_type": "sts",
                "source": "local",
                "model": "rapidocr-onnxruntime",
                "vehicle": fields,
                "raw_text": joined[:8000],
                "filled": parsed["filled"],
                "image_sides": ["unknown"] * len(body.images),
            }
        )

    if doc == "passport_rf":
        parsed = parse_passport_text(joined)
        fields = parsed["fields"]
        ok = bool(fields.get("fio") or fields.get("passport"))
        return JSONResponse(
            {
                "ok": ok,
                "doc_type": "passport_rf",
                "source": "local",
                "model": "rapidocr-onnxruntime",
                "fields": fields,
                "raw_text": joined[:8000],
                "filled": parsed["filled"],
                "error": None
                if ok
                else "Не удалось вытащить ФИО/серию из фото — переснимите разворот с ФИО или введите вручную.",
            }
        )

    raise HTTPException(400, f"unknown doc_type: {doc}")


@app.post("/ocr/warmup")
def warmup():
    """Прогрев модели (первый вызов тяжёлый)."""
    get_engine()
    # крошечное изображение
    arr = np.zeros((64, 64, 3), dtype=np.uint8)
    arr[:] = 255
    try:
        run_ocr(arr)
    except Exception:
        pass
    return {"ok": True, "loaded": True}


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("OCR_LOCAL_HOST", "127.0.0.1")
    port = int(os.environ.get("OCR_LOCAL_PORT", "3105"))
    uvicorn.run("app:app", host=host, port=port, workers=1)

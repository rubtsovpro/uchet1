"""Из сырого OCR-текста паспорта РФ → ФИО + серия/номер (без внешней сети)."""
from __future__ import annotations

import re
from typing import Any

# серия 4 цифры + номер 6 (часто «03 24 979938» / «0324 979938» / «0324979938»)
SERIES_NUM_RE = re.compile(
    r"(?<!\d)(\d{2})\s*(\d{2})\s+(\d{6})(?!\d)|(?<!\d)(\d{4})\s+(\d{6})(?!\d)|(?<!\d)(\d{10})(?!\d)"
)
# MRZ строка 1: P<RUSRUBCOV<<SERGEY<…  (OCR часто: PNRUS / P RUS / P«RUS)
# Фамилия без «<» — иначе жадный захват съест весь MRZ до последнего <<
MRZ_NAME_RE = re.compile(
    r"P[<\sN«\"']{0,2}RUS([A-Z0-9]{2,40})<<([A-Z0-9<]{2,80})",
    re.I,
)
# MRZ строка 2: 03249799384RUS8512039M…
MRZ_ID_RE = re.compile(r"(?<!\d)(\d{2})(\d{2})(\d{6})\d?RUS", re.I)

# ICAO Doc 9303 латиница паспорта РФ → кириллица (длинные сначала)
_MRZ_DIGRAPHS = (
    ("SHCH", "Щ"),
    ("SH", "Ш"),
    ("CH", "Ч"),
    ("ZH", "Ж"),
    ("KH", "Х"),
    ("TS", "Ц"),
    ("IU", "Ю"),
    ("IA", "Я"),
    ("YA", "Я"),
    ("YU", "Ю"),
    ("YO", "Ё"),
    ("IE", "Ъ"),
)
_MRZ_SINGLE = {
    "A": "А",
    "B": "Б",
    "V": "В",
    "G": "Г",
    "D": "Д",
    "E": "Е",
    "Z": "З",
    "I": "И",
    "K": "К",
    "L": "Л",
    "M": "М",
    "N": "Н",
    "O": "О",
    "P": "П",
    "R": "Р",
    "C": "С",  # ICAO; Цов см. preprocess COV→TS
    "S": "С",  # SERGEY и англ. написание имён
    "T": "Т",
    "U": "У",
    "F": "Ф",
    "Y": "Ы",
    "J": "Й",
    "H": "Х",
    "W": "В",
    "X": "КС",
    "Q": "К",
}

SKIP_LINE = re.compile(
    r"^(российская|федерация|passport|паспорт|фамилия|имя|отчество|surname|given|"
    r"sex|пол|date|дата|place|место|issued|выдан|код|code|authority|"
    r"гражданство|nationality|birth|рожден|муж|жен|m|f|\d{2}[./]\d{2}|"
    r"гор\.|г\.|край|област|республик)",
    re.I,
)

FIO_WORD = re.compile(r"^[А-ЯЁ][а-яёА-ЯЁ\-]{1,40}$")
FIO_CAPS = re.compile(r"^[А-ЯЁ][А-ЯЁ\-]{1,40}$")


def _norm_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _title_ru(s: str) -> str:
    parts = []
    for w in _norm_spaces(s).split(" "):
        if not w:
            continue
        if "-" in w:
            parts.append("-".join(p[:1].upper() + p[1:].lower() if p else "" for p in w.split("-")))
        else:
            parts.append(w[:1].upper() + w[1:].lower())
    return " ".join(parts)


def _mrz_token_to_cyr(token: str) -> str:
    """Один токен MRZ (фамилия / имя / отчество) → кириллица."""
    s = re.sub(r"[^A-Z]", "", (token or "").upper())
    if not s:
        return ""
    # частые OCR-ошибки в MRZ
    if s.endswith("Q") and len(s) > 3:  # SERGEQ → SERGEY
        s = s[:-1] + "Y"
    if re.search(r"EVI$", s):  # NIKOLAEVI → NIKOLAEVICH
        s += "CH"
    elif re.search(r"OVIC$", s):
        s += "H"
    elif re.search(r"EVIC$", s):
        s += "H"
    # финальный Y в имени часто = Й (SERGEY → СЕРГЕЙ)
    end_y_as_i = s.endswith("Y") and len(s) > 2
    if end_y_as_i:
        s = s[:-1]
    # упрощённая транслит: ЦОВ/ЦЕВ пишут COV/CEV (РУБЦОВ→RUBCOV)
    s = re.sub(r"C(?=OV|EV|OVA|EVA)", "TS", s)
    out: list[str] = []
    i = 0
    while i < len(s):
        hit = None
        for lat, cyr in _MRZ_DIGRAPHS:
            if s.startswith(lat, i):
                hit = (len(lat), cyr)
                break
        if hit:
            out.append(hit[1])
            i += hit[0]
            continue
        ch = s[i]
        out.append(_MRZ_SINGLE.get(ch, ""))
        i += 1
    if end_y_as_i:
        out.append("Й")
    return _title_ru("".join(out))


def parse_series_number(text: str) -> str:
    # сначала из MRZ (надёжнее при кривом OCR разворота)
    m = MRZ_ID_RE.search(re.sub(r"\s+", "", text or ""))
    if m:
        return f"{m.group(1)} {m.group(2)} {m.group(3)}"
    m = SERIES_NUM_RE.search(text.replace("\n", " "))
    if not m:
        return ""
    if m.group(1) and m.group(2) and m.group(3):
        return f"{m.group(1)} {m.group(2)} {m.group(3)}"
    if m.group(4) and m.group(5):
        a, b = m.group(4), m.group(5)
        return f"{a[:2]} {a[2:]} {b}"
    if m.group(6):
        a = m.group(6)
        return f"{a[:2]} {a[2:4]} {a[4:]}"
    return ""


def parse_fio_from_mrz(text: str) -> str:
    compact = re.sub(r"[\s\"']+", "", text or "")
    m = MRZ_NAME_RE.search(compact)
    if not m:
        return ""
    last = _mrz_token_to_cyr(m.group(1))
    rest_raw = m.group(2).replace("<", " ").strip()
    rest_parts = [_mrz_token_to_cyr(p) for p in rest_raw.split() if p]
    bits = [x for x in [last, *rest_parts] if x and len(x) > 1]
    if len(bits) >= 2:
        return " ".join(bits[:3])
    return ""


def parse_fio_from_lines(text: str) -> str:
    lines = [_norm_spaces(x) for x in (text or "").splitlines()]
    lines = [x for x in lines if x]

    labeled: dict[str, str] = {}
    for i, line in enumerate(lines):
        low = line.lower()
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        nxt0 = nxt.split()[0] if nxt else ""

        def take_cyr(candidate: str) -> str:
            # «РУБЦОВ / RUBCOV» или «РУБЦОВ RUBCOV»
            for part in re.split(r"[/|,;]+|\s{2,}", candidate):
                part = part.strip()
                w = part.split()[0] if part else ""
                if FIO_WORD.match(w) or FIO_CAPS.match(w):
                    return w
            return ""

        if re.search(r"фамил|surname", low):
            v = take_cyr(line.split(":", 1)[-1] if ":" in line else "") or take_cyr(nxt)
            if v:
                labeled["last"] = v
        if re.search(r"(^|\b)имя\b|given\s*name|^name$", low) and not re.search(r"отчеств", low):
            v = take_cyr(line.split(":", 1)[-1] if ":" in line else "") or take_cyr(nxt)
            if v:
                labeled["first"] = v
        if re.search(r"отчеств|patronym", low):
            v = take_cyr(line.split(":", 1)[-1] if ":" in line else "") or take_cyr(nxt)
            if v:
                labeled["mid"] = v

        m = re.search(r"(?:фамил\w*|surname)\s*[:/\s]+([А-ЯЁ][а-яёА-ЯЁ\-]+)", line, re.I)
        if m:
            labeled["last"] = m.group(1)
        m = re.search(r"(?:^|\s)имя\s*[:/\s]+([А-ЯЁ][а-яёА-ЯЁ\-]+)", line, re.I)
        if m and "отчеств" not in low:
            labeled["first"] = m.group(1)
        m = re.search(r"отчеств\w*\s*[:/\s]+([А-ЯЁ][а-яёА-ЯЁ\-]+)", line, re.I)
        if m:
            labeled["mid"] = m.group(1)

    if labeled.get("last") and labeled.get("first"):
        return _title_ru(
            " ".join(x for x in [labeled["last"], labeled["first"], labeled.get("mid") or ""] if x)
        )

    # Три подряд строки КАПСОМ (типичный разворот: РУБЦОВ / СЕРГЕЙ / НИКОЛАЕВИЧ)
    caps_idx = [i for i, ln in enumerate(lines) if FIO_CAPS.match(ln.split()[0]) and len(ln.split()) <= 2]
    for i in range(len(caps_idx) - 2):
        a, b, c = caps_idx[i], caps_idx[i + 1], caps_idx[i + 2]
        if b == a + 1 and c == a + 2:
            wa = lines[a].split()[0]
            wb = lines[b].split()[0]
            wc = lines[c].split()[0]
            if SKIP_LINE.search(wa) or SKIP_LINE.search(wb):
                continue
            cand = _title_ru(f"{wa} {wb} {wc}")
            if re.search(r"(ич|вна|кызы|оглы|евич|овна)$", wc, re.I):
                return cand
            # всё равно кандидат
            if not labeled:
                labeled = {"last": wa, "first": wb, "mid": wc}

    if labeled.get("last") and labeled.get("first"):
        return _title_ru(
            " ".join(x for x in [labeled["last"], labeled["first"], labeled.get("mid") or ""] if x)
        )

    cands: list[str] = []
    for line in lines:
        if SKIP_LINE.search(line):
            continue
        words = line.split()
        if len(words) == 3 and all(FIO_WORD.match(w) or re.match(r"^[А-ЯЁ\-]{2,}$", w) for w in words):
            cands.append(_title_ru(" ".join(words)))
        if len(words) >= 3:
            trip = words[:3]
            if all(re.match(r"^[А-ЯЁа-яё\-]{2,}$", w) for w in trip):
                if sum(1 for w in trip if w[:1].isupper() or w.isupper()) >= 2:
                    cands.append(_title_ru(" ".join(trip)))
    if cands:
        for c in cands:
            if re.search(r"(ич|вна|кызы|оглы)$", c.split()[-1], re.I):
                return c
        return cands[0]
    return ""


def passport_text_score(text: str) -> int:
    """Насколько текст похож на разворот паспорта (для выбора угла поворота)."""
    t = text or ""
    low = t.lower()
    score = 0
    if re.search(r"фамил|surname", low):
        score += 3
    if re.search(r"отчеств|patronym", low):
        score += 2
    if re.search(r"\bимя\b|given", low):
        score += 2
    if re.search(r"p[<\sn«]?rus", low, re.I):
        score += 4
    if re.search(r"российск|passport|паспорт", low):
        score += 2
    if SERIES_NUM_RE.search(t.replace("\n", " ")) or MRZ_ID_RE.search(re.sub(r"\s+", "", t)):
        score += 3
    # кириллические «слова» капсом
    caps = len(re.findall(r"\b[А-ЯЁ]{3,}\b", t))
    score += min(caps, 8)
    return score


def _looks_like_solid_fio(name: str) -> bool:
    parts = _norm_spaces(name).split()
    if len(parts) < 2:
        return False
    if not all(re.match(r"^[А-ЯЁа-яё\-]+$", p) for p in parts):
        return False
    # отчество / типичные окончания фамилий
    if len(parts) >= 3 and re.search(r"(ич|вна|кызы|оглы|евич|овна)$", parts[-1], re.I):
        return True
    return len(parts) >= 2 and all(len(p) >= 3 for p in parts[:2])


def parse_passport_text(raw: str) -> dict[str, Any]:
    text = raw or ""
    series = parse_series_number(text)
    fio_mrz = parse_fio_from_mrz(text)
    fio_lines = parse_fio_from_lines(text)
    # MRZ надёжнее кривой «кириллицы» с бокового снимка; визуал берём если он полный
    if fio_mrz and _looks_like_solid_fio(fio_mrz):
        if fio_lines and _looks_like_solid_fio(fio_lines) and len(fio_lines.split()) >= 3:
            # если визуал и MRZ совпадают по фамилии — предпочитаем визуал (Ц/С)
            if fio_lines.split()[0].lower() == fio_mrz.split()[0].lower():
                fio = fio_lines
            else:
                fio = fio_mrz
        else:
            fio = fio_mrz
    else:
        fio = fio_lines or fio_mrz
    fields = {
        "fio": fio,
        "passport": series,
        "buyer_name": fio,
        "buyer_passport": series,
    }
    filled = sum(1 for v in (fio, series) if v)
    score = passport_text_score(text) + filled * 5
    if fio_mrz and _looks_like_solid_fio(fio_mrz):
        score += 8
    return {"fields": fields, "filled": filled, "score": score}

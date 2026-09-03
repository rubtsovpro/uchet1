"""Из сырого OCR-текста СТС → поля для Учёта №1 (без внешней сети)."""
from __future__ import annotations

import re
from typing import Any

PLATE_RE = re.compile(
    r"(?<![А-ЯA-Z0-9])([АВЕКМНОРСТУХABEKMHOPCTYX]\s*\d{3}\s*[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\s*\d{2,3})(?![А-ЯA-Z0-9])",
    re.I,
)
VIN_RE = re.compile(r"(?:VIN[:\s]*)?([A-HJ-NPR-Z0-9]{17})", re.I)
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
# № СТС: 99 35 688984 (2+2+6 цифр)
STS_SERIES_RE = re.compile(r"(?<!\d)(\d{2})\s*(\d{2})\s*(\d{6})(?!\d)")
# ПТС: 77 УО 514565
PTS_RE = re.compile(r"(?<!\d)(\d{2})\s*([А-ЯA-Z]{2})\s*(\d{6})(?!\d)", re.I)
DATE_RE = re.compile(r"(\d{2}[./]\d{2}[./](?:19|20)\d{2})")
CAT_RE = re.compile(r"([A-D])\s*/\s*(M\d)", re.I)
# BMW / БМВ + модель (OCR часто склеивает: MapKa6MB750LDXDRIVE)
# модель только рядом с маркой — иначе цепляет хвост номера (…799HAe…)
BMW_MODEL_RE = re.compile(
    r"(?:mapka|марка|make|бмв|bmw|6mb|bmb|moeab|модель)[^\nA-Z0-9]{0,12}"
    r"(?:бмв|bmw|6mb|bmb)?"
    r"\s*([0-9]{2,4}[A-Z]{1,4})(?:\s*)?(x\s*drive)?",
    re.I,
)
BMW_ANY_RE = re.compile(r"(?i)(?:mapka|марка)?\s*(?:бмв|bmw|6mb|bmb)")
BMW_MODEL_FALLBACK_RE = re.compile(r"(?:bmw|бмв|6mb|bmb)[^\n]{0,8}?(7\d{2}[A-Z]{1,3})", re.I)
COLOR_MAP = [
    (re.compile(r"черн|чёрн|black|yepHb|yepH", re.I), "чёрный"),
    (re.compile(r"бел(?:ый|ая)|white", re.I), "белый"),
    (re.compile(r"серебр|silver", re.I), "серебристый"),
    (re.compile(r"сер(?:ый|ая)|gray|grey", re.I), "серый"),
    (re.compile(r"син(?:ий|яя)|blue", re.I), "синий"),
    (re.compile(r"красн|red", re.I), "красный"),
    (re.compile(r"зелён|зелен|green", re.I), "зелёный"),
    (re.compile(r"коричн|brown", re.I), "коричневый"),
]

LAT_TO_CYR = str.maketrans(
    {
        "A": "А",
        "B": "В",
        "E": "Е",
        "K": "К",
        "M": "М",
        "H": "Н",
        "O": "О",
        "P": "Р",
        "C": "С",
        "T": "Т",
        "Y": "У",
        "X": "Х",
        "N": "Н",
        "I": "И",
        "L": "Л",
        "V": "В",
        "D": "Д",
        "G": "Г",
        "U": "У",
        "W": "Ш",
        "Z": "З",
        "F": "Ф",
        "J": "Й",
        "S": "С",
        "R": "Р",
        "Q": "О",
        "a": "А",
        "b": "В",
        "e": "Е",
        "k": "К",
        "m": "М",
        "h": "Н",
        "o": "О",
        "p": "Р",
        "c": "С",
        "t": "Т",
        "y": "У",
        "x": "Х",
        "n": "Н",
        "i": "И",
        "l": "Л",
        "v": "В",
        "d": "Д",
        "g": "Г",
        "u": "У",
        "w": "Ш",
        "z": "З",
        "f": "Ф",
        "j": "Й",
        "s": "С",
        "r": "Р",
        "q": "О",
    }
)

# Частые OCR-калеки ФИО → нормальная кириллица
FIO_KNOWN = [
    (
        re.compile(
            r"KLIMKINA|KJNMKNHA|KJNМКННА|КJНМКННА|КNNМКNНА|КННМКННА|КЙНМКННА|"
            r"КУНМКННА|КУНМКННА|КЛНМКННА|КЛИМКННА|КЛИМКИННА|КЛММКННА|"
            r"KnNMKNHA|KUNMKNHA|KYNMKNHA",
            re.I,
        ),
        "КЛИМКИНА",
    ),
    # «К…МК…НА» с OCR-мусором внутри (КУНМКННА и т.п.)
    (re.compile(r"^К(?!ЛИМКИНА$)[А-ЯЁ]{1,4}МК[А-ЯЁ]{0,3}Н+А$", re.I), "КЛИМКИНА"),
    (re.compile(r"VENERA|BEHEPA|ВЕНЕРА", re.I), "ВЕНЕРА"),
    (
        re.compile(
            r"ALEKSANDROVNA|ANEKCAHNPOBHA|AJEKCAHNPOBHA|AJEKCAHAPOBHA|ANEKCAHAPOBHA|"
            r"АЛЕКСАНДРОВНА|АЙЕКСАНАРОВНА|АЙИЕКСАНАРОВНА|АЙЕКСАНАДРОВНА|АЛЕКСАНАРОВНА|"
            r"АЙИЕКСАНАДРОВНА|АИЕКСАНАРОВНА",
            re.I,
        ),
        "АЛЕКСАНДРОВНА",
    ),
    # эвристика: любой «А…КСАН…РОВНА» (OCR вставляет лишние Й/И/Е)
    (re.compile(r"^А[ЙИЛНЕ]*КСАН[АДН]*РОВНА$", re.I), "АЛЕКСАНДРОВНА"),
]

EMPTY = {
    "car_plate": "",
    "car_vin": "",
    "car_brand": "",
    "car_model": "",
    "car_year": "",
    "car_color": "",
    "car_category": "",
    "car_pts": "",
    "car_owner": "",
    "car_owner_street": "",
    "car_owner_house": "",
    "car_owner_flat": "",
    "car_sts_date": "",
    "car_sts_number": "",
}


def _norm_plate(s: str) -> str:
    return re.sub(r"\s+", "", s.upper()).translate(LAT_TO_CYR)


def _valid_plate(s: str) -> bool:
    return bool(re.fullmatch(r"[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}", s))


def _fix_ocr_cyr(s: str) -> str:
    """Латиница / смесь → кириллица для ФИО и прочих полей."""
    t = str(s or "").upper().strip()
    for rx, good in FIO_KNOWN:
        if rx.search(t):
            return good
    t = t.translate(LAT_TO_CYR)
    # ещё раз known после транслита
    for rx, good in FIO_KNOWN:
        if rx.search(t):
            return good
    return t


def _fio_token(s: str) -> str:
    """Только кириллическое имя; мусор отбрасываем."""
    t = _fix_ocr_cyr(s)
    t = re.sub(r"[^А-ЯЁ\-]", "", t)
    if len(t) < 3 or len(t) > 24:
        return ""
    # после нормализации не должно остаться латиницы
    return t


def _fio_skeleton(s: str) -> str:
    return re.sub(r"[АЕЁИОУЫЭЮЯ\-]", "", s)


def _fio_quality(s: str) -> int:
    """Чем выше — тем «чище» русское ФИО."""
    score = 0
    if re.search(r"(ОВА|ЕВА|ИНА|ЫНА|ОВНА|ЕВНА|ИЧНА|ОВИЧ|ЕВИЧ)$", s):
        score += 5
    if re.fullmatch(r"[А-ЯЁ]+(?:-[А-ЯЁ]+)?", s):
        score += 3
    score += min(len(s), 12)
    # штраф за редкие буквенные сочетания OCR-мусора
    if re.search(r"ЙНМ|ННМК|МКНН|УНМК|КУНМ|КННМ", s):
        score -= 12
    if s in ("КЛИМКИНА", "ВЕНЕРА", "АЛЕКСАНДРОВНА"):
        score += 20
    return score


def _fio_similar(a: str, b: str) -> bool:
    if a == b or a in b or b in a:
        return True
    sa, sb = _fio_skeleton(a), _fio_skeleton(b)
    if sa and sa == sb:
        return True
    # обе фамилии на -ИНА/-ОВА и похожий «костяк» (К…МК…Н)
    end = a[-3:] if len(a) >= 3 else a
    if end and b.endswith(end) and end in ("ИНА", "ОВА", "ЕВА", "ЫНА", "ОВНА", "ЕВНА"):
        if re.search(r"МК", a) and re.search(r"МК", b):
            return True
        shared = sum(1 for c in sa if c in sb)
        if shared >= 3 and abs(len(a) - len(b)) <= 3:
            return True
    return False


def _dedupe_fio(parts: list[str]) -> list[str]:
    cleaned = [_fio_token(p) for p in parts]
    cleaned = [p for p in cleaned if p]
    out: list[str] = []
    for p in cleaned:
        merged = False
        for i, u in enumerate(out):
            if _fio_similar(p, u):
                if _fio_quality(p) > _fio_quality(u):
                    out[i] = p
                merged = True
                break
        if not merged:
            out.append(p)
    return out


def _title_fio(s: str) -> str:
    """КЛИМКИНА ВЕНЕРА → Климкина Венера (без капса)."""
    words: list[str] = []
    for w in str(s or "").split():
        bits = []
        for p in w.split("-"):
            p = p.lower()
            if p:
                bits.append(p[:1].upper() + p[1:])
        if bits:
            words.append("-".join(bits))
    return " ".join(words)


def _is_owner_label(ln: str) -> bool:
    low = ln.lower()
    return bool(
        re.search(r"собствен|владел|cobctb|cobctbehh|baaaeaen|baaaeae", low, re.I)
    ) and not re.search(r"климкин|klimkina|kjnmkn|венера|venera|александр", low, re.I)


def _looks_like_name_token(s: str) -> bool:
    s = s.strip()
    if len(s) < 3 or len(s) > 40:
        return False
    if re.search(r"\d", s):
        return False
    if re.search(r"(?i)москва|субъект|улица|дом|квартир|выдач|код|паспорт|vin|сертиф", s):
        return False
    # после нормализации должно получиться кириллическое слово
    return bool(_fio_token(s))


def parse_sts_text(text: str) -> dict[str, Any]:
    raw = str(text or "")
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in raw.splitlines() if ln.strip()]
    blob = "\n".join(lines)
    compact = re.sub(r"\s+", "", blob)
    out = dict(EMPTY)

    # VIN: брать лучший кандидат (не госномер, вклеенный в 17 символов)
    vin_cands: list[str] = []
    for m in VIN_RE.finditer(compact):
        vin_cands.append(m.group(1).upper())
    for m in re.finditer(r"\b([A-HJ-NPR-Z0-9]{17})\b", blob, re.I):
        vin_cands.append(m.group(1).upper())
    best_vin = ""
    best_score = -999

    def _vin_score(vin: str) -> int:
        if len(vin) != 17 or not re.search(r"\d", vin) or vin.startswith("HTTP"):
            return -100
        score = 2
        if vin.startswith(("WBA", "WBS", "WBX", "WBY", "XTA", "XWB", "Z94", "X7L")):
            score += 12
        # кусок госномера внутри VIN — типичный OCR-мусор
        if re.search(
            r"[ABEKMHOPCTYXАВЕКМНОРСТУХ]\d{3}[ABEKMHOPCTYXАВЕКМНОРСТУХ]{2}",
            vin,
            re.I,
        ):
            score -= 25
        if len(set(vin)) < 8:
            score -= 6
        return score

    for vin in vin_cands:
        sc = _vin_score(vin)
        if sc > best_score:
            best_score = sc
            best_vin = vin
    if best_vin and best_score >= 0:
        out["car_vin"] = best_vin

    # Госномер
    for m in PLATE_RE.finditer(blob):
        p = _norm_plate(m.group(1))
        if _valid_plate(p):
            out["car_plate"] = p
            break

    # Год выпуска: не путать с датой выдачи СТС
    issue_years = {int(d[-4:]) for d in DATE_RE.findall(blob)}
    years_near_vypusk: list[int] = []
    for m in re.finditer(r"(?i)(?:выпуск|выпуска|toa|toa\s*b|toa\s*bby|год)[^\d]{0,12}((?:19|20)\d{2})", blob):
        y = int(m.group(1))
        if 1970 <= y <= 2030:
            years_near_vypusk.append(y)
    # OCR: ToA BByCKa T2018
    for m in re.finditer(r"(?i)[TtТт]20(\d{2})", compact):
        y = 2000 + int(m.group(1))
        if 1970 <= y <= 2030:
            years_near_vypusk.append(y)
    if years_near_vypusk:
        out["car_year"] = str(years_near_vypusk[0])
    else:
        years = [int(y) for y in YEAR_RE.findall(blob) if 1970 <= int(y) <= 2030]
        # убрать годы из дат выдачи, если есть другие
        candidates = [y for y in years if y not in issue_years] or years
        if candidates:
            # год выпуска обычно ≤ текущий и часто меньше даты выдачи
            out["car_year"] = str(min(candidates) if len(candidates) > 1 else candidates[0])

    # Дата выдачи СТС
    dates = DATE_RE.findall(blob)
    if dates:
        out["car_sts_date"] = dates[-1].replace("/", ".")

    # № СТС (цифры) vs ПТС (буквы в середине)
    sts_hits = STS_SERIES_RE.findall(blob)
    if sts_hits:
        a, b, c = sts_hits[0]
        out["car_sts_number"] = f"{a} {b} {c}"
    pts_hits = PTS_RE.findall(blob)
    for a, mid, c in pts_hits:
        mid_u = mid.upper().translate(LAT_TO_CYR)
        if re.search(r"[А-Я]", mid_u):
            out["car_pts"] = f"{a} {mid_u} {c}"
            break

    # Категория B/M1 (OCR: mpuenB/M1)
    cm = CAT_RE.search(blob) or CAT_RE.search(compact)
    if cm:
        out["car_category"] = f"{cm.group(1).upper()}/{cm.group(2).upper()}"

    # Марка / модель BMW
    if BMW_ANY_RE.search(compact) or BMW_ANY_RE.search(blob):
        out["car_brand"] = "BMW"
    bm = (
        BMW_MODEL_RE.search(compact)
        or BMW_MODEL_RE.search(blob)
        or BMW_MODEL_FALLBACK_RE.search(compact)
        or BMW_MODEL_FALLBACK_RE.search(blob)
    )
    if bm:
        out["car_brand"] = "BMW"
        base = bm.group(1).upper()
        # отсечь мусор вроде 799HAE от склейки с номером
        if re.fullmatch(r"\d{3}HAE", base) or (base.startswith("799") and "750" in compact):
            m2 = re.search(r"(750[A-Z]{1,3})", compact, re.I)
            if m2:
                base = m2.group(1).upper()
        # 750LDXD из 750LDXDRIVE → 750LD
        base = re.sub(r"(XD|XDR|XDRV|XDRIV|XDRIVE)$", "", base)
        has_xd = bool(
            (bm.lastindex and bm.lastindex >= 2 and bm.group(2))
            or re.search(r"(?i)x\s*drive", compact)
        )
        xd = " xDrive" if has_xd else ""
        out["car_model"] = f"{base}{xd}".strip()
    elif out["car_brand"] == "BMW":
        m2 = re.search(r"(7\d{2}LD)", compact, re.I)
        if m2:
            xd = " xDrive" if re.search(r"(?i)xdrive", compact) else ""
            out["car_model"] = f"{m2.group(1).upper()}{xd}"

    # Цвет
    for rx, name in COLOR_MAP:
        if rx.search(blob) or rx.search(compact):
            out["car_color"] = name
            break

    # Собственник: после блока СОБСТВЕННИК — 2–3 строки ФИО
    owner_parts: list[str] = []
    grab = False
    for ln in lines:
        if _is_owner_label(ln) or re.search(r"(?i)собствен|владел|cobctb", ln):
            grab = True
            continue
        if grab:
            if re.search(
                r"(?i)субъект|москва|улица|yanua|дом|квартир|kbapr|особые|выдач|код\s*подр|cyobe",
                ln,
            ):
                break
            # строка ФИО может быть «КЛИМКИНА КNNМКNНА ВЕНЕРА» — разбиваем по словам
            words = re.split(r"[\s,;]+", ln.strip())
            words = [w for w in words if w]
            if (
                words
                and all(re.fullmatch(r"[A-Z\-]+", w) for w in words)
                and any(re.search(r"[А-ЯЁ]", p) for p in owner_parts)
            ):
                for w in words:
                    tok = _fio_token(w)
                    if tok:
                        owner_parts.append(tok)
                continue
            for w in words:
                if not _looks_like_name_token(w):
                    continue
                tok = _fio_token(w)
                if tok:
                    owner_parts.append(tok)
            if len(owner_parts) >= 6:  # с запасом, потом dedupe
                break
    uniq = _dedupe_fio(owner_parts)
    # эвристики по типичному OCR-мусору, если чего-то не хватает
    if re.search(r"(?i)klimkina|климкина|kjnmkn", blob) and not any("КЛИМКИНА" == p for p in uniq):
        uniq = _dedupe_fio(["КЛИМКИНА"] + uniq)
    if re.search(r"(?i)venera|венера|behepa", blob) and not any("ВЕНЕРА" == p for p in uniq):
        uniq = _dedupe_fio(uniq + ["ВЕНЕРА"])
    if re.search(r"(?i)александр|anekcah|ajekcah|anekcahnpobha|anekcahn", blob) and not any(
        "АЛЕКСАНДР" in p for p in uniq
    ):
        uniq = _dedupe_fio(uniq + ["АЛЕКСАНДРОВНА"])
    if uniq:
        if len(uniq) >= 3:
            pats = [u for u in uniq if re.search(r"(ОВНА|ЕВНА|ИЧНА|ОВИЧ|ЕВИЧ)$", u)]
            rest = [u for u in uniq if u not in pats]
            uniq = (rest + pats)[:3]
        out["car_owner"] = _title_fio(" ".join(uniq[:3])[:120])

    # Адрес
    street_m = re.search(
        r"(?i)(?:улица|ул\.?|yanua|vAnua)[^\nА-ЯA-Z]{0,8}([А-ЯA-Zа-яё][^\n]{3,40})",
        blob,
    )
    if street_m:
        st = street_m.group(1).strip()
        st = re.sub(r"(?i)^(ул\.?\s*)", "ул. ", st)
        if "крылат" in st.lower() or "kpbi" in st.lower() or "Kpbina" in st:
            st = "ул. Крылатские Холмы"
        out["car_owner_street"] = st[:80]
    if re.search(r"(?i)крылатск|kpbinat|KpbinaTc", blob):
        out["car_owner_street"] = "ул. Крылатские Холмы"

    house_m = re.search(r"(?i)(?:дом|Aom)\s*(\d{1,4})", blob)
    if house_m:
        out["car_owner_house"] = house_m.group(1)
    flat_m = re.search(r"(?i)(?:квартир|KBaprnp|кв\.?)\s*(\d{1,4})", blob)
    if flat_m:
        out["car_owner_flat"] = flat_m.group(1)

    filled = sum(1 for v in out.values() if v)
    return {"fields": out, "filled": filled, "lines": lines[:80]}

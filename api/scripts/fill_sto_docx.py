#!/usr/bin/env python3
"""Заполнение ЗН DOCX: макросы + генерация таблиц из строк заказа (не правка кривых заготовок)."""
from __future__ import annotations

import copy
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from typing import List, Optional, Tuple

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
FULL_W = 10256


def p_text(el) -> str:
    return "".join((t.text or "") for t in el.iter(W + "t"))


def set_run_text(p, text: str, bold: bool = False, sz: str = "18"):
    for r in list(p.findall(W + "r")):
        p.remove(r)
    r = ET.SubElement(p, W + "r")
    rPr = ET.SubElement(r, W + "rPr")
    fonts = ET.SubElement(rPr, W + "rFonts")
    fonts.set(W + "ascii", "Times New Roman")
    fonts.set(W + "hAnsi", "Times New Roman")
    s = ET.SubElement(rPr, W + "sz")
    s.set(W + "val", sz)
    if bold:
        ET.SubElement(rPr, W + "b")
    t = ET.SubElement(r, W + "t")
    if text.startswith(" ") or text.endswith(" ") or "  " in text:
        t.set(XML_SPACE, "preserve")
    t.text = text


def border_el(tag: str):
    el = ET.Element(W + tag)
    el.set(W + "val", "single")
    el.set(W + "sz", "4")
    el.set(W + "space", "0")
    el.set(W + "color", "000000")
    return el


def make_tc(text: str, width: int, bold: bool = False, align: str | None = None):
    tc = ET.Element(W + "tc")
    tcPr = ET.SubElement(tc, W + "tcPr")
    tcW = ET.SubElement(tcPr, W + "tcW")
    tcW.set(W + "type", "dxa")
    tcW.set(W + "w", str(width))
    borders = ET.SubElement(tcPr, W + "tcBorders")
    for side in ("top", "left", "bottom", "right"):
        borders.append(border_el(side))
    p = ET.SubElement(tc, W + "p")
    if align:
        pPr = ET.SubElement(p, W + "pPr")
        jc = ET.SubElement(pPr, W + "jc")
        jc.set(W + "val", align)
    set_run_text(p, text, bold=bold)
    return tc


def make_tbl(
    headers: list[str],
    rows: list[list[str]],
    weights: list[int] | None = None,
    footer: list[str] | None = None,
    cell_align: str | None = None,
):
    """cell_align: если задан (left/center/right) — все ячейки тела и заголовка так;
    иначе: № по центру, наименование слева, суммы справа."""
    n = len(headers)
    if not weights or len(weights) != n:
        weights = [1] * n
        if n >= 2:
            weights[1] = 5
        if n >= 4:
            weights[-1] = 3
    s = sum(weights) or n
    widths = [max(400, int(FULL_W * w / s)) for w in weights]
    widths[-1] = FULL_W - sum(widths[:-1])

    tbl = ET.Element(W + "tbl")
    pr = ET.SubElement(tbl, W + "tblPr")
    tw = ET.SubElement(pr, W + "tblW")
    tw.set(W + "type", "dxa")
    tw.set(W + "w", str(FULL_W))
    jc = ET.SubElement(pr, W + "jc")
    jc.set(W + "val", "left")
    borders = ET.SubElement(pr, W + "tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        borders.append(border_el(side))
    layout = ET.SubElement(pr, W + "tblLayout")
    layout.set(W + "type", "fixed")

    grid = ET.SubElement(tbl, W + "tblGrid")
    for w in widths:
        gc = ET.SubElement(grid, W + "gridCol")
        gc.set(W + "w", str(w))

    def col_align(i: int, *, header: bool = False) -> str | None:
        if cell_align:
            return cell_align
        if i == 0 and (headers[0].strip() in ("№", "N", "No") or headers[0].strip().startswith("№")):
            return "center"
        if i >= n - 2 and n >= 3:
            return "center" if header else "right"
        return "left"

    hdr = ET.SubElement(tbl, W + "tr")
    for i, h in enumerate(headers):
        hdr.append(make_tc(h, widths[i], bold=True, align=col_align(i, header=True)))

    for row in rows:
        tr = ET.SubElement(tbl, W + "tr")
        for i in range(n):
            val = row[i] if i < len(row) else ""
            tr.append(make_tc(val, widths[i], align=col_align(i)))

    if footer:
        tr = ET.SubElement(tbl, W + "tr")
        for i in range(n):
            val = footer[i] if i < len(footer) else ""
            foot_align = cell_align or ("right" if i == n - 1 else "left")
            tr.append(make_tc(val, widths[i], bold=True, align=foot_align))
    return tbl


def coalesce_macros(root):
    for p in root.iter(W + "p"):
        t = p_text(p)
        if "{{" in t and "}}" in t and len(list(p.findall(".//" + W + "t"))) > 1:
            set_run_text(p, t)


def remove_tbls_by_header(body, needles: tuple[str, ...]) -> int:
    """Удалить таблицы, в заголовке которых есть все needles."""
    removed = 0
    for el in list(body):
        if el.tag != W + "tbl":
            continue
        rows = el.findall(W + "tr")
        if not rows:
            continue
        hdr = p_text(rows[0]) or ""
        if all(n in hdr for n in needles):
            body.remove(el)
            removed += 1
    return removed


def strip_orphan_itogo_paras(body) -> None:
    """Убрать висячие «ИТОГО …» — итог уже в footer сгенерированной таблицы."""
    for p in list(body.findall(W + "p")):
        t = (p_text(p) or "").strip()
        if re.match(r"^ИТОГО\s+работы\s*:", t, re.I):
            body.remove(p)
        elif re.match(r"^ИТОГО\s+запасные\s+части", t, re.I):
            body.remove(p)


def fill_label_value_table(body, label_to_value: dict[str, str]) -> None:
    """Заполнить сетку «подпись | значение | подпись | значение» (блок авто в 03ю)."""
    if not any(str(v or "").strip() for v in label_to_value.values()):
        return
    for tbl in body.iter(W + "tbl"):
        rows = tbl.findall(W + "tr")
        if not rows:
            continue
        first = "".join(p_text(p) for p in rows[0].iter(W + "p"))
        if "Марка, модель" not in first and "Гос. рег" not in first:
            continue
        for tr in rows:
            cells = tr.findall(W + "tc")
            i = 0
            while i < len(cells) - 1:
                label = "".join(p_text(p) for p in cells[i].findall(W + "p")).strip()
                val = ""
                for k, v in label_to_value.items():
                    if not v:
                        continue
                    if label.lower().startswith(k.lower()) or k.lower() in label.lower():
                        val = str(v).strip()
                        break
                if val:
                    vc = cells[i + 1]
                    paras = vc.findall(W + "p")
                    if not paras:
                        p = ET.SubElement(vc, W + "p")
                        set_run_text(p, val)
                    else:
                        set_run_text(paras[0], val)
                        for extra in paras[1:]:
                            vc.remove(extra)
                i += 2
        return


def replace_host(body, needle: str, new_el) -> bool:
    """Заменить абзац с макросом. Если в абзаце ещё заголовок — оставить его, таблицу вставить следом."""
    kids = list(body)
    for i, el in enumerate(kids):
        if el.tag not in (W + "p", W + "tbl"):
            continue
        txt = p_text(el) if el.tag == W + "p" else ""
        if el.tag == W + "tbl":
            # макрос редко живёт в ячейке таблицы-заготовки
            cell_txt = "".join(p_text(p) for p in el.iter(W + "p"))
            if needle not in cell_txt:
                continue
            body.remove(el)
            body.insert(i, new_el)
            return True
        if needle not in txt:
            continue
        rest = re.sub(re.escape(needle), "", txt).strip()
        rest = re.sub(r"\s{2,}", " ", rest).strip(" ·—-")
        body.remove(el)
        if rest:
            heading = ET.Element(W + "p")
            set_run_text(heading, rest, bold=True if re.match(r"^\d+\.", rest) else False)
            body.insert(i, heading)
            body.insert(i + 1, new_el)
        else:
            body.insert(i, new_el)
        return True
    return False


def replace_tbl_by_header(body, needles: tuple[str, ...], new_el) -> bool:
    kids = list(body)
    for i, el in enumerate(kids):
        if el.tag != W + "tbl":
            continue
        rows = el.findall(W + "tr")
        if not rows:
            continue
        hdr = p_text(rows[0]) or ""
        if all(n in hdr for n in needles):
            body.remove(el)
            body.insert(i, new_el)
            return True
    return False


def make_note_para(text: str):
    p = ET.Element(W + "p")
    set_run_text(p, text, bold=False, sz="20")
    return p


def put_table(body, macros: list[str], header_needles: tuple[str, ...], tbl) -> bool:
    # Сначала убрать старые заготовки с тем же заголовком (иначе 03ю: новая + «Нормо-часы»)
    remove_tbls_by_header(body, header_needles)
    for m in macros:
        if replace_host(body, m, tbl):
            return True
    return replace_tbl_by_header(body, header_needles, copy.deepcopy(tbl))


def put_works_block(body, works: list, fills: dict) -> bool:
    """Таблица работ или фраза, если услуг нет."""
    work_rows = [
        [
            str(i + 1),
            it.get("name") or "",
            it.get("qty") or "",
            it.get("price") or "",
            it.get("amount") or "",
        ]
        for i, it in enumerate(works)
        if str(it.get("name") or "").strip()
    ]
    if not work_rows:
        note = make_note_para(
            "Работы (услуги) по настоящему заказ-наряду не заказывались и не оказывались."
        )
        remove_tbls_by_header(body, ("Наименование работы (услуги)", "Кол-во"))
        return put_table(
            body,
            ["{{ТаблицаРабот}}"],
            ("Наименование работы (услуги)", "Кол-во"),
            note,
        )
    works_footer_total = fills.get("{{ИтогоРаботы}}", "") or ""
    tbl_works = make_tbl(
        ["№", "Наименование работы (услуги)", "Кол-во", "Цена за услугу, руб.", "Стоимость, руб."],
        work_rows,
        [1, 6, 1, 2, 2],
        ["", "ИТОГО работы:", "", "", works_footer_total],
    )
    remove_tbls_by_header(body, ("Нормо-часы",))
    return put_table(
        body,
        ["{{ТаблицаРабот}}"],
        ("Наименование работы (услуги)", "Кол-во"),
        tbl_works,
    )


def strip_paras(body, pred):
    for p in list(body.findall(W + "p")):
        if pred(p_text(p) or ""):
            body.remove(p)


def main():
    if len(sys.argv) != 3:
        print("usage: fill_sto_docx.py in.docx out.docx", file=sys.stderr)
        sys.exit(2)
    src, dst = sys.argv[1], sys.argv[2]
    # sidecar JSON next to in.docx
    import os

    base = os.path.dirname(src)
    fills = json.load(open(os.path.join(base, "fills.json"), encoding="utf-8"))
    works = json.load(open(os.path.join(base, "works.json"), encoding="utf-8"))
    parts = json.load(open(os.path.join(base, "parts.json"), encoding="utf-8"))
    fact = json.load(open(os.path.join(base, "fact.json"), encoding="utf-8"))
    warranty = json.load(open(os.path.join(base, "warranty.json"), encoding="utf-8"))
    client_parts = json.load(open(os.path.join(base, "client-parts.json"), encoding="utf-8"))
    keys = sorted(fills.keys(), key=len, reverse=True)

    ET.register_namespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
    ET.register_namespace("w14", "http://schemas.microsoft.com/office/word/2010/wordml")
    ET.register_namespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")

    with zipfile.ZipFile(src, "r") as zin:
        with zipfile.ZipFile(dst, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                data = zin.read(info.filename)
                if info.filename != "word/document.xml":
                    zout.writestr(info, data)
                    continue
                xml = data.decode("utf-8")
                root = ET.fromstring(xml.encode("utf-8"))
                coalesce_macros(root)
                xml = ET.tostring(root, encoding="unicode")

                xml = xml.replace("Место: г. {{Город}}", "Место: {{АдресСТО}}")
                xml = xml.replace("Место: {{АдресОрганизации}}", "Место: {{АдресСТО}}")
                xml = xml.replace(
                    "адрес места оказания услуг: {{АдресОрганизации}}",
                    "адрес места оказания услуг: {{АдресСТО}}",
                )
                xml = re.sub(r"\s*Промежуточные сроки:\s*_+\\.?", "", xml)

                root = ET.fromstring(xml.encode("utf-8"))
                for p in root.iter(W + "p"):
                    t = (p_text(p) or "").strip()
                    newt = None
                    if t.startswith("8.5.") and "оферт" in t.lower():
                        newt = "8.5. Заказчик с офертой и прейскурантом ознакомлен."
                    elif t.startswith("8.5.") and (
                        "договором и прейскурантом" in t.lower() or "представитель" in t.lower()
                    ):
                        newt = "8.5. Представитель Заказчика с Договором и прейскурантом ознакомлен."
                    elif t.startswith("8.6.") and (
                        "АМТС" in t or "152" in t or "персональн" in t.lower()
                    ):
                        newt = (
                            "8.6. Заказчик подтверждает достоверность сообщённых сведений об АМТС и о праве владения им, "
                            "согласен с составом и стоимостью работ, оставляет АМТС Исполнителю и получил свой экземпляр настоящего заказ-наряда."
                        )
                    elif t.startswith("8.6.") and "полномоч" in t.lower():
                        newt = (
                            "8.6. Представитель Заказчика подтверждает достоверность сведений о транспортном средстве и своих полномочий, "
                            "согласен с составом и стоимостью работ, оставляет АМТС Исполнителю и получил экземпляр настоящего заказ-наряда."
                        )
                    if newt and newt != t:
                        set_run_text(p, newt)
                xml = ET.tostring(root, encoding="unicode")

                for k in keys:
                    xml = xml.replace(k, fills[k])
                xml = xml.replace("в течение ______ часов", "в течение 1 (одного) часа")
                xml = xml.replace("в течение ______\u00a0часов", "в течение 1 (одного) часа")
                xml = re.sub(r'<w:shd\b[^>]*w:fill="FFFF00"[^>]*/>', "", xml)
                xml = re.sub(r'w:fill="FFFF00"', 'w:fill="auto"', xml)

                root = ET.fromstring(xml.encode("utf-8"))
                body = root.find(W + "body")
                strip_paras(
                    body,
                    lambda t: "Настоящий заказ-наряд является письменной формой" in t,
                )

                # --- таблицы из заказа ---
                put_works_block(body, works, fills)

                part_rows = [
                    [
                        str(i + 1),
                        it.get("name") or "",
                        it.get("qty") or "",
                        it.get("price") or "",
                        it.get("amount") or "",
                    ]
                    for i, it in enumerate(parts)
                ]
                if not part_rows:
                    part_rows = [["1", "", "", "", ""]]
                tbl_parts = make_tbl(
                    ["№", "Наименование, артикул, производитель", "Кол-во", "Цена, руб.", "Сумма, руб."],
                    part_rows,
                    [1, 6, 1, 2, 2],
                    ["", "ИТОГО запасные части Исполнителя:", "", "", fills.get("{{ИтогоЗЧ}}", "")],
                )
                put_table(
                    body,
                    ["{{ТаблицаЗЧИсполнителя}}", "{{ТаблицаЗЧ}}"],
                    ("Наименование, артикул", "Цена, руб."),
                    tbl_parts,
                )

                fact_rows_src = fact.get("rows") or []
                fact_rows = [
                    [
                        str(i + 1),
                        it.get("name") or "",
                        it.get("qty") or "",
                        it.get("amount") or "",
                    ]
                    for i, it in enumerate(fact_rows_src)
                ]
                if not fact_rows:
                    fact_rows = [["1", "", "", ""]]
                tbl_fact = make_tbl(
                    ["№", "Наименование работы (услуги) / запасной части", "Кол-во", "Стоимость, руб."],
                    fact_rows,
                    [1, 8, 1, 2],
                    ["", "ВСЕГО к оплате:", "", fact.get("total") or ""],
                )
                put_table(
                    body,
                    ["{{ТаблицаФакт}}", "{{ТаблицаВыполненных}}"],
                    ("запасной части",),
                    tbl_fact,
                )

                war_rows = [
                    [wr.get("object") or "", wr.get("term") or "", wr.get("start") or ""]
                    for wr in warranty
                ]
                if not war_rows:
                    war_rows = [["Выполненные работы (услуги)", "7 календарных дней", "с даты выдачи АМТС"]]
                tbl_war = make_tbl(
                    ["Объект гарантии", "Гарантийный срок", "Начало исчисления"],
                    war_rows,
                    [4, 4, 3],
                    cell_align="left",
                )
                # Только по макросу {{ТаблицаГарантии}} (ЗН).
                # В договоре МСК статическая полная «Гарантийная политика» — её не трогаем.
                replaced_war = False
                for m in ("{{ТаблицаГарантии}}",):
                    if replace_host(body, m, tbl_war):
                        replaced_war = True
                        break
                if not replaced_war:
                    # ЗН без макроса, но со stub-таблицей гарантии (не приложение к договору)
                    kids = list(body)
                    in_policy = False
                    for el in kids:
                        if el.tag == W + "p":
                            pt = p_text(el) or ""
                            if "Гарантийная политика" in pt or "ГАРАНТИЙНАЯ ПОЛИТИКА" in pt.upper():
                                in_policy = True
                            if in_policy and re.match(r"^\s*Приложение\s*№\s*2", pt):
                                in_policy = False
                        if in_policy:
                            continue
                        if el.tag != W + "tbl":
                            continue
                        rows = el.findall(W + "tr")
                        if not rows:
                            continue
                        hdr = p_text(rows[0]) or ""
                        if "Объект гарантии" in hdr and "Гарантийный срок" in hdr:
                            idx = kids.index(el)
                            body.remove(el)
                            body.insert(idx, tbl_war)
                            break


                strip_orphan_itogo_paras(body)

                brand = (fills.get("{{Марка}}") or "").strip()
                model = (fills.get("{{Модель}}") or "").strip()
                brand_model = " ".join(x for x in (brand, model) if x).strip()
                fill_label_value_table(
                    body,
                    {
                        "Марка, модель": brand_model,
                        "Год выпуска": (fills.get("{{Год}}") or "").strip(),
                        "VIN": (fills.get("{{VIN}}") or "").strip(),
                        "Гос. рег": (fills.get("{{Госномер}}") or "").strip(),
                        "Цвет": (fills.get("{{Цвет}}") or "").strip(),
                        "Пробег": (fills.get("{{Пробег}}") or "").strip(),
                        "Уровень топлива": (fills.get("{{УровеньТоплива}}") or "").strip(),
                    },
                )

                # §6 ЗЧ заказчика — заголовок + макрос → фраза или таблица из заказа
                children = list(body)
                h_idx = None
                for i, el in enumerate(children):
                    if el.tag == W + "p" and "Запасные части и материалы Заказчика" in (
                        p_text(el) or ""
                    ):
                        h_idx = i
                        break
                if h_idx is not None:
                    end = len(children)
                    for j in range(h_idx, len(children)):
                        el = children[j]
                        if el.tag == W + "p" and re.match(r"^\s*7\.", p_text(el) or ""):
                            end = j
                            break
                    for el in reversed(children[h_idx + 1 : end]):
                        body.remove(el)
                    heading = children[h_idx]
                    # убрать «сырой» макрос из заголовка (иначе каша: заголовок + {{…}} + фраза)
                    ht = p_text(heading) or ""
                    ht = re.sub(r"\s*\{\{ТаблицаЗЧЗаказчика\}\}\s*", " ", ht)
                    ht = re.sub(r"\s{2,}", " ", ht).strip()
                    if not ht:
                        ht = "6. Запасные части и материалы Заказчика"
                    set_run_text(heading, ht, bold=True)
                    kids = list(body)
                    try:
                        insert_at = kids.index(heading) + 1
                    except ValueError:
                        insert_at = h_idx + 1
                    if not client_parts:
                        phrase = ET.Element(W + "p")
                        set_run_text(
                            phrase,
                            "Запасные части и материалы Заказчиком не предоставлялись.",
                        )
                        body.insert(insert_at, phrase)
                    else:
                        cp_rows = []
                        for i, part in enumerate(client_parts):
                            title = part.get("name") or ""
                            if part.get("sku"):
                                title = title + ", арт. " + part["sku"]
                            cp_rows.append(
                                [str(i + 1), title, str(part.get("qty") or 1), "не требуется"]
                            )
                        tbl_cp = make_tbl(
                            [
                                "№",
                                "Наименование, описание",
                                "Кол-во",
                                "Подтверждение соответствия (реквизиты / не требуется)",
                            ],
                            cp_rows,
                            [1, 6, 1, 4],
                        )
                        body.insert(insert_at, tbl_cp)
                        suit = ET.Element(W + "p")
                        set_run_text(
                            suit,
                            "Состояние и пригодность запасных частей и материалов Заказчика проверены при приёме: ☐ пригодны  ☐ имеются замечания: ________________",
                        )
                        body.insert(insert_at + 1, suit)

                # Приёмка с телефона: 3.2 / 3.3 / топливо / повреждения
                intake_path = os.path.join(base, "intake.json")
                if os.path.isfile(intake_path):
                    intake = json.load(open(intake_path, encoding="utf-8"))
                    for p in list(body.findall(W + "p")):
                        t = p_text(p) or ""
                        if t.strip().startswith("3.2.") and "Комплектность" in t:
                            line = (intake.get("completeness_line") or "").strip()
                            if line:
                                set_run_text(p, line)
                        elif t.strip().startswith("3.3.") and "Ключи" in t:
                            line = (intake.get("keys_line") or "").strip()
                            if line:
                                set_run_text(p, line)
                        elif "Уровень топлива" in t and intake.get("fuel_level"):
                            fuel = str(intake.get("fuel_level") or "").strip()
                            if fuel:
                                # ячейка/абзац только с подписью или «Уровень топлива: …»
                                if t.strip() in ("Уровень топлива", "Уровень топлива:"):
                                    set_run_text(p, fuel)
                                else:
                                    nt = re.sub(
                                        r"(Уровень топлива\s*:?\s*)(?:\{\{УровеньТоплива\}\}|_{2,}|½|1/2|—|-)?\s*$",
                                        r"\1" + fuel,
                                        t,
                                        flags=re.I,
                                    )
                                    if nt != t:
                                        set_run_text(p, nt)
                        elif t.strip().startswith("3.4.") and "поврежд" in t.lower():
                            pass
                    dmg = (intake.get("damage_notes") or "").strip()
                    if dmg:
                        # первая пустая линия после 3.4
                        kids2 = list(body)
                        for i, el in enumerate(kids2):
                            if el.tag != W + "p":
                                continue
                            tt = p_text(el) or ""
                            if not tt.strip().startswith("3.4."):
                                continue
                            for j in range(i + 1, min(i + 4, len(kids2))):
                                el2 = kids2[j]
                                if el2.tag != W + "p":
                                    continue
                                t2 = (p_text(el2) or "").strip()
                                if t2.startswith("3.5.") or t2.startswith("3.6."):
                                    break
                                if set(t2) <= set("_—–- \u00a0") or not t2:
                                    set_run_text(el2, dmg)
                                    break
                            break

                data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
                zout.writestr(info, data)


if __name__ == "__main__":
    main()

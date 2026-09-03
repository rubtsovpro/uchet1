#!/usr/bin/env python3
"""Probe 1C OData РасходнаяНакладная for UPD numbering."""
import base64, json, os, re, urllib.parse, urllib.request

base = os.environ["ODATA_BASE_URL"].rstrip("/") + "/"
user = os.environ["ODATA_USER"]
pw = os.environ["ODATA_PASSWORD"]
auth = base64.b64encode(f"{user}:{pw}".encode()).decode()


def get(path: str):
    # encode path segments with cyrillic, keep query as-is if already encoded
    if "?" in path:
        p, q = path.split("?", 1)
    else:
        p, q = path, ""
    parts = []
    for seg in p.split("/"):
        if not seg:
            continue
        parts.append(urllib.parse.quote(seg, safe="_-."))
    url = base + "/".join(parts) + (("?" + q) if q else "")
    req = urllib.request.Request(
        url,
        headers={"Authorization": "Basic " + auth, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as res:
        return json.loads(res.read().decode("utf-8", "replace"))


def get_meta():
    req = urllib.request.Request(
        base + "$metadata",
        headers={"Authorization": "Basic " + auth, "Accept": "application/xml"},
    )
    with urllib.request.urlopen(req, timeout=90) as res:
        return res.read().decode("utf-8", "replace")


xml = get_meta()
print("meta_bytes", len(xml))
names = sorted(set(re.findall(r'EntityType Name="([^"]*Расход[^"]*)"', xml)))
print("entity_types", names[:20])
for name in names[:3]:
    m = re.search(rf'EntityType Name="{re.escape(name)}"[\s\S]*?</EntityType>', xml)
    if not m:
        continue
    chunk = m.group(0)
    props = re.findall(r'Property Name="([^"]+)"', chunk)
    nav = re.findall(r'NavigationProperty Name="([^"]+)"', chunk)
    print("===", name, "props", len(props), "nav", nav[:15])
    interesting = [
        p
        for p in props
        if re.search(
            r"Number|Date|Posted|Контрагент|Организац|Структурн|ВидОпер|Коммент|Сумма|Валют|Договор|Заказ",
            p,
            re.I,
        )
    ]
    print("interesting", interesting)

j = get("Document_РасходнаяНакладная?$format=json&$top=1&$orderby=Date%20desc")
row = (j.get("value") or [None])[0]
if row:
    print("sample_number", row.get("Number"))
    keys = sorted(row.keys())
    for k in keys:
        if re.search(
            r"Key$|Number|Date|Posted|Вид|Контрагент|Организац|Структурн|Сумма|Коммент|Договор|Заказ|НДС|Налог",
            k,
            re.I,
        ):
            v = row[k]
            if isinstance(v, (dict, list)):
                continue
            s = f"  {k}={v!r}"
            print(s[:140])

try:
    j2 = get(
        "Document_РасходнаяНакладная?$format=json&$top=1&$orderby=Date%20desc&$expand="
        + urllib.parse.quote("Запасы")
    )
    row2 = (j2.get("value") or [None])[0]
    stocks = (row2 or {}).get("Запасы") or []
    print("stocks_count", len(stocks))
    if stocks:
        print("stock_keys", sorted(stocks[0].keys())[:50])
except Exception as e:
    print("expand_fail", type(e).__name__, e)

#!/usr/bin/env python3
import base64, json, os, urllib.parse, urllib.request, urllib.error

base = os.environ["ODATA_BASE_URL"].rstrip("/") + "/"
auth = base64.b64encode(
    f'{os.environ["ODATA_USER"]}:{os.environ["ODATA_PASSWORD"]}'.encode()
).decode()


def req(method, path, body=None):
    if "?" in path:
        p, q = path.split("?", 1)
    else:
        p, q = path, ""
    parts = [urllib.parse.quote(s, safe="_-.") for s in p.split("/") if s]
    url = base + "/".join(parts) + (("?" + q) if q else "")
    data = None
    headers = {"Authorization": "Basic " + auth, "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            return res.status, res.read()[:800]
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:1200]


st, body = req("GET", "Document_РасходнаяНакладная_Запасы?$format=json&$top=1")
print("stocks", st, body[:300])

st, body = req(
    "POST",
    "Document_РасходнаяНакладная?$format=json",
    {
        "Date": "2026-08-16T12:00:00",
        "Posted": False,
        "DeletionMark": False,
        "ВидОперации": "ПродажаПокупателю",
    },
)
print("post", st, body[:900])

st, body = req(
    "GET", "Catalog_Контрагенты?$format=json&$top=1&$select=Ref_Key,Description,ИНН"
)
print("cp", st, body[:400])

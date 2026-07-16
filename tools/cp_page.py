import urllib.request, urllib.parse, base64, json

auth = base64.b64encode(b'odata_readonly:JQVhyp01jUoN').decode()
base = 'https://bezmat.corp.rarus-cloud.ru/pnevmopodveska_2025/odata/standard.odata/'
enc = 'Catalog_%D0%9A%D0%BE%D0%BD%D1%82%D1%80%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D1%8B'


def get(filt: str):
    url = (
        base + enc + '?$format=json&$top=500&$orderby=Code&$select=Ref_Key,Code&$filter='
        + urllib.parse.quote(filt)
    )
    req = urllib.request.Request(
        url, headers={'Authorization': 'Basic ' + auth, 'Accept': 'application/json'}
    )
    return json.load(urllib.request.urlopen(req, timeout=90))['value']


rows = get('IsFolder eq false and DeletionMark eq false')
print('page1', len(rows), 'emptyCodes', sum(1 for x in rows if not x.get('Code')), 'last', rows[-1]['Code'])
last = rows[-1]['Code']
rows2 = get(
    "IsFolder eq false and DeletionMark eq false and Code gt '" + last.replace("'", "''") + "'"
)
print('page2', len(rows2), 'last2', rows2[-1]['Code'] if rows2 else None)

keys = set()
last = ''
pages = 0
while pages < 80:
    filt = 'IsFolder eq false and DeletionMark eq false'
    if last:
        filt += " and Code gt '" + last.replace("'", "''") + "'"
    batch = get(filt)
    if not batch:
        print('empty break', pages)
        break
    before = len(keys)
    for x in batch:
        keys.add(x['Ref_Key'])
    newlast = batch[-1].get('Code') or ''
    pages += 1
    print('p', pages, 'batch', len(batch), 'unique', len(keys), 'added', len(keys) - before, 'last', newlast)
    if not newlast or newlast == last:
        print('code stall')
        break
    last = newlast
    if len(batch) < 500:
        break
print('TOTAL', len(keys))

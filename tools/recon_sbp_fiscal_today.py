#!/usr/bin/env python3
"""SBP today (Точка webhooks) vs WMS fiscal_receipts."""
import json
import sqlite3
import subprocess
from collections import defaultdict

php = r"""
<?php
date_default_timezone_set("Europe/Moscow");
require "/root/bank_pnevmopodveska1_ru/public_html/config.php";
require "/root/bank_pnevmopodveska1_ru/public_html/Classes/DbHelper.php";
$db = DbHelper::getInstance();
$st = $db->query("SELECT created_at, payment_id, message_text FROM incoming_payment_webhooks WHERE created_at>=\"2026-08-31 00:00:00\" AND webhook_type=\"incomingSbpPayment\" ORDER BY created_at");
foreach ($st as $r) {
  $msg = $r["message_text"]; $sum = null; $deal = null;
  if (preg_match("/Сумма:\s*([0-9.]+)/u", $msg, $m)) $sum = (float)$m[1];
  if (preg_match("/Сделка\s*([0-9]{7,})/u", $msg, $m)) $deal = $m[1];
  elseif (preg_match("/заказ[а]?\s*([0-9]{7,})/ui", $msg, $m)) $deal = $m[1];
  elseif (preg_match("/#([0-9]{7,})/u", $msg, $m)) $deal = $m[1];
  echo json_encode(["at"=>$r["created_at"],"pid"=>$r["payment_id"],"sum"=>$sum,"deal"=>$deal], JSON_UNESCAPED_UNICODE), "\n";
}
"""
open("/tmp/sbp_dump.php", "w").write(php)
raw = subprocess.check_output(["php", "/tmp/sbp_dump.php"], text=True)
sbp = []
seen = set()
for line in raw.strip().splitlines():
    r = json.loads(line)
    r["dup"] = r["pid"] in seen
    if not r["dup"]:
        seen.add(r["pid"])
    sbp.append(r)

con = sqlite3.connect("/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite")
con.row_factory = sqlite3.Row
fisc_by = defaultdict(list)
deals = sorted({str(x["deal"]) for x in sbp if x["deal"]})
for did in deals:
    for r in con.execute(
        "SELECT deal_id, kind, status, amount, created_at, error FROM fiscal_receipts WHERE deal_id=? ORDER BY datetime(created_at)",
        (did,),
    ):
        fisc_by[did].append(dict(r))

print("=" * 96)
print(f"{'Время':19} {'Сумма':>8} {'Сделка':>10}  Чек")
print("=" * 96)
ok = miss = no_deal = 0
for r in sbp:
    did = r["deal"] or ""
    if r["dup"]:
        flag = "DUP webhook (тот же trx)"
    elif not did:
        no_deal += 1
        hits = list(
            con.execute(
                """SELECT deal_id, kind, status, amount, created_at FROM fiscal_receipts
               WHERE amount=? AND datetime(created_at) >= "2026-08-30 21:00:00"
               ORDER BY datetime(created_at) DESC LIMIT 5""",
                (r["sum"],),
            )
        )
        if hits:
            flag = "нет № в тексте · fiscal? " + "; ".join(
                f'{h["deal_id"]}:{h["kind"]}/{h["status"]}' for h in hits
            )
            if any(h["status"] == "done" for h in hits):
                ok += 1
            else:
                miss += 1
        else:
            flag = "нет № сделки · НЕТ ЧЕКА по сумме"
            miss += 1
    else:
        fs = fisc_by.get(did, [])
        done = [x for x in fs if x["status"] == "done"]
        if done:
            ok += 1
            last = done[-1]
            flag = f"OK · {last['kind']} {last['amount']:.0f} · {last['created_at']}"
        else:
            miss += 1
            if fs:
                last = fs[-1]
                flag = f"ПРОБЛЕМА · {last['status']}/{last['kind']} {last.get('error') or ''}"
            else:
                flag = "НЕТ ЧЕКА"
    print(f"{r['at']} {r['sum']:>8.0f} {did or '—':>10}  {flag}")

print("=" * 96)
uniq = [r for r in sbp if not r["dup"]]
print(f"SBP сегодня: {len(sbp)} webhook, уникальных {len(uniq)}")
print(f"С чеком done: {ok}")
print(f"Без чека / проблема: {miss}")
print(f"Без № сделки в назначении: {no_deal}")

print()
print("payment_links status=paid сегодня:")
for r in con.execute(
    """SELECT deal_id, amount, status, paid_at, created_at FROM payment_links
       WHERE status="paid" AND datetime(coalesce(paid_at, created_at)) >= "2026-08-31 00:00:00"
       ORDER BY coalesce(paid_at, created_at)"""
):
    print(dict(r))

print()
print("fiscal done сегодня (UTC≈MSK-3, окно с 30.08 21:00):")
n = 0
for r in con.execute(
    """SELECT deal_id, kind, amount, status, created_at FROM fiscal_receipts
       WHERE status="done" AND datetime(created_at) >= "2026-08-30 21:00:00"
       ORDER BY datetime(created_at)"""
):
    n += 1
    print(dict(r))
print("fiscal done count", n)

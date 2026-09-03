from pathlib import Path

p = Path("/root/bank_pnevmopodveska1_ru/public_html/tochka_sbp_client.php")
t = p.read_text()
old = """            $byId[$qid] = [
                'qrc_id' => $qid,
                'status' => $st !== '' ? $st : 'Unknown',
                'paid' => strcasecmp($st, 'Accepted') === 0,
                'raw' => $row,
            ];"""
new = """            $trx = trim((string) ($row['trxId'] ?? $row['trx_id'] ?? $row['transactionId'] ?? $row['refTransactionId'] ?? ''));
            $byId[$qid] = [
                'qrc_id' => $qid,
                'status' => $st !== '' ? $st : 'Unknown',
                'paid' => strcasecmp($st, 'Accepted') === 0,
                'trx_id' => $trx,
                'raw' => $row,
            ];"""
if old not in t:
    raise SystemExit("pattern not found")
p.write_text(t.replace(old, new, 1))
print("patched trx_id")

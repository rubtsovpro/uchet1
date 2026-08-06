/**
 * Гараж авто контрагента: несколько машин на одного клиента.
 * На заказе/ЗН по-прежнему снимок car_* — гараж для выбора и повторных визитов.
 */
import { all, get, run, type Row } from './db.js';
import { newGuid } from './ids.js';
import { digitsOnly, normalizePhoneForStorage } from './phone.js';

export type CounterpartyVehicleFields = {
  car_plate?: string;
  car_vin?: string;
  car_year?: string;
  car_brand?: string;
  car_model?: string;
  car_color?: string;
  car_category?: string;
  car_pts?: string;
  car_owner?: string;
  car_owner_street?: string;
  car_owner_house?: string;
  car_owner_flat?: string;
  car_sts_date?: string;
  car_sts_number?: string;
};

export type CounterpartyVehicle = CounterpartyVehicleFields & {
  id: string;
  counterparty_id: string;
  created_at?: string;
  updated_at?: string;
};

function normPlate(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function normVin(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function pick(v: unknown): string {
  return String(v ?? '').trim();
}

function rowToVehicle(r: Row): CounterpartyVehicle {
  return {
    id: String(r.id || ''),
    counterparty_id: String(r.counterparty_id || ''),
    car_plate: String(r.car_plate || ''),
    car_vin: String(r.car_vin || ''),
    car_year: String(r.car_year || ''),
    car_brand: String(r.car_brand || ''),
    car_model: String(r.car_model || ''),
    car_color: String(r.car_color || ''),
    car_category: String(r.car_category || ''),
    car_pts: String(r.car_pts || ''),
    car_owner: String(r.car_owner || ''),
    car_owner_street: String(r.car_owner_street || ''),
    car_owner_house: String(r.car_owner_house || ''),
    car_owner_flat: String(r.car_owner_flat || ''),
    car_sts_date: String(r.car_sts_date || ''),
    car_sts_number: String(r.car_sts_number || ''),
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
  };
}

export function listCounterpartyVehicles(counterpartyId: string): CounterpartyVehicle[] {
  const cpId = String(counterpartyId || '').trim();
  if (!cpId) return [];
  return all(
    `SELECT * FROM counterparty_vehicles
     WHERE counterparty_id = ?
     ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC`,
    [cpId]
  ).map(rowToVehicle);
}

export function getCounterpartyVehicle(id: string): CounterpartyVehicle | null {
  const row = get('SELECT * FROM counterparty_vehicles WHERE id = ?', [String(id || '').trim()]);
  return row ? rowToVehicle(row) : null;
}

/** Upsert по id или по госномеру/VIN в рамках контрагента. */
export function upsertCounterpartyVehicle(
  counterpartyId: string,
  vehicle: CounterpartyVehicleFields & { id?: string }
): CounterpartyVehicle {
  const cpId = String(counterpartyId || '').trim();
  if (!cpId) throw new Error('counterparty_id required');
  const cp = get('SELECT id FROM counterparties WHERE id = ?', [cpId]);
  if (!cp) throw new Error('Контрагент не найден');

  const plate = normPlate(vehicle.car_plate);
  const vin = normVin(vehicle.car_vin);
  if (!plate && !vin) throw new Error('Укажите гос. номер или VIN');

  let id = String(vehicle.id || '').trim();
  if (id) {
    const existing = get(
      'SELECT id FROM counterparty_vehicles WHERE id = ? AND counterparty_id = ?',
      [id, cpId]
    );
    if (!existing) id = '';
  }
  if (!id && plate) {
    const byPlate = get(
      `SELECT id FROM counterparty_vehicles
       WHERE counterparty_id = ? AND replace(upper(IFNULL(car_plate,'')),' ','') = ?
       LIMIT 1`,
      [cpId, plate]
    );
    if (byPlate) id = String(byPlate.id);
  }
  if (!id && vin) {
    const byVin = get(
      `SELECT id FROM counterparty_vehicles
       WHERE counterparty_id = ? AND replace(upper(IFNULL(car_vin,'')),' ','') = ?
       LIMIT 1`,
      [cpId, vin]
    );
    if (byVin) id = String(byVin.id);
  }

  const fields = [
    plate,
    vin,
    pick(vehicle.car_year),
    pick(vehicle.car_brand),
    pick(vehicle.car_model),
    pick(vehicle.car_color),
    pick(vehicle.car_category),
    pick(vehicle.car_pts),
    pick(vehicle.car_owner),
    pick(vehicle.car_owner_street),
    pick(vehicle.car_owner_house),
    pick(vehicle.car_owner_flat),
    pick(vehicle.car_sts_date),
    pick(vehicle.car_sts_number),
  ];

  if (id) {
    run(
      `UPDATE counterparty_vehicles SET
         car_plate=?, car_vin=?, car_year=?, car_brand=?, car_model=?, car_color=?,
         car_category=?, car_pts=?, car_owner=?, car_owner_street=?, car_owner_house=?,
         car_owner_flat=?, car_sts_date=?, car_sts_number=?,
         updated_at=datetime('now')
       WHERE id=? AND counterparty_id=?`,
      [...fields, id, cpId]
    );
  } else {
    id = newGuid();
    run(
      `INSERT INTO counterparty_vehicles (
         id, counterparty_id,
         car_plate, car_vin, car_year, car_brand, car_model, car_color,
         car_category, car_pts, car_owner, car_owner_street, car_owner_house,
         car_owner_flat, car_sts_date, car_sts_number
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, cpId, ...fields]
    );
  }
  const saved = getCounterpartyVehicle(id);
  if (!saved) throw new Error('Не удалось сохранить авто');
  return saved;
}

export function deleteCounterpartyVehicle(counterpartyId: string, vehicleId: string): void {
  const cpId = String(counterpartyId || '').trim();
  const id = String(vehicleId || '').trim();
  if (!cpId || !id) throw new Error('id required');
  run(`DELETE FROM counterparty_vehicles WHERE id = ? AND counterparty_id = ?`, [id, cpId]);
}

/** Контрагент сделки (id / amo_company_id / ИНН / телефон). */
export function resolveCounterpartyIdForDeal(deal: Row | null | undefined): string {
  if (!deal) return '';
  const companyId = String(deal.company_id || '').trim();
  if (companyId) {
    const byId = get('SELECT id FROM counterparties WHERE id = ?', [companyId]);
    if (byId) return String(byId.id);
    const byAmo = get(
      `SELECT id FROM counterparties WHERE amo_company_id = ? ORDER BY name LIMIT 1`,
      [companyId]
    );
    if (byAmo) return String(byAmo.id);
  }
  const inn = String(deal.buyer_inn || '').replace(/\D/g, '');
  if (inn.length === 10 || inn.length === 12) {
    const byInn = get(
      `SELECT id FROM counterparties
       WHERE replace(IFNULL(inn,''),' ','') = ?
       ORDER BY CASE WHEN kind = 'buyer' THEN 0 ELSE 1 END, name
       LIMIT 1`,
      [inn]
    );
    if (byInn) return String(byInn.id);
  }
  const phoneDig = digitsOnly(deal.buyer_phone);
  const phone10 = phoneDig.length >= 10 ? phoneDig.slice(-10) : '';
  if (phone10) {
    const candidates = all<{ id: string; phone: string; kind: string; name: string }>(
      `SELECT id, phone, kind, name FROM counterparties
       WHERE IFNULL(phone,'') != ''
         AND (phone LIKE ? OR phone LIKE ? OR phone LIKE ?)
       LIMIT 40`,
      [`%${phone10}%`, `%${phone10.slice(0, 3)}%${phone10.slice(3)}%`, `%${phoneDig}%`]
    );
    const hit = candidates.find((r) => digitsOnly(r.phone).slice(-10) === phone10);
    if (hit) return String(hit.id);
  }
  return '';
}

/**
 * Найти или создать карточку контрагента по данным сделки
 * (физлица часто без company_id — создаём по ФИО+телефону).
 */
export function ensureCounterpartyForDeal(deal: Row | null | undefined): string {
  const existing = resolveCounterpartyIdForDeal(deal);
  if (existing) return existing;
  if (!deal) return '';
  const name =
    pick(deal.company_name) ||
    pick(deal.buyer_name) ||
    pick(deal.name);
  if (!name) return '';
  const phone = normalizePhoneForStorage(deal.buyer_phone);
  const inn = String(deal.buyer_inn || '').replace(/\D/g, '');
  const id = newGuid();
  const isLegal =
    Number(deal.is_legal_entity) === 1 ||
    String(deal.buyer_kind || '').toLowerCase() === 'legal' ||
    inn.length === 10;
  run(
    `INSERT INTO counterparties (
       id, name, inn, phone, kind, party_kind, is_active, source, created_at
     ) VALUES (?, ?, ?, ?, 'buyer', ?, 1, 'deal-garage', datetime('now'))`,
    [id, name, inn, phone, isLegal ? 'legal' : 'person']
  );
  // привязать сделку к созданному контрагенту
  const dealId = pick(deal.id);
  if (dealId) {
    run(
      `UPDATE crm_deals
       SET company_id = CASE WHEN IFNULL(company_id,'') = '' THEN ? ELSE company_id END,
           company_name = CASE WHEN IFNULL(company_name,'') = '' THEN ? ELSE company_name END,
           updated_at = datetime('now')
       WHERE id = ?`,
      [id, isLegal ? name : '', dealId]
    );
  }
  return id;
}

export function garageForDeal(dealId: string, opts?: { ensure?: boolean }): {
  counterparty_id: string;
  vehicles: CounterpartyVehicle[];
} {
  const deal = get('SELECT * FROM crm_deals WHERE id = ?', [String(dealId || '').trim()]);
  const counterparty_id = opts?.ensure
    ? ensureCounterpartyForDeal(deal)
    : resolveCounterpartyIdForDeal(deal);
  if (!counterparty_id) return { counterparty_id: '', vehicles: [] };
  let vehicles = listCounterpartyVehicles(counterparty_id);
  // разово подтянуть авто с текущего заказа, если гараж пуст
  if (!vehicles.length && deal) {
    const plate = normPlate(deal.car_plate);
    const vin = normVin(deal.car_vin);
    if (plate || vin) {
      try {
        upsertCounterpartyVehicle(counterparty_id, {
          car_plate: plate,
          car_vin: vin,
          car_year: pick(deal.car_year),
          car_brand: pick(deal.car_brand),
          car_model: pick(deal.car_model),
          car_color: pick(deal.car_color),
          car_category: pick(deal.car_category),
          car_pts: pick(deal.car_pts),
          car_owner: pick(deal.car_owner),
          car_owner_street: pick(deal.car_owner_street),
          car_owner_house: pick(deal.car_owner_house),
          car_owner_flat: pick(deal.car_owner_flat),
          car_sts_date: pick(deal.car_sts_date),
          car_sts_number: pick(deal.car_sts_number),
        });
        vehicles = listCounterpartyVehicles(counterparty_id);
      } catch {
        /* ignore seed errors */
      }
    }
  }
  return { counterparty_id, vehicles };
}

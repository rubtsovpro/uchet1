#!/usr/bin/env node
/** One-shot: проставить products.item_kind = product|service по всей номенклатуре. */
import { reclassifyAllProductKinds } from '../api/dist/product-kind.js';

const result = reclassifyAllProductKinds();
console.log(JSON.stringify({ ok: true, ...result }, null, 2));

/* ===================================================================
   HESABO — shared core for n8n Code nodes (Telegram + Google Sheets)
   This block is embedded in BOTH "Build AI Prompt" and "HESABO Engine".
   =================================================================== */
const DAY = 86400000;
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0,10);
const N = v => { if (v===null||v===undefined||v==='') return 0; const x = typeof v==='number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g,'')); return isNaN(x)?0:x; };
const S_ = v => (v===null||v===undefined) ? '' : String(v);
const fmtN = (n,d=0) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtDate = d => new Date(d).toISOString().slice(0,10);
const addDays = (d,n) => new Date(new Date(d).getTime()+n*DAY);
const daysBetween = (a,b) => Math.round((new Date(b)-new Date(a))/DAY);
const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const fmtDateAr = d => { const x = new Date(d); if (isNaN(x)) return S_(d); return `${x.getDate()} ${AR_MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
const firstName = n => S_(n).trim().split(/\s+/)[0]||'';
const sum = (arr,f) => arr.reduce((t,x)=>t+(f?f(x):x),0);
const byId = (arr,id) => arr.find(x=>x.id===id);
const esc = s => S_(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function norm(s){
  return S_(s).toLowerCase()
    .replace(/(\d)[,،](\d)/g,'$1$2')
    .replace(/[ً-ْـ]/g,'')
    .replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[،,؟?!.:;()\[\]"'«»]/g,' ')
    .replace(/\s+/g,' ').trim();
}
const normPhone = p => { let d = S_(p).replace(/[٠-٩]/g, x => '٠١٢٣٤٥٦٧٨٩'.indexOf(x)).replace(/\D/g,''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('966')) d = d.slice(3); if (d.startsWith('0')) d = d.slice(1); if (d.length===9 && d.startsWith('5')) return '+966'+d; return d.length>=10 && d.length<=15 ? '+'+d : ''; };
const looksLikePhone = t => /^\s*\+?[\d\s\-()]{9,18}\s*$/.test(S_(t)) && !!normPhone(t);


/* ---------- sheets loader: one batchGet call ("Load Sheets") or legacy per-sheet "Read X" nodes ---------- */
const SHEET_NAMES = ['Settings','Users','Customers','Products','Invoices','Payments','Quotations','Leads','Orders','Approvals','Conversations','Handoffs'];
function makeRowsReader($){
  let batch = null;
  try { const j = $('Load Sheets').first().json; if (j && Array.isArray(j.valueRanges)) batch = j.valueRanges; } catch(e){}
  if (batch){
    const map = {};
    batch.forEach((vr, i) => {
      const name = SHEET_NAMES[i] || String(vr.range||'').split('!')[0].replace(/'/g,'');
      const vals = vr.values || []; const hdr = (vals[0]||[]).map(h => String(h).trim());
      map[name] = vals.slice(1).filter(r => r.some(v => String(v).trim() !== '')).map(r => { const o = {}; hdr.forEach((h, k) => { if (h) o[h] = r[k] === undefined ? '' : r[k]; }); return o; });
    });
    return name => map[String(name).replace(/^Read /,'')] || [];
  }
  return name => { try { return $(name).all().map(i => i.json); } catch(e){ return []; } };
}

/* ---------- load the sheets into a typed DB ---------- */
function loadDB(sheets){
  const rows = n => (sheets[n]||[]).filter(r => r && Object.values(r).some(v => v!==''&&v!==null&&v!==undefined));
  const settings = {}; rows('Settings').forEach(r => settings[S_(r.key).trim()] = S_(r.value).trim());
  const bool = k => /^(true|1|yes|نعم)$/i.test(S_(settings[k]));
  const db = {
    settings: { companyName: settings.companyName||'الشركة', botName: settings.botName||'مساعد حسابو', currency: settings.currency||'ريال', vat: N(settings.vat)||15, overdueDays: N(settings.overdueDays)||30, approvalThreshold: N(settings.approvalThreshold)||20000, followUpDays: N(settings.followUpDays)||7,
      approvals: { CREATE_INVOICE: bool('approval_CREATE_INVOICE'), RECORD_PAYMENT: bool('approval_RECORD_PAYMENT'), SEND_QUOTATION: bool('approval_SEND_QUOTATION'), CREATE_CUSTOMER: bool('approval_CREATE_CUSTOMER') } },
    users: rows('Users').map(r => ({ id:S_(r.id), name:S_(r.name), role:S_(r.role), phone:normPhone(r.phone), title:S_(r.title), telegram_id:S_(r.telegram_id) })),
    customers: rows('Customers').map(r => ({ id:S_(r.id), company:S_(r.company), core:S_(r.core), name:S_(r.contact_name), phone:normPhone(r.phone), vat:S_(r.vat), city:S_(r.city), creditLimit:N(r.credit_limit), status:S_(r.status)||'active', salesRep:S_(r.sales_rep), telegram_id:S_(r.telegram_id) })),
    products: rows('Products').map(r => ({ id:S_(r.id), name:S_(r.name), cat:S_(r.category), unit:S_(r.unit), price:N(r.price), vat:N(r.vat)||15, keys:S_(r.keywords).split(/[,،]/).map(x=>x.trim()).filter(x=>x && !x.startsWith('(')) })),
    invoices: rows('Invoices').map(r => ({ id:S_(r.id), customerId:S_(r.customer_id), date:S_(r.date), dueDate:S_(r.due_date), project:S_(r.project), items:S_(r.items), subtotal:N(r.subtotal), vat:N(r.vat), amount:N(r.amount), paid:N(r.paid), remaining:N(r.remaining), status:S_(r.status), createdBy:S_(r.created_by) })),
    payments: rows('Payments').map(r => ({ id:S_(r.id), customerId:S_(r.customer_id), invoiceId:S_(r.invoice_id), date:S_(r.date), amount:N(r.amount), method:S_(r.method), reference:S_(r.reference), recordedBy:S_(r.recorded_by) })),
    quotations: rows('Quotations').map(r => ({ id:S_(r.id), customerId:S_(r.customer_id), leadId:S_(r.lead_id), contactPhone:S_(r.contact_phone), date:S_(r.date), validUntil:S_(r.valid_until), items:S_(r.items), subtotal:N(r.subtotal), vat:N(r.vat), total:N(r.total), status:S_(r.status), location:S_(r.location), thickness:S_(r.thickness), notes:S_(r.notes), requestedVia:S_(r.requested_via), salesRep:S_(r.sales_rep), followUps:N(r.follow_ups), lastFollowUp:S_(r.last_follow_up) })),
    leads: rows('Leads').map(r => ({ id:S_(r.id), date:S_(r.date), name:S_(r.name), phone:S_(r.phone), company:S_(r.company), service:S_(r.service), serviceName:S_(r.service_name), location:S_(r.location), qty:N(r.qty), unit:S_(r.unit), thickness:S_(r.thickness), status:S_(r.status), source:S_(r.source), assignedTo:S_(r.assigned_to), telegram_id:S_(r.telegram_id) })),
    orders: rows('Orders').map(r => ({ id:S_(r.id), quotationId:S_(r.quotation_id), customerId:S_(r.customer_id), date:S_(r.date), total:N(r.total), status:S_(r.status) })),
    approvals: rows('Approvals').map(r => ({ id:S_(r.id), type:S_(r.type), payload:safeJSON(r.payload,{}), requestedBy:S_(r.requested_by), requestedByChat:S_(r.requested_by_chat), requesterRole:S_(r.requester_role), approverRole:S_(r.approver_role), requestedAt:S_(r.requested_at), status:S_(r.status), decidedBy:S_(r.decided_by), decidedAt:S_(r.decided_at), note:S_(r.note), result:S_(r.result) })),
    conversations: rows('Conversations').map(r => ({ id:S_(r.id), phone:S_(r.phone), role:S_(r.role), name:S_(r.name), context:safeJSON(r.context,null), history:safeJSON(r.history,[]), lastMessage:S_(r.last_message), updatedAt:S_(r.updated_at) })),
    handoffs: rows('Handoffs').map(r => ({ id:S_(r.id), ts:S_(r.ts), chatId:S_(r.chat_id), actor:S_(r.actor), role:S_(r.role), message:S_(r.message), reason:S_(r.reason), status:S_(r.status), reply:S_(r.reply) })),
  };
  db.productById = id => db.products.find(p=>p.id===id);
  db.expandItems = str => S_(str).split(';').map(x=>x.trim()).filter(Boolean).map(x => { const m = x.match(/^(P-\d+)x([\d.]+)$/i); if (!m) return { productId:'', name:x, unit:'', qty:1, price:0, total:0 }; const p = db.productById(m[1].toUpperCase()); const qty = N(m[2]); return { productId:m[1].toUpperCase(), name:p?p.name:m[1], unit:p?p.unit:'', qty, price:p?p.price:0, total:qty*(p?p.price:0) }; });
  db.nextId = (prefix, arr, start) => { let max = start-1; arr.forEach(x => { const m = S_(x.id).match(/(\d+)$/); if (m && S_(x.id).startsWith(prefix)) max = Math.max(max, +m[1]); }); return prefix + (max+1); };
  return db;
}
function safeJSON(v, d){ if (v===null||v===undefined||v==='') return d; if (typeof v==='object') return v; try { return JSON.parse(v); } catch(e){ return d; } }
function invoiceStatus(inv){ if (inv.remaining<=0) return 'paid'; const overdue = inv.dueDate < TODAY; if (inv.paid>0) return overdue?'overdue':'partial'; return overdue?'overdue':'unpaid'; }
const STATUS_AR = { paid:'مدفوعة', partial:'مدفوعة جزئياً', unpaid:'غير مدفوعة', overdue:'متأخرة', draft:'مسودة', sent:'مرسل', accepted:'مقبول', rejected:'مرفوض', expired:'منتهي', pending_approval:'بانتظار الاعتماد', new:'جديد', contacted:'تم التواصل', quoted:'تم التسعير', won:'تم الفوز', lost:'خسارة', open:'مفتوح', in_progress:'قيد التنفيذ', done:'منتهي', pending:'معلق', approved:'معتمد', resolved:'تم الحل', active:'نشط', blocked:'موقوف' };
const ROLE_AR = { customer:'عميل', sales:'مبيعات', accountant:'محاسب', admin:'مدير', unknown:'رقم غير معروف' };
const STAFF = r => r==='sales'||r==='accountant'||r==='admin';
function customerInvoices(db,cid){ return db.invoices.filter(i=>i.customerId===cid && i.status!=='draft'); }
function customerBalance(db,cid){ const inv = customerInvoices(db,cid); return { total:sum(inv,i=>i.amount), paid:sum(inv,i=>i.paid), remaining:sum(inv,i=>i.remaining), overdue:sum(inv.filter(i=>invoiceStatus(i)==='overdue'),i=>i.remaining), count:inv.length }; }
function customerName(db,cid){ const c = byId(db.customers,cid); return c ? c.company : (cid||'—'); }

/* ---------- identity: who is this Telegram chat? ---------- */
function resolveActor(db, chatId, from){
  const cid = S_(chatId);
  const conv = db.conversations.find(c => c.id===cid) || null;
  const u = db.users.find(x => x.telegram_id===cid); if (u) return { role:u.role, name:u.name, id:u.id, phone:u.phone, chatId:cid, user:u, conv, linked:true };
  const c = db.customers.find(x => x.telegram_id===cid); if (c) return { role:'customer', name:c.name, id:c.id, phone:c.phone, chatId:cid, customer:c, conv, linked:true };
  if (conv && conv.phone){ // linked in an earlier turn (row not yet visible) — fall back to the conversation record
    const u2 = db.users.find(x => x.phone===normPhone(conv.phone)); if (u2) return { role:u2.role, name:u2.name, id:u2.id, phone:u2.phone, chatId:cid, user:u2, conv, linked:true };
    const c2 = db.customers.find(x => x.phone===normPhone(conv.phone)); if (c2) return { role:'customer', name:c2.name, id:c2.id, phone:c2.phone, chatId:cid, customer:c2, conv, linked:true };
  }
  const nm = from ? [from.first_name, from.last_name].filter(Boolean).join(' ') : '';
  return { role:'unknown', name: nm || 'رقم غير معروف', id:null, phone:'', chatId:cid, conv, linked:false, tgName:nm };
}

/* ---------- catalog matching & entity extraction ---------- */
const CITIES = ['الرياض','جدة','المدينة المنورة','مكة','الدمام','الخبر','القصيم','تبوك','أبها','جازان','ينبع','الطائف','حائل','الجبيل','نجران','الأحساء'];
const CITY_N = CITIES.map(c => ({ n:norm(c), name:c }));
function matchProduct(db, text){
  const n = norm(text); if (!n) return null;
  if (/كور|coring|تخريم|ثقب/.test(n)){ if (/\b200\b/.test(n)) return db.productById('P-06'); if (/\b150\b/.test(n)) return db.productById('P-05'); return db.productById('P-04'); }
  if (/ارضي|floor/.test(n)) return db.productById('P-03');
  if (/سلك|واير|wire/.test(n)) return db.productById('P-02');
  for (const p of db.products){ for (const k of p.keys){ if (k && n.includes(norm(k))) return p; } }
  const m = n.match(/^p-?(\d\d)$/); if (m) return db.productById('P-'+m[1]);
  return null;
}
function unitNorm(u){ u = norm(u||''); if (/مربع|م2|م²|²/.test(u)) return 'م²'; if (/مكعب|م3|م³|³/.test(u)) return 'م³'; if (/نقط|ثقب|ثقوب|فتح|كور/.test(u)) return 'نقطة'; if (/عدد|قطع|حب/.test(u)) return 'عدد'; if (/متر|م ?ط|^م$/.test(u)) return 'م.ط'; return u||null; }
function findCustomerInText(db, n){
  let best = null;
  for (const c of db.customers){
    const core = norm(c.core); if (core.length>=3 && n.includes(core) && (!best || core.length>best.len)) best = { c, len:core.length };
    const nm = norm(c.name).split(' '); if (nm.length===2 && n.includes(nm[0]) && n.includes(nm[1]) && (!best || 99>best.len)) best = { c, len:99 };
    const idm = n.match(/c-?0*(\d{1,3})(?=\s|$)/); if (idm && c.id==='C-'+String(idm[1]).padStart(3,'0')) return c;
  }
  return best ? best.c : null;
}
function extractEntities(db, raw){
  const n = norm(raw); const e = {}; let m;
  if ((m = n.match(/(?:فاتور[هة]|فواتير|inv)[\s#:\-]*(?:رقم\s*)?#?\s*(\d{3,6})/))) e.invoice_no = +m[1]; else if ((m = n.match(/inv[\s\-]?(\d{3,6})/))) e.invoice_no = +m[1];
  if ((m = n.match(/(?:عرض (?:ال)?سعر|عرض|qt)[\s#:\-]*(?:رقم\s*)?#?\s*(\d{4})(?=\s|$)/))) e.quotation_no = +m[1]; else if ((m = n.match(/qt[\s\-]?(\d{4})/))) e.quotation_no = +m[1];
  if ((m = n.match(/(ap|ho)[\s\-]?(\d{1,5})(?=\s|$)/))) e.ref_id = m[1].toUpperCase()+'-'+m[2];
  if ((m = n.match(/(\d+(?:\.\d+)?)\s*(?:الف|ألف|k)(?=\s|$)/))) e.amount = Math.round(+m[1]*1000); else if ((m = n.match(/(\d{2,9}(?:\.\d+)?)\s*(?:ريال|ر\s?س|sar|جنيه|درهم)/))) e.amount = +m[1];
  if ((m = n.match(/(\d+(?:\.\d+)?)\s*(متر مربع|متر مكعب|متر طولي|م\.?ط|م ?2|م²|م ?3|م³|متر|م(?=\s|$)|نقطه|نقاط|نقط|عدد|قطعه|قطع|ثقب|ثقوب|فتحه|فتحات|حبه|كور(?=\s|$))/))) { e.quantity = +m[1]; e.unit = unitNorm(m[2]); }
  if ((m = n.match(/(?:سمك|سماكه|تخانه)\s*(?:ال)?(?:خرسانه|حيطه|بلاطه|جدار)?\s*(\d+(?:\.\d+)?)\s*(سم|مم|cm|mm|م|متر)?/))) { e.thickness_cm = (m[2]==='مم'||m[2]==='mm') ? +m[1]/10 : (m[2]==='م'||m[2]==='متر') ? +m[1]*100 : +m[1]; }
  else if ((m = n.match(/(\d+(?:\.\d+)?)\s*(?:سم|cm)(?=\s|$)/))) e.thickness_cm = +m[1];
  for (const c of CITY_N){ if (n.includes(c.n)) { e.location = c.name; break; } }
  if (!e.location && (m = n.match(/(?:في موقع|بموقع|موقع|الموقع|مكان|في|فى)\s+([؀-ۿ]{3,}(?:\s[؀-ۿ]{2,})?)/))) { if (!/^(الفاتور|الحساب|عرض|السعر|الشرك|النظام|الموقع)/.test(m[1])) e.location_text = m[1]; }
  if ((m = n.match(/(\d+)\s*(?:يوم|ايام)/))) e.days = +m[1];
  if (/اسبوع|week/.test(n)) e.period='week'; else if (/شهر|month/.test(n)) e.period='month';
  if (/كاش|نقدي|نقدا|cash/.test(n)) e.payment_method='نقدي'; else if (/تحويل|حواله|حولت|بنك|transfer|iban|ايبان/.test(n)) e.payment_method='تحويل بنكي'; else if (/شيك|cheque|check/.test(n)) e.payment_method='شيك';
  if ((m = n.match(/(?:رقم (?:مرجع|المرجع|التحويل|العمليه|الحواله)|مرجع|ref(?:erence)?)[:\s#]*([a-z0-9\-]{4,})/))) e.reference = m[1].toUpperCase();
  const ph = normPhone((S_(raw).match(/(?:\+?966|0)?\s?5\d{8}/)||[''])[0]); if (ph) e.phone = ph;
  const prod = matchProduct(db, n); if (prod) e.service = prod.id;
  const cust = findCustomerInText(db, n); if (cust) e.customer_id = cust.id;
  if ((m = S_(raw).match(/(شركة|مؤسسة|شركه|مؤسسه)\s+[؀-ۿ]+(?:\s[؀-ۿ]+){0,3}/))) e.company_text = m[0].replace(/\s+(اسم|المسؤول|تليفون|رقم|جوال|موبايل|عليه|عليها|رصيد|كام).*$/,'');
  if ((m = S_(raw).match(/(?:اسمه|اسمها|اسم المسؤول|المسؤول|الاسم|اسم)\s*:?\s*([؀-ۿ]+(?:\s[؀-ۿ]+)?)/))) e.person_name = m[1];
  const nums = (n.match(/(?<![\w-])\d+(?:\.\d+)?(?![\w])/g)||[]).map(Number); if (nums.length) e.numbers = nums;
  return e;
}

/* ---------- intents ---------- */
const INTENTS = {
  GREETING:'greeting / small talk', THANKS:'thanks', HELP:'asks what the assistant can do',
  CUSTOMER_BALANCE:'how much is owed / current balance (عليا كام؟ رصيدي؟ شركة X عليها كام؟)',
  LAST_INVOICE:'send the last / latest invoice', INVOICE_STATUS:'is invoice N paid? status of a specific invoice number', INVOICE_DUE_DATE:'due date of an invoice', LIST_INVOICES:'list invoices (all / open / unpaid)',
  PAYMENT_SEARCH:'what was paid / last payment / list payments', RECORD_PAYMENT:'report or record a payment made (حولت 5000، سجل دفعة)', STATEMENT:'account statement',
  CREATE_QUOTATION:'request a quotation / price for a service', QUOTATION_STATUS:'status of an existing quotation', OPEN_QUOTATIONS:'staff: list open / pending quotations', FOLLOW_UP:'staff: follow up customers who did not answer quotations', SALES_REPORT:'staff: sales report for week / month',
  WHO_OWES:'staff: which customers owe money / overdue more than N days', CUSTOMER_SEARCH:'staff: find customer details', CREATE_CUSTOMER:'staff: add a new customer', CREATE_INVOICE:'staff: create an invoice for a customer', CREATE_LEAD:'staff: register a new lead',
  APPROVE:'staff: approve a pending request by its id (اعتمد AP-3)', REJECT:'staff: reject a pending request by its id (ارفض AP-3)', LIST_APPROVALS:'staff: list pending approvals', HUMAN_REPLY:'admin: reply to a handoff (رد HO-2 النص)',
  CONFIRM:'yes / confirm / ok', DENY:'no / not correct', CANCEL:'cancel the current request', FLOW_ANSWER:'answers a question the assistant asked in an active flow', UNKNOWN:'anything else / unclear',
};
const INTENT_AR = { GREETING:'تحية', THANKS:'شكر', HELP:'مساعدة', CUSTOMER_BALANCE:'رصيد العميل', LAST_INVOICE:'آخر فاتورة', INVOICE_STATUS:'حالة فاتورة', INVOICE_DUE_DATE:'موعد استحقاق', LIST_INVOICES:'قائمة الفواتير', PAYMENT_SEARCH:'بحث مدفوعات', RECORD_PAYMENT:'تسجيل دفعة', STATEMENT:'كشف حساب', CREATE_QUOTATION:'طلب عرض سعر', QUOTATION_STATUS:'حالة عرض سعر', OPEN_QUOTATIONS:'العروض المفتوحة', FOLLOW_UP:'متابعة العروض', SALES_REPORT:'تقرير مبيعات', WHO_OWES:'المتأخرين بالسداد', CUSTOMER_SEARCH:'بحث عميل', CREATE_CUSTOMER:'إضافة عميل', CREATE_INVOICE:'إنشاء فاتورة', CREATE_LEAD:'تسجيل فرصة', APPROVE:'اعتماد', REJECT:'رفض طلب', LIST_APPROVALS:'الطلبات المعلقة', HUMAN_REPLY:'رد بشري', CONFIRM:'تأكيد', DENY:'رفض', CANCEL:'إلغاء', FLOW_ANSWER:'إجابة', UNKNOWN:'غير مفهوم' };
const COMMON = ['GREETING','THANKS','HELP','CONFIRM','DENY','CANCEL','FLOW_ANSWER','UNKNOWN'];
const PERMS = {
  customer:[...COMMON,'CUSTOMER_BALANCE','LAST_INVOICE','INVOICE_STATUS','INVOICE_DUE_DATE','LIST_INVOICES','PAYMENT_SEARCH','RECORD_PAYMENT','STATEMENT','CREATE_QUOTATION','QUOTATION_STATUS'],
  sales:[...COMMON,'CUSTOMER_SEARCH','CREATE_CUSTOMER','CUSTOMER_BALANCE','CREATE_LEAD','CREATE_QUOTATION','QUOTATION_STATUS','OPEN_QUOTATIONS','FOLLOW_UP','SALES_REPORT'],
  accountant:[...COMMON,'CUSTOMER_SEARCH','CUSTOMER_BALANCE','LAST_INVOICE','INVOICE_STATUS','INVOICE_DUE_DATE','LIST_INVOICES','PAYMENT_SEARCH','RECORD_PAYMENT','STATEMENT','CREATE_INVOICE','WHO_OWES','APPROVE','REJECT','LIST_APPROVALS'],
  admin: Object.keys(INTENTS),
  unknown:[...COMMON,'CREATE_QUOTATION'],
};
const SENSITIVE = ['CREATE_INVOICE','RECORD_PAYMENT','CREATE_CUSTOMER'];

/* ---------- rule-based NLU (offline fallback) ---------- */
function ruleNLU(db, raw, ctx){
  const n = norm(raw); const e = extractEntities(db, raw);
  const R = (intent,conf,why) => ({ intent, confidence:conf, entities:e, engine:'rules', why });
  const words = n.split(' ').length;
  if (/^(الغي|الغاء|كنسل|cancel|خلاص مش عايز|مش عايز|بطل|وقف)/.test(n)) return R('CANCEL',.95,'cancel');
  if (/^(ايوه|ايوا|اه|اها|نعم|تمام|موافق|اوك|اوكي|ok|okay|yes|اكيد|ماشي|صح|تاكيد|اعتمد الطلب|كده تمام|تمام كده|y)(?=\s|$)/.test(n) && words<=3) return R('CONFIRM',.95,'confirm');
  if (/^(لا|لأ|لاء|no|مش صح|غلط|مش كده|لا غلط)(?=\s|$)/.test(n) && words<=3) return R('DENY',.95,'deny');
  if (/^(اعتمد|اعتماد|وافق|موافقه علي|approve)(?=\s|$)/.test(n) && e.ref_id) return R('APPROVE',.95,'approve');
  if (/^(ارفض|رفض|reject)(?=\s|$)/.test(n) && e.ref_id) return R('REJECT',.95,'reject');
  if (/^(رد|reply)(?=\s|$)/.test(n) && e.ref_id && /^ho-/i.test(e.ref_id)) return R('HUMAN_REPLY',.95,'human reply');
  if (/(الطلبات المعلقه|المعلق|الموافقات|طلبات الاعتماد|pending approvals|ايه المعلق|فيه حاجه مستنيه)/.test(n)) return R('LIST_APPROVALS',.9,'approvals');
  if (ctx && ctx.flow){ const newReq = /(عليا كام|رصيد|اخر فاتوره|كشف حساب|عرض سعر|تقرير|مين عليه)/.test(n); if (!newReq) return R('FLOW_ANSWER',.85,'active flow'); }
  if (/^(سلام|السلام عليكم|اهلا|اهلين|هاي|هلا|مرحبا|صباح الخير|صباح النور|مساء الخير|مساء النور|hi|hello|hey|السلام|ازيك|ازيكم|كيفك|كيف الحال|عامل ايه)/.test(n) && words<=4) return R('GREETING',.95,'greeting');
  if (/^(شكرا|تسلم|مشكور|thanks|thank you|يعطيك العافيه|الله يعطيك العافيه)/.test(n) && words<=4) return R('THANKS',.95,'thanks');
  if (/(مساعده|help|تقدر تعمل ايه|ايه اللي تقدر|الاوامر|ممكن اعمل ايه|بتعمل ايه|ازاي استخدم|ايه الخدمات اللي)/.test(n)) return R('HELP',.9,'help');
  if (/(مين عليه|مين عليهم|مين اللي عليه|العملاء اللي عليهم|المتاخرين|متاخر في السداد|overdue|الديون|التحصيل|المديونيات|مستحقات متاخره|اكتر من \d+ يوم|فاتت الاستحقاق|عدت الاستحقاق|مين لسه ما دفعش|مين ما دفعش)/.test(n)) return R('WHO_OWES',.9,'who owes');
  if (/(اعمل متابعه|متابعه للعملاء|follow ?up|فكر العملاء|ذكر العملاء|ابعت تذكير|تابع العملاء|متابعه العروض|اللي ما ردوش|ما ردوش)/.test(n)) return R('FOLLOW_UP',.9,'follow up');
  if (/(تقرير المبيعات|تقرير الاسبوع|تقرير الشهر|sales report|ملخص المبيعات|المبيعات هذا الاسبوع|المبيعات الاسبوع|المبيعات الشهر|بعنا كام|جهزلي تقرير|تقرير مبيعات|ايه اخبار المبيعات)/.test(n)) return R('SALES_REPORT',.9,'sales report');
  if (/(عروض الاسعار المفتوحه|العروض المفتوحه|كل عروض الاسعار|العروض المعلقه|open quotations|العروض اللي لسه|عروض السعر اللي لسه|عروض الاسعار المعلقه|العروض اللي منتظره|هاتلي كل عروض)/.test(n)) return R('OPEN_QUOTATIONS',.9,'open quotes');
  if (e.quotation_no || /(فين عرض السعر|حاله عرض السعر|حاله العرض|عرض السعر بتاعي|عرضي وصل|العرض اتوافق|العرض اتقبل|عرض السعر اتقبل|اتبعت العرض|العرض اتبعت|رد علي العرض|العرض وصل|هتبعتوا العرض امتي|العرض هيتبعت امتي|فين العرض|صار علي عرض|صار علي العرض|وصلني عرض|العرض جاهز|عرض السعر جاهز)/.test(n)) return R('QUOTATION_STATUS',.85,'quotation status');
  if (/(ضيف عميل|اضف عميل|سجل عميل|add customer|new customer|انشئ عميل|ضيفلي عميل|سجلي عميل|اضيف عميل)/.test(n)) return R('CREATE_CUSTOMER',.9,'create customer');
  if (/(سجل ليد|\blead\b|عميل محتمل|ضيف ليد|فرصه جديده|سجل فرصه|عميل مهتم|سجله كفرصه)/.test(n)) return R('CREATE_LEAD',.85,'create lead');
  if (/(عرض سعر|عرض اسعار|عروض اسعار|تسعير|تسعيره|quotation|quote|(?<!مديون |عليا |عليه |عليها )(?<![؀-ۿ])بكام(?![؀-ۿ])|كام سعر|سعر ال|اسعار ال|price|كام تكلفه|تكلفه|كم سعر|كم يكلف|(?<![؀-ۿ])بكم(?![؀-ۿ]))/.test(n) || (e.service && /(محتاج|عايز|عاوز|احتاج|ابغي|ابي|ابغى|نبي|ممكن|اطلب|طلب|عندنا شغل|عندي شغل|نحتاج)/.test(n))) return R('CREATE_QUOTATION',.88,'quotation request');
  if (/(اعمل فاتوره|اعملي فاتوره|انشئ فاتوره|اصدر فاتوره|فاتوره جديده|create invoice|اعمل فاتور|سجل فاتوره|اطلع فاتوره)/.test(n)) return R('CREATE_INVOICE',.9,'create invoice');
  if (/(عميل جديد)/.test(n)) return R('CREATE_CUSTOMER',.7,'new customer words');
  if (/(دور علي عميل|ابحث عن عميل|بيانات عميل|بيانات شركه|رقم عميل|تليفون عميل|search customer|عميل اسمه|فين عميل|هات بيانات|رقم شركه|تليفون شركه|بيانات ال)/.test(n)) return R('CUSTOMER_SEARCH',.85,'customer search');
  if (/(كشف حساب|كشف الحساب|statement|اعمل كشف|ابعت كشف|كشف حسابي|هات كشف)/.test(n)) return R('STATEMENT',.92,'statement');
  if (/(موعد استحقاق|موعد الاستحقاق|استحقاق|تاريخ الاستحقاق|due date|تستحق|يستحق|امتي الدفع|اخر ميعاد|اخر موعد|ميعاد الدفع|امتي اسدد|امتي السداد|متي اسدد|متي السداد)/.test(n)) return R('INVOICE_DUE_DATE',.88,'due date');
  if (/(اخر فاتوره|last invoice|اخر فاتور|هات الفاتوره الاخيره|الفاتوره الاخيره|اخر فاتورتي)/.test(n)) return R('LAST_INVOICE',.92,'last invoice');
  if (e.invoice_no && !/((?<!ات)دفعت|حولت|سجل دفعه)/.test(n)) return R('INVOICE_STATUS',.88,'invoice number');
  if (/(الفاتوره اتدفعت|اتدفعت|اتسددت|حاله الفاتوره|الفاتوره مدفوعه|status of invoice|invoice status|الفاتوره دي)/.test(n) && !/((?<!ات)دفعت|حولت)/.test(n)) return R('INVOICE_STATUS',.8,'invoice status words');
  if (/(فواتيري|الفواتير|كل الفواتير|هات الفواتير|فواتير مفتوحه|الفواتير المفتوحه|فواتير غير مدفوعه|invoices|عندي فواتير|ايه الفواتير|فواتير ال|فواتير)/.test(n)) return R('LIST_INVOICES',.85,'list invoices');
  const payVerb = /(سجل دفعه|سجلي دفعه|اضف دفعه|record payment|تم التحويل|حولت|حولتلكم|دفعتلكم|سددت|(?<!ات)دفعت|ادفع|عايز ادفع|هدفع|هحول)/.test(n);
  const paySearch = /(اخر دفعه|مدفوعات|دفعاتي|ايه اللي اتدفع|كام دفعت|دفعت كام|payments|اخر تحويل|التحويلات|كام اللي اتدفع|اللي اتدفع|دفعاتنا|هات المدفوعات|سجل الدفعات|الدفعات)/.test(n);
  if (payVerb && (e.amount || (e.numbers && e.numbers.some(x=>x>=50)) || /سجل|اضف|record|ادفع|عايز ادفع|هدفع|هحول/.test(n))) { if (!e.amount && e.numbers){ const c = e.numbers.filter(x=>x!==e.invoice_no && x>=50); if (c.length) e.amount = Math.max(...c); } return R('RECORD_PAYMENT',.88,'payment'); }
  if (paySearch || (/دفع/.test(n) && /كام|امتي|ايه/.test(n))) return R('PAYMENT_SEARCH',.85,'payment search');
  if (/(عليا كام|عليه كام|عليها كام|علي كام|كام عليا|كام عليه|رصيد|الرصيد|المتبقي|المستحق|باقي عليا|كم علي|كم المتبقي|balance|outstanding|اجمالي المستحق|حسابي كام|كام حسابي|عندكم كام|كام ليكم|ليكم كام|مديون بكام|عليا فلوس|عليه فلوس|عليها فلوس|كم باقي|فاضل عليا|فاضل كام|الباقي علي|كم المبلغ|المبلغ الباقي|كم عليه|كم عليها|عليا ايه|ايه اللي عليا)/.test(n)) return R('CUSTOMER_BALANCE',.9,'balance');
  if (e.customer_id && /(عميل|شركه|مؤسسه)/.test(n)) return R('CUSTOMER_SEARCH',.6,'customer name only');
  return R('UNKNOWN',.3,'no pattern');
}

/* ---------- prompt for Gemini ---------- */
function buildAIPrompt(db, raw, actor, ctx, history){
  const roleDesc = { customer:'a registered customer of the company', sales:'a sales representative (staff)', accountant:'an accountant (staff)', admin:'the company admin / pricing manager (staff)', unknown:'an unknown user, not registered' }[actor.role];
  const intentLines = Object.entries(INTENTS).map(([k,v]) => `- ${k}: ${v}`).join('\n');
  const services = db.products.map(p => `${p.id} ${p.name} (${p.unit})`).join('; ');
  const hist = (history||[]).slice(-6).map(m => (m.dir==='out' ? 'USER: ' : 'ASSISTANT: ') + S_(m.text).slice(0,200)).join('\n');
  const flowTxt = ctx && ctx.flow ? JSON.stringify({ flow:ctx.flow, filled:ctx.slots, missing:ctx.missing, awaiting_confirmation:!!ctx.confirming }) : 'none';
  return `You are the NLU (intent detection) layer of "HESABO", a Telegram/WhatsApp assistant connected to the accounting system of a concrete cutting / coring / GPR scanning contractor in Saudi Arabia. Users write in Arabic (Egyptian or Gulf dialect) or English.
Your ONLY job: classify the LAST user message into one intent and extract entities. Never compute balances, never invent data.

Sender role: ${actor.role} (${roleDesc}). Sender name: ${actor.name}.${actor.customer ? ' Registered company: '+actor.customer.company : ''}
Known customer companies (staff may refer to them): ${db.customers.slice(0,12).map(c=>c.company).join(' | ')} ... (${db.customers.length} total; put the name the user wrote in customer_name)
Services catalog: ${services}
Active flow (the assistant is collecting information): ${flowTxt}
Rules for an active flow: if the message answers a missing slot, set intent "FLOW_ANSWER" and put the values in flow_answer using the slot names in "missing". If awaiting_confirmation and the user agrees (نعم/أيوه/تمام/ok) → "CONFIRM"; disagrees → "DENY"; wants to stop → "CANCEL". If the message is clearly a NEW different request, classify it normally.
Approval commands: "اعتمد AP-3" → APPROVE with ref_id "AP-3"; "ارفض AP-3 السبب" → REJECT; "رد HO-2 النص" → HUMAN_REPLY with ref_id "HO-2".

Recent conversation (USER = sender, ASSISTANT = bot):
${hist || '(none)'}

Intents:
${intentLines}

Reply with ONLY one JSON object, no prose, no markdown:
{"intent": "<INTENT>", "confidence": <0..1>, "entities": {"customer_name": string|null, "invoice_no": number|null, "quotation_no": number|null, "ref_id": string|null, "amount": number|null, "service": string|null (a product id like "P-04" when it matches the catalog, else the words used), "quantity": number|null, "unit": string|null, "location": string|null, "thickness_cm": number|null, "payment_method": "نقدي"|"تحويل بنكي"|"شيك"|null, "reference": string|null, "days": number|null, "period": "week"|"month"|null, "person_name": string|null, "company_text": string|null, "phone": string|null, "invoice_filter": "open"|"all"|null, "reply_text": string|null}, "flow_answer": {"<slot>": value} | null}

LAST USER MESSAGE: """${S_(raw).slice(0,600)}"""`;
}
/* merge an AI answer with rule extraction */
function mergeAI(db, raw, ai){
  const out = ai || {}; const intent = INTENTS[out.intent] ? out.intent : 'UNKNOWN';
  const ents = extractEntities(db, raw); const a = out.entities || {};
  for (const [k,v] of Object.entries(a)){ if (v!==null && v!==undefined && v!=='') ents[k] = v; }
  if (a.service){ const p = matchProduct(db, String(a.service)); if (p) ents.service = p.id; }
  if (a.customer_name && !ents.customer_id){ const c = findCustomerInText(db, norm(a.customer_name)); if (c) ents.customer_id = c.id; else ents.customer_name = a.customer_name; }
  if (a.unit) ents.unit = unitNorm(a.unit)||a.unit;
  if (a.phone){ const p = normPhone(a.phone); if (p) ents.phone = p; }
  if (a.ref_id) ents.ref_id = String(a.ref_id).toUpperCase().replace(/\s+/g,'').replace(/^(AP|HO)(\d)/,'$1-$2');
  return { intent, confidence: Math.max(0,Math.min(1,+out.confidence||.7)), entities:ents, engine:'ai', flow_answer: out.flow_answer||null };
}
